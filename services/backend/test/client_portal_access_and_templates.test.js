const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SUPABASE_URL = 'https://portal-tests.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-placeholder';

const database = require('../db/supabase');
const { requireAuth } = require('../middleware/requireAuth');
const { requireClientPortalAuth } = require('../middleware/requireClientPortalAuth');
const templatesRouter = require('../routes/templates');

function createDatabaseMock(initialRows = {}) {
  const tables = {
    client_portal_access: [],
    clients: [],
    message_templates: [],
    ...initialRows,
  };

  function queryFor(table) {
    let operation = 'select';
    let payload;
    const filters = [];
    const query = {
      select() { return this; },
      insert(value) { operation = 'insert'; payload = value; return this; },
      update(value) { operation = 'update'; payload = value; return this; },
      delete() { operation = 'delete'; return this; },
      eq(field, value) { filters.push((row) => row[field] === value); return this; },
      is(field, value) { filters.push((row) => row[field] === value); return this; },
      not(field, _operator, value) { filters.push((row) => row[field] !== value); return this; },
      limit() { return this; },
      order() { return this; },
      maybeSingle() { return this.execute(true); },
      single() { return this.execute(true); },
      then(resolve, reject) { return this.execute(false).then(resolve, reject); },
      async execute(single) {
        const rows = tables[table];
        if (operation === 'insert') {
          const inserted = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
            id: `id-${rows.length + 1}`,
            ...row,
          }));
          rows.push(...inserted);
          return { data: single ? inserted[0] : inserted, error: null };
        }
        const selected = rows.filter((row) => filters.every((filter) => filter(row)));
        if (operation === 'update') selected.forEach((row) => Object.assign(row, payload));
        if (operation === 'delete') {
          for (const row of selected) rows.splice(rows.indexOf(row), 1);
        }
        return { data: single ? selected[0] || null : selected, error: null };
      },
    };
    return query;
  }

  return { tables, from: queryFor };
}

