const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const telegramRouter = require('../routes/telegram');

test('Telegram webhook secret comparison rejects missing and incorrect values', () => {
  const { secretMatches } = telegramRouter._test;
  assert.equal(secretMatches('', 'configured-secret'), false);
  assert.equal(secretMatches('wrong-secret', 'configured-secret'), false);
  assert.equal(secretMatches('configured-secret', 'configured-secret'), true);
});

test('Telegram setup recognizes missing Postgres and Supabase REST schema objects', () => {
  const { isMissingDatabaseSchema } = telegramRouter._test;
  assert.equal(isMissingDatabaseSchema({ code: '42P01', message: 'relation does not exist' }), true);
  assert.equal(isMissingDatabaseSchema({ code: 'PGRST205', message: 'table missing from schema cache' }), true);
  assert.equal(isMissingDatabaseSchema({ code: '28P01', message: 'password authentication failed' }), false);
  assert.equal(isMissingDatabaseSchema(new Error('Temporary network failure')), false);
});

test('Telegram accepts text but classifies file and non-text updates as unsupported', () => {
  const { getUnsupportedTelegramMessageType } = telegramRouter._test;
  assert.equal(getUnsupportedTelegramMessageType({ text: 'hello' }), null);
  assert.equal(getUnsupportedTelegramMessageType({ document: { file_id: 'private-document' } }), 'document');
  assert.equal(getUnsupportedTelegramMessageType({ photo: [{ file_id: 'private-photo' }] }), 'photo');
  assert.equal(getUnsupportedTelegramMessageType({ voice: { file_id: 'voice-message' } }), 'voice');
  assert.equal(getUnsupportedTelegramMessageType({ location: { latitude: 1, longitude: 2 } }), 'location');
});

test('Telegram webhook rejects a request with the wrong secret', async () => {
  const previous = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = 'configured-secret';
  const app = express();
  app.use('/api/v1/telegram', telegramRouter);
  const server = await new Promise((resolve) => { const listening = app.listen(0, () => resolve(listening)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong-secret' }, body: '{}' });
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = previous;
  }
});

test('Telegram webhook reports missing secret configuration instead of accepting updates', async () => {
  const previous = process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const app = express();
  app.use('/api/v1/telegram', telegramRouter);
  const server = await new Promise((resolve) => { const listening = app.listen(0, () => resolve(listening)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, message: 'Telegram webhook is not configured.' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = previous;
  }
});
