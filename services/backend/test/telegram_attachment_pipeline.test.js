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
const { decryptPortalInviteToken, hashInviteToken } = require('../lib/clientPortalInvites');
const { getStorageObjectKey } = require('../lib/documentStorage');
const telegramRouter = require('../routes/telegram');

const tables = { clients: [], client_portal_access: [], client_portal_invites: [], telegram_link_tokens: [], telegram_messages: [], documents_metadata: [], document_sync_receipts: [] };
const missingSchemaTables = new Set();

function matches(row, filters) {
  return filters.every(({ field, operator, value }) => {
    if (operator === 'eq') return row[field] === value;
    if (operator === 'neq') return row[field] !== value;
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
    neq(field, value) { filters.push({ field, operator: 'neq', value }); return this; },
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
      if (missingSchemaTables.has(table)) {
        return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } };
      }
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
            ...(table === 'client_portal_invites' ? { consumed_at: null, revoked_at: null } : {}),
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

test('Telegram status reports messaging diagnostics without checking portal Storage', async (t) => {
  const oldFrom = database.supabase.from;
  const oldGetUser = database.supabase.auth.getUser;
  const oldStorageFrom = database.supabase.storage.from;
  const oldFetch = global.fetch;
  const envKeys = ['TELEGRAM_BOT_TOKEN', 'PUBLIC_URL', 'RENDER_EXTERNAL_URL', 'TELEGRAM_WEBHOOK_AUTO_CONFIGURE'];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let telegramApiCalls = 0;
  database.supabase.from = (table) => fakeQuery(table);
  database.supabase.auth.getUser = async () => ({ data: { user: { id: 'user-1' } }, error: null });
  database.supabase.storage.from = () => assert.fail('Telegram status must not check client-portal Storage');
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  process.env.PUBLIC_URL = 'https://taxflow-api.onrender.com';
  process.env.RENDER_EXTERNAL_URL = 'https://taxflow-api.onrender.com';
  process.env.TELEGRAM_WEBHOOK_AUTO_CONFIGURE = 'false';
  global.fetch = async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:')) return oldFetch(url, init);
    telegramApiCalls += 1;
    const method = String(url).split('/').pop();
    const result = method === 'getMe'
      ? { id: 1, username: 'taxflow_test_bot', first_name: 'TaxFlow' }
      : {
          url: 'https://telegram-bot-setup.onrender.com/api/v1/telegram/webhook',
          pending_update_count: 2,
          last_error_message: ''
        };
    return new Response(JSON.stringify({ ok: true, result }));
  };

  const app = express();
  app.use('/api/v1/telegram', (req, _res, next) => { req.headers.authorization = 'Bearer test-token'; next(); }, telegramRouter);
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = oldFrom;
    database.supabase.auth.getUser = oldGetUser;
    database.supabase.storage.from = oldStorageFrom;
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/telegram/status`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.connected, true);
  assert.equal(body.diagnostics.webhookMatchesThisService, false);
  assert.equal(body.diagnostics.webhookPendingUpdates, 2);
  assert.equal(body.diagnostics.telegramSchemaReady, true);
  assert.equal(body.diagnostics.clientPortalInvitesReady, true);
  assert.equal(Object.hasOwn(body.diagnostics, 'storageBucketReady'), false);
  assert.match(body.diagnostics.warnings.join(' '), /different service/i);
  assert.doesNotMatch(body.diagnostics.warnings.join(' '), /storage bucket|client portal uploads/i);

  missingSchemaTables.add('client_portal_invites');
  const missingInviteSchemaResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/telegram/status`);
  assert.equal(missingInviteSchemaResponse.status, 200);
  const missingInviteSchema = await missingInviteSchemaResponse.json();
  assert.equal(missingInviteSchema.diagnostics.clientPortalInvitesReady, false);
  assert.match(missingInviteSchema.diagnostics.warnings.join(' '), /Required database table public\.client_portal_invites is missing/i);
  assert.match(missingInviteSchema.diagnostics.warnings.join(' '), /Supabase project used by this backend/i);
  missingSchemaTables.delete('client_portal_invites');

  assert.deepEqual(await telegramRouter._test.configureWebhook(), {
    configured: false,
    reason: 'auto_configuration_disabled'
  });
  assert.equal(telegramApiCalls, 4);
});

