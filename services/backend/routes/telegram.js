const express = require('express');
const crypto = require('node:crypto');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { requireAuth } = require('../middleware/requireAuth');
const { assertOwnedClient } = require('../lib/ownership');

const botToken = () => process.env.TELEGRAM_BOT_TOKEN || '';
const webhookSecret = () => process.env.TELEGRAM_WEBHOOK_SECRET || '';
const botUsername = () => String(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function secretMatches(value, expected) { const left = Buffer.from(String(value || '')); const right = Buffer.from(String(expected || '')); return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right); }

async function telegramCall(method, payload) {
  if (!botToken()) throw new Error('Telegram bot is not configured');
  const response = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API request failed (${response.status})`);
  return result.result;
}

async function configureWebhook() {
  const publicUrl = String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  if (!publicUrl) {
    console.warn('[Telegram] Webhook auto-configuration skipped: PUBLIC_URL/RENDER_EXTERNAL_URL is not set.');
    return { configured: false, reason: 'public_url_missing' };
  }
  if (!/^https:\/\//i.test(publicUrl)) throw new Error('Telegram webhook public URL must use HTTPS');
  const webhookUrl = `${publicUrl}/api/v1/telegram/webhook`;
  await telegramCall('setWebhook', { url: webhookUrl, ...(webhookSecret() ? { secret_token: webhookSecret() } : {}), allowed_updates: ['message'] });
  console.log(`[Telegram] Webhook configured: ${webhookUrl}`);
  return { configured: true, webhookUrl };
}

router.get('/status', requireAuth, async (_req, res) => {
  try { const bot = await telegramCall('getMe', {}); return res.json({ success: true, connected: true, bot: { id: bot.id, username: bot.username, name: bot.first_name } }); }
  catch (error) { return res.status(503).json({ success: false, connected: false, message: error.message }); }
});

router.post('/clients/:clientId/link', requireAuth, async (req, res) => {
  try {
    if (!isConnected || !(await assertOwnedClient(req.user.id, req.params.clientId))) return res.status(404).json({ success: false, message: 'Client not found.' });
    const username = botUsername() || (await telegramCall('getMe', {})).username;
    const raw = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { error } = await supabase.from('telegram_link_tokens').insert({ client_id: req.params.clientId, token_hash: hash(raw), expires_at: expiresAt, created_by: req.user.id });
    if (error) throw error;
    return res.status(201).json({ success: true, link: `https://t.me/${username}?start=${encodeURIComponent(raw)}`, expiresAt });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.get('/unread', requireAuth, async (req, res) => {
  try {
    if (!isConnected) return res.json({ success: true, counts: {}, total: 0 });
    const { data: clients, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', req.user.id);
    if (clientError) throw clientError;
    const clientIds = (clients || []).map((c) => c.id);
    if (!clientIds.length) return res.json({ success: true, counts: {}, total: 0 });

    const { data: unreadRows, error } = await supabase
      .from('telegram_messages')
      .select('client_id')
      .in('client_id', clientIds)
      .eq('direction', 'inbound')
      .eq('is_read', false);
    if (error) throw error;

    const counts = {};
    let total = 0;
    (unreadRows || []).forEach((r) => {
      counts[r.client_id] = (counts[r.client_id] || 0) + 1;
      total += 1;
    });

    return res.json({ success: true, counts, total });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.post('/clients/:clientId/read', requireAuth, async (req, res) => {
  try {
    if (!isConnected || !(await assertOwnedClient(req.user.id, req.params.clientId))) return res.status(404).json({ success: false, message: 'Client not found.' });
    await supabase.from('telegram_messages')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('client_id', req.params.clientId)
      .eq('direction', 'inbound')
      .eq('is_read', false);
    return res.json({ success: true });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.get('/clients/:clientId/messages', requireAuth, async (req, res) => {
  try {
    if (!isConnected || !(await assertOwnedClient(req.user.id, req.params.clientId))) return res.status(404).json({ success: false, message: 'Client not found.' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const [{ data, error }, { data: client, error: clientError }] = await Promise.all([
      supabase.from('telegram_messages').select('*').eq('client_id', req.params.clientId).order('created_at', { ascending: true }).limit(limit),
      supabase.from('clients').select('telegram_chat_id').eq('id', req.params.clientId).eq('user_id', req.user.id).single(),
    ]);
    if (error) throw error;
    if (clientError) throw clientError;

    // Automatically mark unread inbound messages as read for this client
    await supabase.from('telegram_messages')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('client_id', req.params.clientId)
      .eq('direction', 'inbound')
      .eq('is_read', false);

    return res.json({ success: true, linked: Boolean(client?.telegram_chat_id), data: data || [] });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.post('/send', requireAuth, async (req, res) => {
  try {
    const { clientId, message, approved, requestId } = req.body || {};
    if (!clientId || typeof message !== 'string' || !message.trim() || message.length > 4096) return res.status(400).json({ success: false, message: 'clientId and a message between 1 and 4096 characters are required.' });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(requestId || ''))) return res.status(400).json({ success: false, message: 'A valid requestId is required.' });
    if (approved !== true) return res.status(422).json({ success: false, message: 'Explicit message approval is required.' });
    if (!isConnected || !(await assertOwnedClient(req.user.id, clientId))) return res.status(404).json({ success: false, message: 'Client not found.' });
    const { data: client, error: clientError } = await supabase.from('clients').select('id,telegram_chat_id').eq('id', clientId).eq('user_id', req.user.id).single();
    if (clientError) throw clientError;
    if (!client.telegram_chat_id) return res.status(422).json({ success: false, message: 'This client has not linked Telegram.' });
    const providerMessageId = `taxflow:${requestId}`;
    const { error: queueError } = await supabase.from('telegram_messages').insert({ client_id: clientId, provider_message_id: providerMessageId, direction: 'outbound', chat_id: String(client.telegram_chat_id), body: message.trim(), delivery_status: 'queued', approved_by: req.user.id, approved_at: new Date().toISOString() });
    if (queueError?.code === '23505') return res.status(409).json({ success: false, message: 'This message request has already been processed.' });
    if (queueError) throw queueError;
    try {
      const sent = await telegramCall('sendMessage', { chat_id: client.telegram_chat_id, text: message.trim() });
      const { error: updateError } = await supabase.from('telegram_messages').update({ delivery_status: 'sent', provider_response_id: String(sent.message_id), sender_user_id: String(sent.from?.id || '') }).eq('provider_message_id', providerMessageId).eq('direction', 'outbound');
      if (updateError) { console.error('[Telegram] sent message status persistence failed:', updateError.message); return res.json({ success: true, data: sent, warning: 'delivery_status_persistence_failed' }); }
      return res.json({ success: true, data: sent });
    } catch (error) {
      await supabase.from('telegram_messages').update({ delivery_status: 'failed' }).eq('provider_message_id', providerMessageId).eq('direction', 'outbound');
      throw error;
    }
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.post('/webhook', express.json({ limit: '2mb' }), async (req, res) => {
  if (!secretMatches(req.headers['x-telegram-bot-api-secret-token'], webhookSecret())) return res.sendStatus(401);
  res.status(200).json({ ok: true });
  try {
    const update = req.body || {}; const message = update.message || update.edited_message;
    if (!message?.chat?.id) return;
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if (text.startsWith('/start')) {
      const token = text.replace(/^\/start(?:@[^\s]+)?\s*/i, '').trim(); if (!token || message.chat.type !== 'private') return;
      const { data: link } = await supabase.from('telegram_link_tokens').select('id,client_id').eq('token_hash', hash(token)).is('consumed_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (!link) return;
      const { data: client } = await supabase.from('clients').select('id,name').eq('id', link.client_id).single();
      if (!client) return;
      const { data: consumed } = await supabase.from('telegram_link_tokens').update({ consumed_at: new Date().toISOString() }).eq('id', link.id).is('consumed_at', null).select('id').maybeSingle();
      if (!consumed) return;
      const { error: linkError } = await supabase.from('clients').update({ telegram_user_id: message.from?.id ? String(message.from.id) : null, telegram_chat_id: String(message.chat.id), telegram_linked_at: new Date().toISOString() }).eq('id', client.id);
      if (linkError) { await supabase.from('telegram_link_tokens').update({ consumed_at: null }).eq('id', link.id); console.error('[Telegram] client linking failed:', linkError.message); return; }
      const welcome = `Your Telegram account is connected to TaxFlow for ${client.name}.`;
      const sent = await telegramCall('sendMessage', { chat_id: message.chat.id, text: welcome });
      await supabase.from('telegram_messages').insert({ client_id: client.id, provider_message_id: `telegram:${message.chat.id}:${sent.message_id}`, direction: 'outbound', chat_id: String(message.chat.id), body: welcome, delivery_status: 'sent' });
      return;
    }
    if (!text || message.chat.type !== 'private') return;
    const { data: client } = await supabase.from('clients').select('id').eq('telegram_chat_id', String(message.chat.id)).single();
    if (!client) return;
    const { error } = await supabase.from('telegram_messages').insert({ client_id: client.id, provider_message_id: `telegram:update:${String(update.update_id || message.message_id)}`, direction: 'inbound', chat_id: String(message.chat.id), sender_user_id: message.from?.id ? String(message.from.id) : null, body: text, delivery_status: 'received' });
    if (error && error.code !== '23505') console.error('[Telegram] message persistence failed:', error.message);
  } catch (error) { console.error('[Telegram] webhook processing failed:', error.message); }
});

module.exports = router;
module.exports.configureWebhook = configureWebhook;
module.exports._test = { secretMatches };
