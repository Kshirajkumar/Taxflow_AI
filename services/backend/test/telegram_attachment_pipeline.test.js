const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-placeholder';
const database = require('../db/supabase');
const telegramRouter = require('../routes/telegram');
const { getCurrentVaultPeriod } = require('../vault/vaultManager');

const tables = { clients: [], telegram_messages: [], documents_metadata: [] };

function matches(row, filters) {
  return filters.every(({ field, operator, value }) => {
    if (operator === 'eq') return row[field] === value;
    if (operator === 'lt') return row[field] < value;
    if (operator === 'lte') return row[field] <= value;
    if (operator === 'is') return row[field] === value;
    if (operator === 'not') return row[field] !== value;
    if (operator === 'in') return value.includes(row[field]);
    return false;
  });
}

function fakeQuery(table) {
  let operation = 'select';
  let payload;
  let filters = [];
  const query = {
    select() { return this; },
    insert(value) { operation = 'insert'; payload = value; return this; },
    update(value) { operation = 'update'; payload = value; return this; },
    eq(field, value) { filters.push({ field, operator: 'eq', value }); return this; },
    lt(field, value) { filters.push({ field, operator: 'lt', value }); return this; },
    lte(field, value) { filters.push({ field, operator: 'lte', value }); return this; },
    is(field, value) { filters.push({ field, operator: 'is', value }); return this; },
    not(field, _operator, value) { filters.push({ field, operator: 'not', value }); return this; },
    in(field, value) { filters.push({ field, operator: 'in', value }); return this; },
    order() { return this; },
    limit() { return this; },
    maybeSingle() { return this.execute(true); },
    single() { return this.execute(true); },
    then(resolve, reject) { return this.execute(false).then(resolve, reject); },
    async execute(maybe) {
      const records = tables[table];
      if (operation === 'insert') {
        const values = Array.isArray(payload) ? payload : [payload];
        const inserted = [];
        for (const value of values) {
          const duplicate = records.some((row) => (
            (table === 'telegram_messages' && row.provider_message_id === value.provider_message_id && row.direction === value.direction)
            || (table === 'documents_metadata' && row.telegram_message_id === value.telegram_message_id)
          ));
          if (duplicate) return { data: null, error: { code: '23505', message: 'duplicate row' } };
          const row = {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            vault_file_ref: null,
            attachment_download_status: 'pending',
            attachment_download_attempts: 0,
            attachment_download_next_attempt_at: new Date().toISOString(),
            ...value
          };
          records.push(row);
          inserted.push({ ...row });
        }
        const data = inserted.length === 1 ? inserted[0] : inserted;
        return { data, error: null };
      }
      const selected = records.filter((row) => matches(row, filters));
      if (operation === 'update') {
        selected.forEach((row) => Object.assign(row, payload));
        const updated = selected.map((row) => ({ ...row }));
        return { data: maybe ? updated[0] || null : updated, error: null };
      }
      const copies = selected.map((row) => ({ ...row }));
      const data = maybe ? copies[0] || null : copies;
      return { data, error: null };
    }
  };
  return query;
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the Telegram attachment worker.');
}

