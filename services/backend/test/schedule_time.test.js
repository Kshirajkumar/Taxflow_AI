const test = require('node:test');
const assert = require('node:assert/strict');
const { nextDailyRun, scheduledLocalTimeToUtc } = require('../lib/scheduleTime');

test('one-time local reminders convert from client country time to UTC', () => {
  const utc = scheduledLocalTimeToUtc('2026-11-01T20:00', 'Asia/Kolkata');
  assert.equal(utc.toISOString(), '2026-11-01T14:30:00.000Z');
});

test('daily schedules choose the next future wall-clock time in the client zone', () => {
  const beforeSchedule = new Date('2026-10-24T08:00:00.000Z');
  const next = nextDailyRun('20:00', 'Asia/Kolkata', beforeSchedule);
  assert.equal(next.toISOString(), '2026-10-24T14:30:00.000Z');

  const afterSchedule = new Date('2026-10-24T15:00:00.000Z');
  const tomorrow = nextDailyRun('20:00', 'Asia/Kolkata', afterSchedule);
  assert.equal(tomorrow.toISOString(), '2026-10-25T14:30:00.000Z');
});

test('time-zone validation rejects nonexistent daylight-saving wall times', () => {
  assert.throws(
    () => scheduledLocalTimeToUtc('2026-03-08T02:30', 'America/New_York'),
    /daylight-saving change/i,
  );
});

test('time-zone conversion rejects malformed and past send times', () => {
  assert.throws(() => scheduledLocalTimeToUtc('not-a-date', 'Asia/Kolkata'), /valid local date and time/i);
  assert.throws(() => scheduledLocalTimeToUtc('2020-01-01T10:00', 'Asia/Kolkata'), /at least 30 seconds/i);
});
