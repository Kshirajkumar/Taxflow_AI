const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');

process.env.SUPABASE_URL = 'https://portal-invitation-tests.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-placeholder';
process.env.CLIENT_PORTAL_URL = 'https://portal.example.com';

const database = require('../db/supabase');
const { decryptPortalInviteToken, encryptPortalInviteToken, hashInviteToken } = require('../lib/clientPortalInvites');
const portalRouter = require('../routes/clientPortal');

function createDatabaseMock(rows) {
  return (table) => {
    let filters = [];
    let payload;
    let operation = 'select';
    const query = {
      select() { return this; },
      insert(value) { operation = 'insert'; payload = value; return this; },
      update(value) { operation = 'update'; payload = value; return this; },
      eq(field, value) { filters.push((row) => row[field] === value); return this; },
      is(field, value) { filters.push((row) => row[field] === value); return this; },
      maybeSingle() { return this.execute(true); },
      single() { return this.execute(true); },
      then(resolve, reject) { return this.execute(false).then(resolve, reject); },
      async execute(single) {
        const records = rows[table] || [];
        if (operation === 'insert') {
          const inserted = { id: `new-${records.length + 1}`, ...payload };
          records.push(inserted);
          return { data: single ? inserted : [inserted], error: null };
        }
        const matching = records.filter((row) => filters.every((filter) => filter(row)));
        if (operation === 'update') matching.forEach((row) => Object.assign(row, payload));
        return { data: single ? matching[0] || null : matching, error: null };
      },
    };
    return query;
  };
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

test('portal invitation tokens are authenticated-encrypted for server-side reuse', () => {
  const token = crypto.randomBytes(32).toString('base64url');
  const encrypted = encryptPortalInviteToken(token);
  assert.notEqual(encrypted, token);
  assert.match(encrypted, /^v1\./);
  assert.equal(decryptPortalInviteToken(encrypted), token);
  const [version, iv, authTag, ciphertext] = encrypted.split('.');
  const tamperedCiphertext = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`;
  assert.throws(() => decryptPortalInviteToken([version, iv, authTag, tamperedCiphertext].join('.')));
});

test('portal invitation registration checks the exact email and blocks replayed invitations', async () => {
  const oldFrom = database.supabase.from;
  const oldRpc = database.supabase.rpc;
  const oldCreateUser = database.supabase.auth.admin.createUser;
  const oldUpdateUser = database.supabase.auth.admin.updateUserById;
  const oldDeleteUser = database.supabase.auth.admin.deleteUser;
  const oldGetUserById = database.supabase.auth.admin.getUserById;
  const token = crypto.randomBytes(32).toString('base64url');
  const rows = {
    client_portal_invites: [{
      id: 'invite-1',
      client_id: 'client-1',
      invited_email: 'client@example.com',
      token_hash: hashInviteToken(token),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      consumed_at: null,
      revoked_at: null,
    }],
    clients: [{ id: 'client-1', email: 'client@example.com', status: 'Active' }],
  };
  const createdUsers = [];
  const markedUsers = [];
  const passwordUpdates = [];
  const rpcCalls = [];
  let existingAccountMode = false;
  database.supabase.from = createDatabaseMock(rows);
  database.supabase.rpc = async (functionName, args) => {
    rpcCalls.push({ functionName, args });
    if (functionName === 'claim_client_portal_invite') {
      const claimedInvite = rows.client_portal_invites.find((invite) => invite.token_hash === args.p_token_hash);
      if (claimedInvite) claimedInvite.consumed_at = new Date().toISOString();
      return { data: [{ client_id: 'client-1', invited_email: 'client@example.com' }], error: null };
    }
    if (functionName === 'find_client_portal_auth_user') return { data: 'legacy-portal-user', error: null };
    assert.equal(functionName, 'consume_api_rate_limit');
    return { data: { allowed: true, retry_after_seconds: 1 }, error: null };
  };
  database.supabase.auth.admin.createUser = async (attributes) => {
    createdUsers.push(attributes);
    if (existingAccountMode) {
      return { data: { user: null }, error: { status: 422, code: 'email_exists', message: 'Email already exists.' } };
    }
    return {
      data: { user: { id: 'client-auth-user', email: attributes.email, app_metadata: attributes.app_metadata } },
      error: null,
    };
  };
  database.supabase.auth.admin.updateUserById = async (userId, attributes) => {
    if (userId === 'legacy-portal-user') passwordUpdates.push({ userId, attributes });
    else markedUsers.push({ userId, attributes });
    return {
      data: { user: { id: userId, email: 'client@example.com', app_metadata: attributes.app_metadata } },
      error: null,
    };
  };
  database.supabase.auth.admin.deleteUser = async () => ({ error: null });
  database.supabase.auth.admin.getUserById = async (userId) => ({
    data: { user: { id: userId, email: 'client@example.com', app_metadata: { taxflow_client_portal: true } } },
    error: null,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/v1/client-portal', portalRouter);
  try {
    await withServer(app, async (origin) => {
      const availableStatus = await fetch(`${origin}/api/v1/client-portal/invitations/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      assert.equal(availableStatus.status, 200);
      assert.deepEqual((await availableStatus.json()).data, { alreadyClaimed: false });

      const validateResponse = await fetch(`${origin}/api/v1/client-portal/invitations/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email: ' CLIENT@example.com ' }),
      });
      assert.equal(validateResponse.status, 200);
      assert.deepEqual((await validateResponse.json()).data, { email: 'client@example.com' });

      const wrongEmail = await fetch(`${origin}/api/v1/client-portal/invitations/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email: 'other@example.com' }),
      });
      assert.equal(wrongEmail.status, 400);

      const expiredInvite = rows.client_portal_invites[0];
      expiredInvite.expires_at = new Date(Date.now() - 1_000).toISOString();
      const expired = await fetch(`${origin}/api/v1/client-portal/invitations/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email: 'client@example.com' }),
      });
      assert.equal(expired.status, 400);
      expiredInvite.expires_at = new Date(Date.now() + 60_000).toISOString();

      const invalidPassword = await fetch(`${origin}/api/v1/client-portal/invitations/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email: 'client@example.com', password: 'short' }),
      });
      assert.equal(invalidPassword.status, 400);
      assert.equal(createdUsers.length, 0);

      const registration = await fetch(`${origin}/api/v1/client-portal/invitations/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email: 'client@example.com', password: 'long-enough-password-123' }),
      });
      assert.equal(registration.status, 201);
      assert.deepEqual(createdUsers, [{
        email: 'client@example.com',
        password: 'long-enough-password-123',
        email_confirm: true,
      }]);
      assert.deepEqual(markedUsers, [{
        userId: 'client-auth-user',
        attributes: { app_metadata: { taxflow_client_portal: true } },
      }]);
      assert.equal(rpcCalls.filter((call) => call.functionName === 'claim_client_portal_invite').length, 1);

      const claimedStatus = await fetch(`${origin}/api/v1/client-portal/invitations/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      assert.equal(claimedStatus.status, 200);
      assert.deepEqual((await claimedStatus.json()).data, { alreadyClaimed: true });

      const unknownTokenStatus = await fetch(`${origin}/api/v1/client-portal/invitations/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: crypto.randomBytes(32).toString('base64url') }),
      });
      assert.equal(unknownTokenStatus.status, 200);
      assert.deepEqual((await unknownTokenStatus.json()).data, { alreadyClaimed: false });

      const replayedValidation = await fetch(`${origin}/api/v1/client-portal/invitations/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email: 'client@example.com' }),
      });
      assert.equal(replayedValidation.status, 409);
      assert.equal((await replayedValidation.json()).code, 'invitation_already_claimed');

      const replayedWithWrongEmail = await fetch(`${origin}/api/v1/client-portal/invitations/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email: 'other@example.com' }),
      });
      assert.equal(replayedWithWrongEmail.status, 400);
      assert.equal((await replayedWithWrongEmail.json()).code, undefined);

      const replayedRegistration = await fetch(`${origin}/api/v1/client-portal/invitations/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email: 'client@example.com', password: 'replacement-password-456' }),
      });
      assert.equal(replayedRegistration.status, 409);
      assert.equal((await replayedRegistration.json()).code, 'invitation_already_claimed');

      const existingInviteToken = crypto.randomBytes(32).toString('base64url');
      rows.client_portal_invites.push({
        id: 'invite-2',
        client_id: 'client-1',
        invited_email: 'client@example.com',
        token_hash: hashInviteToken(existingInviteToken),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        consumed_at: null,
        revoked_at: null,
      });
      existingAccountMode = true;
      const existingAccountRegistration = await fetch(`${origin}/api/v1/client-portal/invitations/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: existingInviteToken, email: 'client@example.com', password: 'replacement-password-456' }),
      });
      assert.equal(existingAccountRegistration.status, 201);
      assert.deepEqual(passwordUpdates, [{
        userId: 'legacy-portal-user',
        attributes: {
          password: 'replacement-password-456',
          email_confirm: true,
          app_metadata: { taxflow_client_portal: true },
        },
      }]);
    });
  } finally {
    database.supabase.from = oldFrom;
    database.supabase.rpc = oldRpc;
    database.supabase.auth.admin.createUser = oldCreateUser;
    database.supabase.auth.admin.updateUserById = oldUpdateUser;
    database.supabase.auth.admin.deleteUser = oldDeleteUser;
    database.supabase.auth.admin.getUserById = oldGetUserById;
  }
});