test('Telegram media updates receive a private portal link without downloading or storing file bytes', async (t) => {
  const oldFrom = database.supabase.from;
  const oldStorageFrom = database.supabase.storage.from;
  const oldFetch = global.fetch;
  const envKeys = ['SUPABASE_STORAGE_BUCKET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'CLIENT_PORTAL_URL'];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const telegramCalls = [];
  let storageUploads = 0;
  let failNextMediaReply = true;
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  tables.clients.push({
    id: 'client-1',
    name: 'Example Client',
    email: 'client@example.com',
    status: 'Active',
    user_id: 'staff-1',
    telegram_chat_id: 'chat-1',
    telegram_user_id: '88',
  });
  database.supabase.from = (table) => fakeQuery(table);
  database.supabase.storage.from = () => ({
    async upload() { storageUploads += 1; return { data: null, error: null }; }
  });
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.CLIENT_PORTAL_URL = 'https://taxflow.example';
  global.fetch = async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:')) return oldFetch(url, init);
    const call = { url: String(url), body: JSON.parse(init.body) };
    telegramCalls.push(call);
    if (failNextMediaReply && call.body.text.includes('The TaxFlow bot does not download')) {
      failNextMediaReply = false;
      return new Response(JSON.stringify({ ok: false, description: 'Temporary Telegram failure' }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: telegramCalls.length } }), {
      headers: { 'content-type': 'application/json' }
    });
  };

  const app = express();
  app.use('/telegram', telegramRouter);
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = oldFrom;
    database.supabase.storage.from = oldStorageFrom;
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const mediaUpdates = [
    { photo: [{ file_id: 'photo-file' }] },
    { document: { file_id: 'document-file', file_name: 'private.pdf' } },
    { video: { file_id: 'video-file' } },
    { animation: { file_id: 'animation-file' } },
    { video_note: { file_id: 'video-note-file' } },
    { audio: { file_id: 'audio-file' } },
    { voice: { file_id: 'voice-file' } },
    { sticker: { file_id: 'sticker-file' } },
    { paid_media: [{ type: 'photo', media: { file_id: 'paid-photo' } }] },
    { document: { file_id: 'caption-command-file' }, caption: '/start one-time-link' },
  ];

  let firstUpdateBody;
  let firstFailedResponse;
  for (const [index, media] of mediaUpdates.entries()) {
    const update = {
      update_id: 501 + index,
      message: {
        message_id: 72 + index,
        date: 1792322400 + index,
        chat: { id: 'chat-1', type: 'private' },
        from: { id: 88 },
        ...(index < 2 ? { media_group_id: 'private-album-1' } : {}),
        ...media
      }
    };
    if (index === 0) firstUpdateBody = update;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'test-webhook-secret'
      },
      body: JSON.stringify(update)
    });
    if (index === 0) {
      firstFailedResponse = response;
      assert.equal(response.status, 503);
    } else {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, media_rejected: true });
    }
  }

  assert.equal(telegramCalls.length, mediaUpdates.length);
  const retryResponse = await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'test-webhook-secret'
    },
    body: JSON.stringify(firstUpdateBody)
  });
  assert.equal(retryResponse.status, 200);
  assert.deepEqual(await retryResponse.json(), { ok: true, media_rejected: true });
  assert.equal(telegramCalls.length, mediaUpdates.length, 'later album item already retried the failed group notice');
  assert.equal(telegramCalls[telegramCalls.length - 1].body.text, telegramCalls[0].body.text);
  assert.ok(telegramCalls.every((call) => call.url.endsWith('/sendMessage')));
  assert.ok(telegramCalls.every((call) => /do not send documents, photos, or files/i.test(call.body.text)));
  assert.ok(telegramCalls.every((call) => /does not download or process media/i.test(call.body.text)));
  assert.ok(telegramCalls.every((call) => /https:\/\/taxflow\.example\/portal#invite=/.test(call.body.text)));
  assert.ok(telegramCalls.every((call) => /create your account using the email address registered with your CA/i.test(call.body.text)));
  assert.ok(telegramCalls.every((call) => /sign in to the portal whenever you need to upload files/i.test(call.body.text)));
  assert.equal(new Set(telegramCalls.map((call) => call.body.text)).size, 1, 'each media reply reuses the active private invitation');
  assert.equal(storageUploads, 0);
  assert.equal(tables.telegram_messages.length, mediaUpdates.length - 1, 'an album receives one response rather than one response per item');
  assert.ok(tables.telegram_messages.every((row) => row.direction === 'outbound'));
  assert.ok(tables.telegram_messages.every((row) => !row.body.includes('#invite=')));
  assert.equal(tables.documents_metadata.length, 0);
  assert.equal(tables.client_portal_invites.length, 1);
  assert.ok(tables.client_portal_invites[0].token_ciphertext);
  assert.ok(/^[0-9a-f]{64}$/.test(tables.client_portal_invites[0].token_hash));
  assert.equal(
    hashInviteToken(decryptPortalInviteToken(tables.client_portal_invites[0].token_ciphertext)),
    tables.client_portal_invites[0].token_hash
  );

  const groupResponse = await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'test-webhook-secret'
    },
    body: JSON.stringify({
      update_id: 589,
      message: {
        message_id: 98,
        chat: { id: 'chat-1', type: 'group' },
        from: { id: 88 },
        photo: [{ file_id: 'group-photo' }]
      }
    })
  });
  assert.equal(groupResponse.status, 200);
  assert.deepEqual(await groupResponse.json(), { ok: true, ignored: true, reason: 'private_chat_required' });

  const duplicateResponse = await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'test-webhook-secret'
    },
    body: JSON.stringify(firstUpdateBody)
  });
  assert.equal(duplicateResponse.status, 200);
  assert.equal(telegramCalls.length, mediaUpdates.length, 'Telegram retries do not send duplicate privacy replies');
  assert.equal((await firstFailedResponse.json()).message, 'Telegram update could not be stored; please retry.');

  const unlinkedResponse = await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'test-webhook-secret'
    },
    body: JSON.stringify({
      update_id: 590,
      message: {
        message_id: 99,
        chat: { id: 'unknown-chat', type: 'private' },
        from: { id: 99 },
        document: { file_id: 'unknown-private-file.pdf' }
      }
    })
  });
  assert.equal(unlinkedResponse.status, 200);
  assert.deepEqual(await unlinkedResponse.json(), { ok: true, ignored: true, reason: 'linked_active_client_required' });
  assert.equal(telegramCalls.length, mediaUpdates.length);

  const senderMismatchResponse = await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'test-webhook-secret'
    },
    body: JSON.stringify({
      update_id: 591,
      message: {
        message_id: 100,
        chat: { id: 'chat-1', type: 'private' },
        from: { id: 999 },
        document: { file_id: 'mismatched-sender.pdf' }
      }
    })
  });
  assert.equal(senderMismatchResponse.status, 200);
  assert.deepEqual(await senderMismatchResponse.json(), { ok: true, ignored: true, reason: 'linked_user_mismatch' });
  assert.equal(telegramCalls.length, mediaUpdates.length);

  database.supabase.from = (table) => fakeQuery(table);
  const textResponse = await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'test-webhook-secret'
    },
    body: JSON.stringify({
      update_id: 600,
      message: {
        message_id: 74,
        date: 1792322402,
        chat: { id: 'chat-1', type: 'private' },
        text: 'Hello, I will send the documents through the portal.'
      }
    })
  });
  assert.equal(textResponse.status, 200);
  assert.deepEqual(await textResponse.json(), { ok: true });
  assert.equal(tables.telegram_messages.length, mediaUpdates.length);
  assert.equal(tables.telegram_messages.at(-1).body, 'Hello, I will send the documents through the portal.');
  assert.equal(telegramCalls.length, mediaUpdates.length);
});