test('Telegram webhook saves supported attachments to the client vault without opening the inbox', async (t) => {
  const oldFrom = database.supabase.from;
  const oldFetch = global.fetch;
  const oldVaultPath = process.env.VAULT_PATH;
  const oldBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'taxflow-telegram-'));
  const fileBytes = Buffer.from('%PDF-1.7 test attachment');
  let fileAttempts = 0;
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  tables.clients.push({ id: 'client-1', name: 'Example Client', telegram_chat_id: 'chat-1' });
  database.supabase.from = (table) => fakeQuery(table);
  process.env.VAULT_PATH = vaultPath;
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
  global.fetch = async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:')) return oldFetch(url, init);
    if (String(url).includes('/getFile')) {
      return new Response(JSON.stringify({ ok: true, result: { file_path: 'files/invoice.pdf', file_size: fileBytes.length } }));
    }
    fileAttempts += 1;
    if (fileAttempts === 1) throw new Error('Simulated temporary network failure');
    return new Response(fileBytes, { headers: { 'content-length': String(fileBytes.length) } });
  };

  const app = express();
  app.use('/telegram', telegramRouter);
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = oldFrom;
    global.fetch = oldFetch;
    if (oldVaultPath === undefined) delete process.env.VAULT_PATH; else process.env.VAULT_PATH = oldVaultPath;
    if (oldBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = oldBotToken;
    if (oldSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = oldSecret;
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'test-webhook-secret'
    },
    body: JSON.stringify({
      update_id: 501,
      message: {
        message_id: 72,
        date: 1792322400,
        chat: { id: 'chat-1', type: 'private' },
        from: { id: 88 },
        document: {
          file_id: 'telegram-file-1',
          file_name: 'client-invoice.pdf',
          mime_type: 'application/pdf',
          file_size: fileBytes.length
        }
      }
    })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  await waitFor(() => tables.telegram_messages[0]?.attachment_download_status === 'pending' && tables.telegram_messages[0]?.file_download_error);
  assert.equal(tables.telegram_messages[0].attachment_download_attempts, 1);
  await waitFor(() => !telegramRouter._test.isAttachmentDownloadQueued(tables.telegram_messages[0].id));
  tables.telegram_messages[0].attachment_download_next_attempt_at = new Date().toISOString();
  assert.equal(await telegramRouter._test.recoverPendingAttachmentDownloads(), 1);
  await waitFor(() => tables.telegram_messages[0]?.attachment_download_status === 'saved');

  const message = tables.telegram_messages[0];
  const document = tables.documents_metadata[0];
  assert.equal(message.vault_file_ref, document.id);
  assert.equal(message.attachment_download_attempts, 2);
  assert.equal(document.source, 'Telegram');
  assert.equal(document.file_type, 'PDF');
  assert.equal(fs.readFileSync(document.vault_path).toString(), fileBytes.toString());
  const expectedPeriod = getCurrentVaultPeriod(new Date(message.created_at));
  assert.ok(document.vault_path.includes(path.join(expectedPeriod.year, expectedPeriod.month, 'Raw')));

  const unsupportedResponse = await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'test-webhook-secret'
    },
    body: JSON.stringify({
      update_id: 502,
      message: {
        message_id: 73,
        date: 1792322401,
        chat: { id: 'chat-1', type: 'private' },
        document: {
          file_id: 'unsafe-file',
          file_name: 'payload.exe',
          mime_type: 'application/octet-stream',
          file_size: 100
        }
      }
    })
  });
  assert.equal(unsupportedResponse.status, 200);
  await waitFor(() => tables.telegram_messages[1]?.attachment_download_status === 'failed');
  assert.match(tables.telegram_messages[1].file_download_error, /not supported/i);
  assert.equal(telegramRouter._test.publicTelegramMessage(tables.telegram_messages[1]).file_download_retryable, false);
  assert.equal(tables.documents_metadata.length, 1);
});

test('Telegram attachment parsing covers media messages and rejects unsafe formats clearly', () => {
  const { getTelegramAttachment, normalizeTelegramFileName, getUnrepresentedTelegramMessage } = telegramRouter._test;
  const voice = getTelegramAttachment({ message_id: 4, voice: { file_id: 'voice-id', mime_type: 'audio/ogg' } });
  assert.equal(voice.messageType, 'voice');
  assert.equal(voice.fileName, 'telegram-voice-4.ogg');

  const animation = getTelegramAttachment({ message_id: 5, animation: { file_id: 'animation-id', mime_type: 'video/mp4' } });
  assert.equal(animation.fileName, 'telegram-animation-5.mp4');
  assert.equal(getUnrepresentedTelegramMessage({ contact: {} }), 'contact');
  assert.deepEqual(normalizeTelegramFileName('client-data.zip', 'application/zip'), {
    fileName: 'client-data.zip',
    fileType: 'OTHER'
  });
  assert.throws(() => normalizeTelegramFileName('payload.exe', 'application/octet-stream'), /not supported/i);
  assert.throws(() => normalizeTelegramFileName('unknown-document', 'application/octet-stream'), /identified safely/i);
});
