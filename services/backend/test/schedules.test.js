const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SUPABASE_URL = 'https://schedule-tests.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-placeholder';

const database = require('../db/supabase');
const schedulesRouter = require('../routes/schedules');

function createDatabaseMock({ linked = true } = {}) {
  const tables = {
    clients: [{
      id: 'client-1',
      user_id: 'staff-1',
      name: 'Example Client',
      email: 'client@example.com',
      country_id: 'country-in',
      status: 'Active',
      telegram_chat_id: linked ? 'private-chat-1' : null,
    }],
    supported_country_timezones: [
      { country_id: 'country-in', timezone_name: 'Asia/Kolkata', is_default: true },
      { country_id: 'country-us', timezone_name: 'America/New_York', is_default: true },
    ],
    message_templates: [
      { id: 'template-1', user_id: null },
      { id: 'template-private-other', user_id: 'staff-2' },
    ],
    telegram_message_schedules: [],
  };

  function from(table) {
    let operation = 'select';
    let payload;
    const filters = [];
    const query = {
      select() { return this; },
      insert(value) { operation = 'insert'; payload = value; return this; },
      update(value) { operation = 'update'; payload = value; return this; },
      eq(field, value) { filters.push((row) => row[field] === value); return this; },
      in(field, values) { filters.push((row) => values.includes(row[field])); return this; },
      order() { return this; },
      limit() { return this; },
      maybeSingle() { return this.execute(true); },
      single() { return this.execute(true); },
      then(resolve, reject) { return this.execute(false).then(resolve, reject); },
      async execute(single) {
        const rows = tables[table] || [];
        if (operation === 'insert') {
          const inserted = { id: `schedule-${rows.length + 1}`, ...payload };
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

async function withSchedulesServer(t, options, callback) {
  const previousFrom = database.supabase.from;
  const mock = createDatabaseMock(options);
  database.supabase.from = mock.from;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'staff-1' };
    next();
  });
  app.use('/api/v1/schedules', schedulesRouter);
  const server = app.listen(0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.from = previousFrom;
  });
  await callback(`http://127.0.0.1:${server.address().port}`, mock);
}

test('schedule timezone route returns supported country clocks metadata', async (t) => {
  await withSchedulesServer(t, {}, async (origin) => {
    const response = await fetch(`${origin}/api/v1/schedules/timezones`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data[0].timezone_name, 'Asia/Kolkata');
  });
});

test('CA can create a daily reminder for a linked owned client in its selected country zone', async (t) => {
  await withSchedulesServer(t, {}, async (origin, mock) => {
    const response = await fetch(`${origin}/api/v1/schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-1',
        templateId: 'template-1',
        messageBody: 'Hello {name}, please upload documents at {portalLink}',
        repeatMode: 'daily',
        timezoneName: 'Asia/Kolkata',
        localTime: '20:00',
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.data.repeat_mode, 'daily');
    assert.equal(body.data.local_time, '20:00');
    assert.equal(body.data.timezone_name, 'Asia/Kolkata');
    assert.equal(body.data.client.name, 'Example Client');
    assert.equal(mock.tables.telegram_message_schedules.length, 1);

    const listResponse = await fetch(`${origin}/api/v1/schedules`);
    const list = await listResponse.json();
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].client.name, 'Example Client');
  });
});

test('schedule creation rejects another country zone and unlinked Telegram clients', async (t) => {
  await withSchedulesServer(t, {}, async (origin) => {
    const invalidTimezone = await fetch(`${origin}/api/v1/schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-1',
        messageBody: 'Reminder',
        repeatMode: 'daily',
        timezoneName: 'America/New_York',
        localTime: '20:00',
      }),
    });
    assert.equal(invalidTimezone.status, 400);

    const unlinkedMock = createDatabaseMock({ linked: false });
    const previousFrom = database.supabase.from;
    database.supabase.from = unlinkedMock.from;
    try {
      const unlinked = await fetch(`${origin}/api/v1/schedules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: 'client-1',
          messageBody: 'Reminder',
          repeatMode: 'daily',
          timezoneName: 'Asia/Kolkata',
          localTime: '20:00',
        }),
      });
      assert.equal(unlinked.status, 422);
    } finally {
      database.supabase.from = previousFrom;
    }
  });
});

test('CA can cancel only their own active schedule', async (t) => {
  await withSchedulesServer(t, {}, async (origin, mock) => {
    mock.tables.telegram_message_schedules.push({
      id: 'schedule-existing',
      owner_user_id: 'staff-1',
      status: 'active',
    });
    const response = await fetch(`${origin}/api/v1/schedules/schedule-existing`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.equal(mock.tables.telegram_message_schedules[0].status, 'cancelled');
  });
});
