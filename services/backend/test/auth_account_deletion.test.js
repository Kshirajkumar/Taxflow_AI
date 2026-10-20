const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SUPABASE_URL = 'https://account-deletion-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

const database = require('../db/supabase');
const authRouter = require('../routes/auth');

test('account deletion requires configured cloud storage, exact phrase, and a valid password challenge', async (t) => {
  const previousBucket = process.env.SUPABASE_STORAGE_BUCKET;
  const originalGetUser = database.supabase.auth.getUser;
  const originalFrom = database.supabase.from;
  database.supabase.auth.getUser = async () => ({
    data: { user: { id: '11752602-62fa-4252-ae1d-23c4fb3b7312', email: 'user@example.com' } },
    error: null
  });
  database.supabase.from = (table) => {
    if (table !== 'client_portal_access') return originalFrom(table);
    return {
      select() { return this; },
      eq() { return this; },
      limit() { return this; },
      async maybeSingle() { return { data: null, error: null }; }
    };
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.supabase.auth.getUser = originalGetUser;
    database.supabase.from = originalFrom;
    if (previousBucket === undefined) delete process.env.SUPABASE_STORAGE_BUCKET;
    else process.env.SUPABASE_STORAGE_BUCKET = previousBucket;
  });

  const url = `http://127.0.0.1:${server.address().port}/api/v1/auth/delete-account/confirm`;
  const request = (body) => fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer valid-test-session', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  delete process.env.SUPABASE_STORAGE_BUCKET;
  const missingBucket = await request({ confirmation: 'DELETE MY ACCOUNT', challenge: 'invalid' });
  assert.equal(missingBucket.status, 503);
  assert.match((await missingBucket.json()).message, /SUPABASE_STORAGE_BUCKET/);

  process.env.SUPABASE_STORAGE_BUCKET = 'taxflow-intake';
  const wrongPhrase = await request({ confirmation: 'delete my account', challenge: 'invalid' });
  assert.equal(wrongPhrase.status, 400);

  const invalidChallenge = await request({ confirmation: 'DELETE MY ACCOUNT', challenge: 'invalid' });
  assert.equal(invalidChallenge.status, 401);
});
