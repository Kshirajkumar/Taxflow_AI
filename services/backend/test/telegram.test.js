const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const telegramRouter = require('../routes/telegram');
const { getCurrentVaultPeriod } = require('../vault/vaultManager');

test('Telegram webhook secret comparison rejects missing and incorrect values', () => {
  const { secretMatches } = telegramRouter._test;
  assert.equal(secretMatches('', 'configured-secret'), false);
  assert.equal(secretMatches('wrong-secret', 'configured-secret'), false);
  assert.equal(secretMatches('configured-secret', 'configured-secret'), true);
});

test('Telegram attachments retain document metadata and use the highest-resolution photo', () => {
  const { getTelegramAttachment, normalizeTelegramFileName } = telegramRouter._test;
  const document = getTelegramAttachment({
    message_id: 12,
    document: { file_id: 'telegram-file-id', file_name: 'return.pdf', mime_type: 'application/pdf', file_size: 2048 },
  });
  assert.deepEqual(document, {
    fileId: 'telegram-file-id',
    fileName: 'return.pdf',
    mimeType: 'application/pdf',
    fileSize: 2048,
    messageType: 'document',
  });
  assert.deepEqual(normalizeTelegramFileName('../return.pdf', 'application/pdf'), {
    fileName: '.._return.pdf',
    fileType: 'PDF',
  });

  const photo = getTelegramAttachment({
    message_id: 15,
    photo: [
      { file_id: 'small', file_size: 100 },
      { file_id: 'large', file_size: 1000 },
    ],
  });
  assert.equal(photo.fileId, 'large');
  assert.equal(photo.fileName, 'telegram-photo-15.jpg');
  assert.throws(() => normalizeTelegramFileName('payload.exe', 'application/octet-stream'), /not supported/i);
});

test('Telegram attachment folder period and assessment year follow the message timestamp', () => {
  const { getTelegramMessageDate, getAssessmentYear } = telegramRouter._test;
  const sentAt = getTelegramMessageDate({ created_at: '2025-03-15T12:00:00.000Z' });
  const { year, month } = getCurrentVaultPeriod(sentAt);

  assert.equal(year, String(sentAt.getFullYear()));
  assert.equal(month, new Intl.DateTimeFormat('en-US', { month: 'long' }).format(sentAt));
  assert.equal(getAssessmentYear(sentAt), `${sentAt.getFullYear() - 1}-${String(sentAt.getFullYear()).slice(-2)}`);
  assert.throws(() => getTelegramMessageDate({ created_at: 'not-a-date' }), /invalid timestamp/i);
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