async function withServer(app, callback) {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('portal auth requires a prior invitation claim and rejects other accounts', async () => {
  const previousFrom = database.supabase.from;
  const previousGetUser = database.supabase.auth.getUser;
  const mock = createDatabaseMock({
    client_portal_access: [{
      id: 'access-1',
      client_id: 'client-1',
      invited_email: 'client@example.com',
      user_id: 'auth-user-1',
      active: true,
    }],
    clients: [{
      id: 'client-1',
      name: 'Client One',
      email: 'client@example.com',
      status: 'Active',
    }],
  });
  database.supabase.from = mock.from;
  const app = express();
  app.get('/portal', (req, res, next) => {
    req.headers.authorization = 'Bearer test-token';
    next();
  }, requireClientPortalAuth, (req, res) => res.json({ clientId: req.portalClient.id }));

  try {
    await withServer(app, async (origin) => {
      database.supabase.auth.getUser = async () => ({
        data: { user: { id: 'auth-user-unclaimed', email: 'client@example.com', app_metadata: { taxflow_client_portal: true } } },
        error: null,
      });
      const unclaimedLogin = await fetch(`${origin}/portal`);
      assert.equal(unclaimedLogin.status, 403);
      assert.equal(mock.tables.client_portal_access[0].user_id, 'auth-user-1');

      database.supabase.auth.getUser = async () => ({
        data: { user: { id: 'auth-user-1', email: 'client@example.com', app_metadata: { taxflow_client_portal: true } } },
        error: null,
      });
      const firstLogin = await fetch(`${origin}/portal`);
      assert.equal(firstLogin.status, 200);
      assert.deepEqual(await firstLogin.json(), { clientId: 'client-1' });

      database.supabase.auth.getUser = async () => ({
        data: { user: { id: 'auth-user-2', email: 'client@example.com', app_metadata: { taxflow_client_portal: true } } },
        error: null,
      });
      const secondLogin = await fetch(`${origin}/portal`);
      assert.equal(secondLogin.status, 403);

      mock.tables.client_portal_access.push({
        id: 'access-2',
        client_id: 'client-2',
        invited_email: 'client@example.com',
        user_id: null,
        active: true,
      });
      database.supabase.auth.getUser = async () => ({
        data: { user: { id: 'auth-user-3', email: 'client@example.com' } },
        error: null,
      });
      const ambiguousLogin = await fetch(`${origin}/portal`);
      assert.equal(ambiguousLogin.status, 403);
      assert.match((await ambiguousLogin.json()).message, /not a client portal account/i);
    });
  } finally {
    database.supabase.from = previousFrom;
    database.supabase.auth.getUser = previousGetUser;
  }
});

test('portal identities cannot access staff routes even without an active client binding', async () => {
  const previousGetUser = database.supabase.auth.getUser;
  database.supabase.auth.getUser = async () => ({
    data: { user: { id: 'portal-user-1', email: 'client@example.com', app_metadata: { taxflow_client_portal: true } } },
    error: null,
  });
  const app = express();
  app.get('/staff', requireAuth, (_req, res) => res.json({ success: true }));

  try {
    await withServer(app, async (origin) => {
      const response = await fetch(`${origin}/staff`, {
        headers: { authorization: 'Bearer portal-token' },
      });
      assert.equal(response.status, 403);
      assert.match((await response.json()).message, /cannot access staff services/i);
    });
  } finally {
    database.supabase.auth.getUser = previousGetUser;
  }
});

test('staff routes do not require a client portal access-table lookup', async () => {
  const previousGetUser = database.supabase.auth.getUser;
  const previousFrom = database.supabase.from;
  database.supabase.from = () => {
    throw new Error('Staff auth must not query the client portal table.');
  };
  database.supabase.auth.getUser = async () => ({
    data: { user: { id: 'staff-user-1', email: 'staff@example.com', app_metadata: {} } },
    error: null,
  });
  const app = express();
  app.get('/staff', requireAuth, (req, res) => res.json({ success: true, userId: req.user.id }));

  try {
    await withServer(app, async (origin) => {
      const response = await fetch(`${origin}/staff`, {
        headers: { authorization: 'Bearer staff-token' },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true, userId: 'staff-user-1' });
    });
  } finally {
    database.supabase.auth.getUser = previousGetUser;
    database.supabase.from = previousFrom;
  }
});

test('template listing seeds the protected secure portal invitation', async () => {
  const previousFrom = database.supabase.from;
  const previousGetUser = database.supabase.auth.getUser;
  const mock = createDatabaseMock();
  database.supabase.from = mock.from;
  database.supabase.auth.getUser = async () => ({
    data: { user: { id: 'staff-1', email: 'staff@example.com' } },
    error: null,
  });
  const app = express();
  app.use('/api/v1/templates', templatesRouter);

  try {
    await withServer(app, async (origin) => {
      const response = await fetch(`${origin}/api/v1/templates`, {
        headers: { authorization: 'Bearer staff-token' },
      });
      assert.equal(response.status, 200);
      const templates = (await response.json()).data;
      const invitation = templates.find((template) => template.template_key === 'portal_invite');
      assert.ok(invitation);
      assert.equal(invitation.name, 'Secure portal invitation');
      assert.equal(invitation.protected, true);
      assert.match(invitation.body, /\{portalLink\}/);
      assert.match(invitation.body, /same email address your CA has on file/i);
      assert.match(invitation.body, /do not send .* documents in Telegram/i);
      assert.equal(mock.tables.message_templates.length, 4);
    });
  } finally {
    database.supabase.from = previousFrom;
    database.supabase.auth.getUser = previousGetUser;
  }
});

test('template creation adds the portal link and protected defaults cannot be deleted', async () => {
  const previousFrom = database.supabase.from;
  const previousGetUser = database.supabase.auth.getUser;
  const mock = createDatabaseMock({
    message_templates: [{
      id: 'core-template',
      user_id: 'staff-1',
      name: 'Protected core',
      cat: 'Utility',
      body: 'Upload here: {portalLink}',
      protected: true,
    }],
  });
  database.supabase.from = mock.from;
  database.supabase.auth.getUser = async () => ({
    data: { user: { id: 'staff-1', email: 'staff@example.com' } },
    error: null,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/templates', templatesRouter);

  try {
    await withServer(app, async (origin) => {
      const createdResponse = await fetch(`${origin}/api/v1/templates`, {
        method: 'POST',
        headers: { authorization: 'Bearer staff-token', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Custom message', body: 'Hello {name}.' }),
      });
      assert.equal(createdResponse.status, 201);
      const created = (await createdResponse.json()).data;
      assert.match(created.body, /\{portalLink\}/);
      assert.equal(created.protected, false);
      assert.equal(created.user_id, 'staff-1');

      const deleteResponse = await fetch(`${origin}/api/v1/templates/core-template`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer staff-token' },
      });
      assert.equal(deleteResponse.status, 403);

      const invalidResponse = await fetch(`${origin}/api/v1/templates`, {
        method: 'POST',
        headers: { authorization: 'Bearer staff-token', 'content-type': 'application/json' },
        body: JSON.stringify({ name: '', body: '' }),
      });
      assert.equal(invalidResponse.status, 400);
    });
  } finally {
    database.supabase.from = previousFrom;
    database.supabase.auth.getUser = previousGetUser;
  }
});
