const { supabase, isConnected } = require('../db/supabase');
const telegramRouter = require('../routes/telegram');
const { nextDailyRun } = require('./scheduleTime');

const POLL_INTERVAL_MS = 15_000;
let pollTimer = null;
let polling = false;

async function finishSchedule(schedule, succeeded, errorMessage = null) {
  const nextRunAt = succeeded && schedule.repeat_mode === 'daily'
    ? nextDailyRun(schedule.local_time, schedule.timezone_name).toISOString()
    : null;
  const { error } = await supabase.rpc('finish_telegram_message_schedule', {
    p_schedule_id: schedule.id,
    p_succeeded: succeeded,
    p_error: errorMessage,
    p_next_run_at: nextRunAt,
  });
  if (error) throw error;
}

async function deliverSchedule(schedule) {
  const { data: client, error } = await supabase.from('clients')
    .select('id,user_id,name,email,status,telegram_chat_id')
    .eq('id', schedule.client_id)
    .eq('user_id', schedule.owner_user_id)
    .maybeSingle();
  if (error) throw error;
  if (!client) throw new Error('The scheduled client is no longer available to this account.');
  await telegramRouter.sendScheduledTelegramReminder(client, schedule);
}

async function processDueTelegramSchedules() {
  if (!isConnected || polling) return;
  polling = true;
  try {
    const { data: schedules, error } = await supabase.rpc('claim_due_telegram_message_schedules', { p_limit: 20 });
    if (error) throw error;
    for (const schedule of schedules || []) {
      try {
        await deliverSchedule(schedule);
      } catch (error) {
        console.error(`[Schedule Worker] Telegram reminder ${schedule.id} failed:`, error.message);
        try {
          await finishSchedule(schedule, false, error.message);
        } catch (finishError) {
          console.error(`[Schedule Worker] Could not record failure for reminder ${schedule.id}:`, finishError.message);
        }
        continue;
      }
      try {
        await finishSchedule(schedule, true);
      } catch (error) {
        console.error(`[Schedule Worker] Telegram reminder ${schedule.id} was sent but its schedule status could not be saved:`, error.message);
      }
    }
  } catch (error) {
    console.error('[Schedule Worker] Could not claim due Telegram reminders:', error.message);
  } finally {
    polling = false;
  }
}

function startTelegramScheduleWorker() {
  if (pollTimer || !isConnected) return;
  void processDueTelegramSchedules();
  pollTimer = setInterval(() => void processDueTelegramSchedules(), POLL_INTERVAL_MS);
  pollTimer.unref?.();
  console.log('[Schedule Worker] Telegram reminder scheduler started (15-second polling).');
}

function stopTelegramScheduleWorker() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

module.exports = {
  processDueTelegramSchedules,
  startTelegramScheduleWorker,
  stopTelegramScheduleWorker,
};