test('Telegram sends a welcome then a private portal invitation and retries only the failed message', async (t) => {
  const oldFrom = database.supabase.from;
  const oldFetch = global.fetch;
  const envKeys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'CLIENT_PORTAL_URL'];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const telegramCalls = [];
  let failFirstPortalInvitation = true;
  const rawToken = 'first-start-token';
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  assert.equal(tables.client_portal_invites.length, 0);
  tables.clients.push({ id: 'client-welcome', name: 'Welcome Client', email: 'client@example.com', status: 'Active', telegram_chat_id: null, telegram_user_id: null });
  tables.telegram_link_tokens.push({
    id: 'link-welcome',
    client_id: 'client-welcome',
    token_hash: crypto.createHash('sha256').update(rawToken).digest('hex'),
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    created_by: 'staff-1',
    consumed_at: null,
  });
  database.supabase.from = (table) => fakeQuery(table);
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.CLIENT_PORTAL_URL = 'https://taxflow.example';
  global.fetch = async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:')) return oldFetch(url, init);
    const call = { url: String(url), body: JSON.parse(init.body) };
    assert.equal(tables.clients[0].telegram_chat_id, 'welcome-chat');
    assert.equal(tables.client_portal_invites.length, 1);
    telegramCalls.push(call);
    if (call.body.text.includes('#invite=') && failFirstPortalInvitation) {
      failFirstPortalInvitation = false;
      return new Response(JSON.stringify({ ok: false, description: 'Temporary Telegram failure' }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: telegramCalls.length } }), {
      headers: { 'content-type': 'application/json' }
    });
  };

  const app = express();
  app.use('/telegram', telegramRouter);
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = oldFrom;
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const updateBody = JSON.stringify({
    update_id: 801,
    message: {
      message_id: 91,
      date: 1792322400,
      text: `/start ${rawToken}`,
      chat: { id: 'welcome-chat', type: 'private' },
      from: { id: 902 },
    },
  });
  const sendUpdate = () => fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'test-webhook-secret',
    },
    body: updateBody,
  });

  const firstResponse = await sendUpdate();
  assert.equal(firstResponse.status, 503);
  assert.equal(tables.clients[0].telegram_chat_id, 'welcome-chat');
  assert.equal(tables.clients[0].telegram_user_id, '902');
  assert.equal(tables.client_portal_invites[0].client_id, 'client-welcome');
  assert.equal(tables.client_portal_invites[0].invited_email, 'client@example.com');
  assert.equal(tables.client_portal_invites[0].created_by, 'staff-1');
  assert.equal(telegramCalls.length, 2);
  assert.match(telegramCalls[0].body.text, /do not send tax, financial, identity, or other sensitive documents/i);
  assert.match(telegramCalls[0].body.text, /next message/i);
  assert.doesNotMatch(telegramCalls[0].body.text, /#invite=/);
  assert.match(telegramCalls[1].body.text, /https:\/\/taxflow\.example\/portal/);
  assert.match(telegramCalls[1].body.text, /same email address you gave your CA/i);
  assert.match(telegramCalls[1].body.text, /Create a password the first time/);
  assert.match(telegramCalls[1].body.text, /#invite=/);
  assert.equal(tables.telegram_messages.length, 2);
  assert.doesNotMatch(tables.telegram_messages[0].body, /#invite=/);
  assert.equal(tables.telegram_messages[0].delivery_status, 'sent');
  assert.match(tables.telegram_messages[1].body, /\[private client portal invitation link\]/);
  assert.doesNotMatch(tables.telegram_messages[1].body, /#invite=/);
  assert.equal(tables.telegram_messages[1].delivery_status, 'failed');

  const retryResponse = await sendUpdate();
  assert.equal(retryResponse.status, 200);
  assert.deepEqual(await retryResponse.json(), { ok: true, duplicate: true });
  assert.equal(telegramCalls.length, 3);
  assert.equal(telegramCalls[2].body.text, telegramCalls[1].body.text);
  assert.equal(tables.telegram_messages[0].delivery_status, 'sent');
  assert.equal(tables.telegram_messages[1].delivery_status, 'sent');

  const duplicateResponse = await sendUpdate();
  assert.equal(duplicateResponse.status, 200);
  assert.equal(telegramCalls.length, 3);
  assert.equal(tables.telegram_messages.length, 2);
});

test('Telegram diagnostics expect the separate relay when direct webhook registration is disabled', () => {
  const oldRelayUrl = process.env.TELEGRAM_WEBHOOK_RELAY_URL;
  const oldAutoConfigure = process.env.TELEGRAM_WEBHOOK_AUTO_CONFIGURE;
  process.env.TELEGRAM_WEBHOOK_AUTO_CONFIGURE = 'false';
  process.env.TELEGRAM_WEBHOOK_RELAY_URL = 'https://telegram-relay.example.com/telegram/webhook';
  try {
    assert.equal(
      telegramRouter._test.expectedWebhookUrl(),
      'https://telegram-relay.example.com/telegram/webhook'
    );
  } finally {
    if (oldRelayUrl === undefined) delete process.env.TELEGRAM_WEBHOOK_RELAY_URL;
    else process.env.TELEGRAM_WEBHOOK_RELAY_URL = oldRelayUrl;
    if (oldAutoConfigure === undefined) delete process.env.TELEGRAM_WEBHOOK_AUTO_CONFIGURE;
    else process.env.TELEGRAM_WEBHOOK_AUTO_CONFIGURE = oldAutoConfigure;
  }
});

test('Authenticated desktop sync lists only pending owned files and acknowledges verified copies', async (t) => {
  const oldFrom = database.supabase.from;
  const oldRpc = database.supabase.rpc;
  const oldStorageFrom = database.supabase.storage.from;
  const oldVaultPath = process.env.VAULT_PATH;
  const oldStorageBucket = process.env.SUPABASE_STORAGE_BUCKET;
  const fileBytes = Buffer.from('%PDF-1.7 sync download');
  const checksum = crypto.createHash('sha256').update(fileBytes).digest('hex');
  const ownerId = '11752602-62fa-4252-ae1d-23c4fb3b7312';
  const clientId = '20314145-9020-45f0-85a0-68bc63eb359e';
  const documentId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const localServerVault = fs.mkdtempSync(path.join(os.tmpdir(), 'taxflow-sync-vault-'));
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  tables.clients.push({ id: clientId, user_id: ownerId, name: 'Sync Client' });
  tables.documents_metadata.push({
    id: documentId,
    client_id: clientId,
    source: 'Portal',
    file_name: 'inbound.pdf',
    file_size_kb: fileBytes.length / 1024,
    file_sha256: checksum,
    created_at: '2026-10-18T12:00:00.000Z',
    storage_bucket: 'taxflow-intake',
    storage_object_path: `${ownerId}/${clientId}/2026/October/${documentId}_inbound.pdf`,
    mime_type: 'application/pdf',
    vault_path: 'supabase://taxflow-intake/owner/client/2026/October/inbound.pdf'
  });
  const legacyTelegramDocumentId = crypto.randomUUID();
  tables.documents_metadata.push({
    id: legacyTelegramDocumentId,
    client_id: clientId,
    source: 'Telegram',
    file_name: 'legacy-telegram.pdf',
    created_at: '2026-10-18T11:00:00.000Z',
    vault_path: 'legacy-local-file.pdf'
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
        created_at: '2026-10-18T12:00:00.000Z',
        source: 'Portal'
      }],
      error: null
    };
  };
  database.supabase.storage.from = (bucket) => ({
    async download(key) {
      assert.equal(bucket, 'taxflow-intake');
      assert.equal(key, `${ownerId}/${clientId}/2026/October/${documentId}_inbound.pdf`);
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
    source: 'Portal',
    year: '2026',
    month: 'October'
  }]);

  const listResponse = await fetch(baseUrl);
  assert.equal(listResponse.status, 200);
  const listedDocuments = await listResponse.json();
  assert.deepEqual(listedDocuments.data.map((document) => document.file_name), ['inbound.pdf']);

  const downloadResponse = await fetch(`${baseUrl}/${documentId}/serve`);
  assert.equal(downloadResponse.status, 200);
  assert.equal(Buffer.from(await downloadResponse.arrayBuffer()).toString(), fileBytes.toString());
  assert.equal(downloadResponse.headers.get('content-type'), 'application/pdf');

  const legacyTelegramDownload = await fetch(`${baseUrl}/${legacyTelegramDocumentId}/serve`);
  assert.equal(legacyTelegramDownload.status, 404);

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

test('Telegram file send and download endpoints permanently reject file transfers', async (t) => {
  const oldFrom = database.supabase.from;
  const oldGetUser = database.supabase.auth.getUser;
  const ownerId = '11752602-62fa-4252-ae1d-23c4fb3b7312';
  const clientId = '20314145-9020-45f0-85a0-68bc63eb359e';
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  tables.clients.push({
    id: clientId,
    user_id: ownerId,
    telegram_chat_id: 'telegram-chat-1'
  });
  database.supabase.from = (table) => fakeQuery(table);
  database.supabase.auth.getUser = async () => ({ data: { user: { id: ownerId } }, error: null });

  const app = express();
  app.use('/api/v1/telegram', (req, _res, next) => {
    req.headers.authorization = 'Bearer test-access-token';
    next();
  }, telegramRouter);
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = oldFrom;
    database.supabase.auth.getUser = oldGetUser;
  });

  const sendResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/api/v1/telegram/clients/${clientId}/send-file`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from('%PDF-1.7 sensitive document')
    }
  );
  assert.equal(sendResponse.status, 410);
  assert.match((await sendResponse.json()).message, /disabled/i);

  const downloadResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/api/v1/telegram/clients/${clientId}/messages/${crypto.randomUUID()}/download`,
    { method: 'POST' }
  );
  assert.equal(downloadResponse.status, 410);
  assert.match((await downloadResponse.json()).message, /disabled/i);
  assert.equal(tables.telegram_messages.length, 0);
});
