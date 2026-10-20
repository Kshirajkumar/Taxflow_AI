const crypto = require('node:crypto');
const { supabase } = require('../db/supabase');

const INVITATION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function hashInviteToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function deriveTelegramPortalInviteToken(telegramToken) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Portal invitation signing is not configured.');
  return crypto.createHmac('sha256', secret)
    .update(`taxflow-client-portal-invite-v1:${telegramToken}`)
    .digest('base64url');
}

async function createClientPortalInvite({ clientId, email, createdBy, token = crypto.randomBytes(32).toString('base64url') }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Add a valid email address to this client before creating a portal invitation.');
  }
  await revokeClientPortalInvites(clientId);
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS).toISOString();
  const { data, error } = await supabase.from('client_portal_invites')
    .insert({
      client_id: clientId,
      invited_email: normalizedEmail,
      token_hash: hashInviteToken(token),
      expires_at: expiresAt,
      created_by: createdBy || null,
    })
    .select('id, expires_at')
    .single();
  if (error) throw error;
  return { token, expiresAt: data.expires_at, id: data.id };
}

async function revokeClientPortalInvites(clientId) {
  const { error } = await supabase.from('client_portal_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .is('consumed_at', null)
    .is('revoked_at', null);
  if (error) throw error;
}

module.exports = {
  createClientPortalInvite,
  deriveTelegramPortalInviteToken,
  hashInviteToken,
  revokeClientPortalInvites,
};
