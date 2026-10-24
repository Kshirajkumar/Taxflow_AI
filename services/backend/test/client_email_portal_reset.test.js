const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SUPABASE_URL = 'https://client-email-reset-tests.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-placeholder';
process.env.CLIENT_PORTAL_URL = 'https://portal.example.test';

const database = require('../db/supabase');
const clientsRouter = require('../routes/clients');
const telegramRouter = require('../routes/telegram');

function createDatabaseMock(telegramChatId) {
  const tables = {
    clients: [{
      id: 'client-1',
      user_id: 'staff-1',
      name: 'Example Client',
      email: 'old-client@example.com',
      status: 'Active',
      telegram_chat_id: telegramChatId,
      supported_countries: null,
    }],
    client_portal_access: [{
      id: 'access-1',
      client_id: 'client-1',
      user_id: 'old-portal-user',
      invited_email: 'old-client@example.com',
      active: true,
      invitation_pending: false,
    }],
    client_portal_invites: [{
      id: 'invite-1',
      client_id: 'client-1',
      consumed_at: null,
      revoked_at: null,
    }],
  };

  function from(table) {
    let operation = 'select';
    let payload;
    let filters = [];
    const query = {
      select() { return this; },
      update(value) { operation = 'update'; payload = value; return this; },
      insert(value) { operation = 'insert'; payload = value; return this; },
      eq(field, value) { filters.push((row) => row[field] === value); return this; },
      is(field, value) { filters.push((row) => row[field] === value); return this; },
      maybeSingle() { return this.execute(true); },
      single() { return this.execute(true); },
      then(resolve, reject) { return this.execute(false).then(resolve, reject); },
      async execute(single) {
        const rows = tables[table] || [];
        if (operation === 'insert') {
          const inserted = { ...payload, id: `invite-${rows.length + 1}` };
          rows.push(inserted);
          return { data: single ? { ...inserted } : [{ ...inserted }], error: null };
        }
        const selected = rows.filter((row) => filters.every((filter) => filter(row)));
        if (operation === 'update') selected.forEach((row) => Object.assign(row, payload));
        const result = selected.map((row) => ({ ...row }));
        return { data: single ? result[0] || null : result, error: null };
      },
    };
    return query;
  }

  return { tables, from };
}

async function runEmailChange({ accountMetadata, deleteError = null, telegramChatId = null, telegramNotifier }) {
  const previousFrom = database.supabase.from;
  const previousGetUserById = database.supabase.auth.admin.getUserById;
  const previousDeleteUser = database.supabase.auth.admin.deleteUser;
  const previousTelegramNotifier = telegramRouter.notifyClientPortalEmailChanged;
  const mock = createDatabaseMock(telegramChatId);
  const deletedUsers = [];
  const notifications = [];
  if (telegramNotifier) {
    telegramRouter.notifyClientPortalEmailChanged = async (...args) => {
      notifications.push(args);
      return telegramNotifier(...args);
    };
  }
  database.supabase.from = mock.from;
  database.supabase.auth.admin.getUserById = async (userId) => ({
    data: { user: { id: userId, email: 'old-client@example.com', app_metadata: accountMetadata } },
    error: null,
  });
  database.supabase.auth.admin.deleteUser = async (userId) => {
    deletedUsers.push(userId);
    return { error: deleteError };
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'staff-1' };
    next();
  });
  app.use(clientsRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/client-1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new-client@example.com' }),
    });
    return {
      response,
      tables: mock.tables,
      deletedUsers,
      notifications,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = previousFrom;
    database.supabase.auth.admin.getUserById = previousGetUserById;
    database.supabase.auth.admin.deleteUser = previousDeleteUser;
    telegramRouter.notifyClientPortalEmailChanged = previousTelegramNotifier;
  }
}

test('changing a client email revokes old invitations, disconnects access, and deletes only the portal identity', async () => {
  const result = await runEmailChange({ accountMetadata: { taxflow_client_portal: true } });
  assert.equal(result.response.status, 200);
  const body = await result.response.json();
  assert.equal(body.data.portalAccessReset, true);
  assert.equal(body.data.email, 'new-client@example.com');
  assert.equal(body.data.portalInviteDeliveryStatus, 'telegram_not_linked');
  assert.match(body.data.portalAccessWarning, /no linked Telegram chat/i);
  assert.match(body.data.portalInviteLink, /^https:\/\/portal\.example\.test\/portal#invite=/);
  assert.equal(result.tables.client_portal_access[0].invited_email, 'new-client@example.com');
  assert.equal(result.tables.client_portal_access[0].user_id, null);
  assert.equal(result.tables.client_portal_access[0].active, true);
  assert.ok(result.tables.client_portal_invites[0].revoked_at);
  assert.equal(result.tables.client_portal_invites.length, 2);
  assert.equal(result.tables.client_portal_invites[1].token_ciphertext, undefined);
  assert.deepEqual(result.deletedUsers, ['old-portal-user']);
});

test('changing a client email never deletes a CA or staff auth identity', async () => {
  const result = await runEmailChange({ accountMetadata: { role: 'staff' } });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.deletedUsers, []);
  assert.equal(result.tables.client_portal_access[0].user_id, null);
});

test('email changes send a fresh invitation through the linked Telegram chat', async () => {
  const result = await runEmailChange({
    accountMetadata: { taxflow_client_portal: true },
    telegramChatId: 'telegram-chat-1',
    telegramNotifier: async (_client, notification) => {
      assert.equal(notification.previousEmail, 'old-client@example.com');
      assert.equal(notification.updatedEmail, 'new-client@example.com');
      assert.match(notification.invitationLink, /^https:\/\/portal\.example\.test\/portal#invite=/);
      return { sent: true };
    },
  });
  const body = await result.response.json();
  assert.equal(result.response.status, 200);
  assert.equal(body.data.portalInviteDeliveryStatus, 'sent');
  assert.equal(body.data.portalAccessWarning, '');
  assert.equal(result.notifications.length, 1);
  assert.ok(result.tables.client_portal_invites[1].token_ciphertext);
});

test('Telegram delivery failures preserve a copyable fresh invitation and report a warning', async () => {
  const result = await runEmailChange({
    accountMetadata: { taxflow_client_portal: true },
    telegramChatId: 'telegram-chat-1',
    telegramNotifier: async () => { throw new Error('Telegram unavailable'); },
  });
  const body = await result.response.json();
  assert.equal(result.response.status, 200);
  assert.equal(body.data.portalInviteDeliveryStatus, 'delivery_failed');
  assert.match(body.data.portalInviteLink, /^https:\/\/portal\.example\.test\/portal#invite=/);
  assert.match(body.data.portalAccessWarning, /could not be delivered automatically/i);
});

test('portal identity deletion failures report a warning while old portal access stays disconnected', async () => {
  const result = await runEmailChange({
    accountMetadata: { taxflow_client_portal: true },
    deleteError: { message: 'Deletion temporarily unavailable.' },
  });
  assert.equal(result.response.status, 200);
  const body = await result.response.json();
  assert.match(body.data.portalAccessWarning, /could not be deleted automatically/i);
  assert.equal(result.tables.client_portal_access[0].user_id, null);
  assert.equal(result.tables.client_portal_access[0].active, true);
});
