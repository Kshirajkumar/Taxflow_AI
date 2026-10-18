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

const tables = { clients: [], telegram_messages: [], documents_metadata: [], document_sync_receipts: [] };

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
    upsert(value) { operation = 'upsert'; payload = value; return this; },
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
      if (operation === 'upsert') {
        const keys = table === 'document_sync_receipts' ? ['user_id', 'device_id', 'document_id'] : [];
        const existing = records.find(row => keys.length && keys.every(key => row[key] === payload[key]));
        if (existing) Object.assign(existing, payload);
        else records.push({ ...payload });
        return { data: existing || payload, error: null };
      }
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
  const oldBucket = process.env.SUPABASE_STORAGE_BUCKET;
  const oldBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'taxflow-telegram-'));
  const fileBytes = Buffer.from('%PDF-1.7 test attachment');
  let fileAttempts = 0;
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  tables.clients.push({ id: 'client-1', name: 'Example Client', telegram_chat_id: 'chat-1' });
  database.supabase.from = (table) => fakeQuery(table);
  process.env.VAULT_PATH = vaultPath;
  delete process.env.SUPABASE_STORAGE_BUCKET;
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
    if (oldBucket === undefined) delete process.env.SUPABASE_STORAGE_BUCKET; else process.env.SUPABASE_STORAGE_BUCKET = oldBucket;
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

test('Production Telegram attachments upload to private object storage with a verifiable checksum', async (t) => {
  const oldFrom = database.supabase.from;
  const oldStorageFrom = database.supabase.storage.from;
  const oldFetch = global.fetch;
  const oldBucket = process.env.SUPABASE_STORAGE_BUCKET;
  const oldVaultPath = process.env.VAULT_PATH;
  const oldBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const fileBytes = Buffer.from('%PDF-1.7 cloud attachment');
  const uploads = [];
  let uploadAttempts = 0;
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  tables.clients.push({
    id: 'client-cloud',
    user_id: 'user-cloud',
    name: 'Cloud Client',
    telegram_chat_id: 'cloud-chat'
  });
  database.supabase.from = (table) => fakeQuery(table);
  database.supabase.storage.from = (bucket) => ({
    async upload(key, bytes, options) {
      uploadAttempts += 1;
      if (uploadAttempts === 1) return { data: null, error: new Error('Simulated temporary Storage failure') };
      uploads.push({ bucket, key, bytes: Buffer.from(bytes), options });
      return { data: { path: key }, error: null };
    }
  });
  process.env.SUPABASE_STORAGE_BUCKET = 'taxflow-intake';
  delete process.env.VAULT_PATH;
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
  global.fetch = async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:')) return oldFetch(url, init);
    if (String(url).includes('/getFile')) {
      return new Response(JSON.stringify({ ok: true, result: { file_path: 'files/cloud.pdf', file_size: fileBytes.length } }));
    }
    return new Response(fileBytes, { headers: { 'content-length': String(fileBytes.length) } });
  };

  const app = express();
  app.use('/telegram', telegramRouter);
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = oldFrom;
    database.supabase.storage.from = oldStorageFrom;
    global.fetch = oldFetch;
    if (oldBucket === undefined) delete process.env.SUPABASE_STORAGE_BUCKET; else process.env.SUPABASE_STORAGE_BUCKET = oldBucket;
    if (oldVaultPath === undefined) delete process.env.VAULT_PATH; else process.env.VAULT_PATH = oldVaultPath;
    if (oldBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = oldBotToken;
    if (oldSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = oldSecret;
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'test-webhook-secret'
    },
    body: JSON.stringify({
      update_id: 701,
      message: {
        message_id: 92,
        date: 1792322400,
        chat: { id: 'cloud-chat', type: 'private' },
        document: {
          file_id: 'telegram-cloud-file',
          file_name: 'client-record.pdf',
          mime_type: 'application/pdf',
          file_size: fileBytes.length
        }
      }
    })
  });

  assert.equal(response.status, 200);
  await waitFor(() => tables.telegram_messages[0]?.attachment_download_status === 'pending' && tables.telegram_messages[0]?.file_download_error);
  tables.telegram_messages[0].attachment_download_next_attempt_at = new Date().toISOString();
  assert.equal(await telegramRouter._test.recoverPendingAttachmentDownloads(), 1);
  await waitFor(() => tables.telegram_messages[0]?.attachment_download_status === 'saved');
  const document = tables.documents_metadata[0];
  assert.equal(uploadAttempts, 2);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].bucket, 'taxflow-intake');
  assert.equal(uploads[0].bytes.toString(), fileBytes.toString());
  assert.match(uploads[0].key, /^user-cloud\/client-cloud\/\d{4}\/[A-Za-z]+\/.+_client-record\.pdf$/);
  assert.equal(document.storage_bucket, 'taxflow-intake');
  assert.equal(document.storage_object_path, uploads[0].key);
  assert.equal(document.file_sha256, crypto.createHash('sha256').update(fileBytes).digest('hex'));
  assert.equal(document.mime_type, 'application/pdf');
  assert.ok(document.vault_path.startsWith('supabase://taxflow-intake/'));
});

