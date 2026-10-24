const crypto = require('node:crypto');
const { supabase } = require('../db/supabase');

const INVITATION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function hashInviteToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getClientPortalInvitationLink(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
    throw new Error('A valid client portal invitation is required.');
  }
  const configuredUrl = String(process.env.CLIENT_PORTAL_URL || '').trim();
  if (!configuredUrl) throw new Error('CLIENT_PORTAL_URL is not configured.');
  const portalUrl = new URL(configuredUrl);
  if (process.env.NODE_ENV === 'production' && portalUrl.protocol !== 'https:') {
    throw new Error('CLIENT_PORTAL_URL must use HTTPS in production.');
  }
  if (portalUrl.username || portalUrl.password || portalUrl.search || portalUrl.hash || portalUrl.pathname !== '/') {
    throw new Error('CLIENT_PORTAL_URL must be the website origin without a path or credentials.');
  }
  return `${portalUrl.origin}/portal#invite=${encodeURIComponent(token)}`;
}

function getPortalInviteEncryptionKey() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Portal invitation encryption is not configured.');
  return crypto.createHash('sha256').update(`taxflow-client-portal-token-encryption-v1:${secret}`).digest();
}

function encryptPortalInviteToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getPortalInviteEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptPortalInviteToken(encryptedToken) {
  const [version, ivValue, tagValue, encryptedValue, ...extra] = String(encryptedToken || '').split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue || extra.length) {
    throw new Error('Stored portal invitation token is invalid.');
  }
  const iv = Buffer.from(ivValue, 'base64url');
  const authTag = Buffer.from(tagValue, 'base64url');
  const encrypted = Buffer.from(encryptedValue, 'base64url');
  if (iv.length !== 12 || authTag.length !== 16 || encrypted.length === 0) {
    throw new Error('Stored portal invitation token is invalid.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getPortalInviteEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function deriveTelegramPortalInviteToken(telegramToken) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Portal invitation signing is not configured.');
  return crypto.createHmac('sha256', secret)
    .update(`taxflow-client-portal-invite-v1:${telegramToken}`)
    .digest('base64url');
}

async function createClientPortalInvite({ clientId, email, createdBy, token = crypto.randomBytes(32).toString('base64url'), storeEncryptedToken = false }) {
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
      ...(storeEncryptedToken ? { token_ciphertext: encryptPortalInviteToken(token) } : {}),
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
  encryptPortalInviteToken,
  decryptPortalInviteToken,
  deriveTelegramPortalInviteToken,
  getClientPortalInvitationLink,
  hashInviteToken,
  revokeClientPortalInvites,
};