test('Authenticated desktop sync lists only pending owned files and acknowledges verified copies', async (t) => {
  const oldFrom = database.supabase.from;
  const oldRpc = database.supabase.rpc;
  const oldStorageFrom = database.supabase.storage.from;
  const oldVaultPath = process.env.VAULT_PATH;
  const oldStorageBucket = process.env.SUPABASE_STORAGE_BUCKET;
  const fileBytes = Buffer.from('%PDF-1.7 sync download');
  const checksum = crypto.createHash('sha256').update(fileBytes).digest('hex');
  const ownerId = 'owner-1';
  const clientId = 'client-sync';
  const documentId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const localServerVault = fs.mkdtempSync(path.join(os.tmpdir(), 'taxflow-sync-vault-'));
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  tables.clients.push({ id: clientId, user_id: ownerId, name: 'Sync Client' });
  tables.documents_metadata.push({
    id: documentId,
    client_id: clientId,
    source: 'Telegram',
    file_name: 'inbound.pdf',
    file_size_kb: fileBytes.length / 1024,
    file_sha256: checksum,
    created_at: '2026-10-18T12:00:00.000Z',
    storage_bucket: 'taxflow-intake',
    storage_object_path: 'owner-1/client-sync/2026/October/inbound.pdf',
    mime_type: 'application/pdf',
    vault_path: 'supabase://taxflow-intake/owner/client/2026/October/inbound.pdf'
  });
  database.supabase.from = (table) => fakeQuery(table);
  database.supabase.rpc = async (name, args) => {
    assert.equal(name, 'list_pending_document_sync');
    assert.equal(args.p_user_id, ownerId);
    assert.equal(args.p_device_id, deviceId);
    return {
      data: [{
        document_id: documentId,
        client_name: 'Sync Client',
        file_name: 'inbound.pdf',
        file_sha256: checksum,
        created_at: '2026-10-18T12:00:00.000Z'
      }],
      error: null
    };
  };
  database.supabase.storage.from = (bucket) => ({
    async download(key) {
      assert.equal(bucket, 'taxflow-intake');
      assert.equal(key, 'owner-1/client-sync/2026/October/inbound.pdf');
      return { data: new Blob([fileBytes]), error: null };
    }
  });
  process.env.SUPABASE_STORAGE_BUCKET = 'taxflow-intake';

  const app = express();
  app.use(express.json());
  app.use('/api/v1/documents', (req, _res, next) => { req.user = { id: ownerId }; next(); }, require('../routes/documents'));
  app.use('/api/v1/clients', (req, _res, next) => { req.user = { id: ownerId }; next(); }, require('../routes/clients'));
  process.env.VAULT_PATH = localServerVault;
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = oldFrom;
    database.supabase.rpc = oldRpc;
    database.supabase.storage.from = oldStorageFrom;
    if (oldVaultPath === undefined) delete process.env.VAULT_PATH; else process.env.VAULT_PATH = oldVaultPath;
    if (oldStorageBucket === undefined) delete process.env.SUPABASE_STORAGE_BUCKET;
    else process.env.SUPABASE_STORAGE_BUCKET = oldStorageBucket;
    fs.rmSync(localServerVault, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/documents`;

  const pendingResponse = await fetch(`${baseUrl}/sync/pending?deviceId=${deviceId}&limit=20`);
  assert.equal(pendingResponse.status, 200);
  const pending = await pendingResponse.json();
  assert.deepEqual(pending.data, [{
    id: documentId,
    clientName: 'Sync Client',
    fileName: 'inbound.pdf',
    sha256: checksum,
    year: '2026',
    month: 'October'
  }]);

  const downloadResponse = await fetch(`${baseUrl}/${documentId}/serve`);
  assert.equal(downloadResponse.status, 200);
  assert.equal(Buffer.from(await downloadResponse.arrayBuffer()).toString(), fileBytes.toString());
  assert.equal(downloadResponse.headers.get('content-type'), 'application/pdf');

  const clientBaseUrl = `http://127.0.0.1:${server.address().port}/api/v1/clients/${clientId}`;
  const treeResponse = await fetch(`${clientBaseUrl}/vault-tree`);
  assert.equal(treeResponse.status, 200);
  const tree = await treeResponse.json();
  const syncedFile = tree.data.entries
    .find(entry => entry.name === '2026')
    ?.children.find(entry => entry.name === 'October')
    ?.children.find(entry => entry.name === 'Raw')
    ?.children.find(entry => entry.name === 'inbound.pdf');
  assert.equal(syncedFile?.cloudRetained, true);
  assert.equal(syncedFile?.size, fileBytes.length);

  const localCopyResponse = await fetch(`${clientBaseUrl}/vault-file?${new URLSearchParams({ relativePath: '2026/October/Raw/inbound.pdf' })}`);
  assert.equal(localCopyResponse.status, 200);
  assert.equal(Buffer.from(await localCopyResponse.arrayBuffer()).toString(), fileBytes.toString());

  tables.documents_metadata[0].storage_object_path = 'other-owner/client/2026/October/inbound.pdf';
  const unexpectedObjectResponse = await fetch(`${baseUrl}/${documentId}/serve`);
  assert.equal(unexpectedObjectResponse.status, 404);

  const receiptResponse = await fetch(`${baseUrl}/sync/receipt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, documentId, sha256: checksum })
  });
  assert.equal(receiptResponse.status, 200);
  assert.equal(tables.document_sync_receipts.length, 1);

  const mismatchResponse = await fetch(`${baseUrl}/sync/receipt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, documentId, sha256: '0'.repeat(64) })
  });
  assert.equal(mismatchResponse.status, 409);
});
