const crypto = require('node:crypto');
const express = require('express');
const path = require('node:path');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { requireAuth } = require('../middleware/requireAuth');
const { requireClientPortalAuth } = require('../middleware/requireClientPortalAuth');
const { assertOwnedClient } = require('../lib/ownership');
const { consume, RateLimiterUnavailableError } = require('../lib/rateLimiter');
const {
  createClientPortalInvite,
  deriveTelegramPortalInviteToken,
  getClientPortalInvitationLink,
  hashInviteToken,
  revokeClientPortalInvites,
} = require('../lib/clientPortalInvites');
const {
  getStorageBucket,
  getStorageObjectKey,
  normalizeMimeType,
  sha256
} = require('../lib/documentStorage');

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const PORTAL_INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;
const FILE_TYPES = new Map([
  ['.pdf', { fileType: 'PDF', mimeTypes: ['application/pdf'], signature: buffer => buffer.subarray(0, 5).toString('ascii') === '%PDF-' }],
  ['.png', { fileType: 'PNG', mimeTypes: ['image/png'], signature: buffer => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ['.jpg', { fileType: 'JPG', mimeTypes: ['image/jpeg'], signature: buffer => buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 }],
  ['.jpeg', { fileType: 'JPEG', mimeTypes: ['image/jpeg'], signature: buffer => buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 }],
  ['.webp', { fileType: 'WEBP', mimeTypes: ['image/webp'], signature: buffer => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' }],
  ['.csv', { fileType: 'CSV', mimeTypes: ['text/csv', 'text/plain', 'application/vnd.ms-excel'], signature: buffer => !buffer.includes(0) }],
  ['.xlsx', {
    fileType: 'XLSX',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    signature: buffer => buffer.subarray(0, 4).toString('hex') === '504b0304'
      && buffer.includes(Buffer.from('xl/workbook.xml'))
      && !buffer.includes(Buffer.from('vbaProject.bin'))
  }]
]);

function normalizePortalFileName(value) {
  const original = String(value || '').replace(/\\/g, '/');
  const baseName = path.posix.basename(original).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!baseName || baseName === '.' || baseName === '..' || baseName.length > 180) {
    throw new Error('Choose a file with a name under 180 characters.');
  }
  return baseName;
}

function normalizePortalEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidPortalEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

async function consumeInvitationRateLimit(req, res, purpose) {
  try {
    const result = await consume(`client-portal:${purpose}:${req.ip || 'unknown'}`, 12, 60 * 60);
    if (result.allowed) return true;
    res.set('Retry-After', String(result.retryAfterSeconds));
    res.status(429).json({ success: false, message: 'Too many attempts. Please wait a while and try again.' });
    return false;
  } catch (error) {
    if (error instanceof RateLimiterUnavailableError) {
      res.status(error.status).json({ success: false, message: 'Portal sign-in protection is temporarily unavailable. Please try again shortly.' });
      return false;
    }
    throw error;
  }
}

async function inspectPortalInvite(token, email) {
  if (typeof token !== 'string' || !PORTAL_INVITE_TOKEN_PATTERN.test(token) || !isValidPortalEmail(email)) {
    return { status: 'invalid' };
  }
  const { data: invite, error: inviteError } = await supabase.from('client_portal_invites')
    .select('id, client_id, invited_email, expires_at, consumed_at, revoked_at')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle();
  if (inviteError) throw inviteError;
  if (
    !invite
    || normalizePortalEmail(invite.invited_email) !== email
  ) return { status: 'invalid' };

  const { data: client, error: clientError } = await supabase.from('clients')
    .select('id, email, status')
    .eq('id', invite.client_id)
    .maybeSingle();
  if (clientError) throw clientError;
  if (
    !client
    || client.status !== 'Active'
    || normalizePortalEmail(client.email) !== email
  ) return { status: 'invalid' };

  if (invite.consumed_at) return { status: 'already_claimed' };
  if (invite.revoked_at || new Date(invite.expires_at).getTime() <= Date.now()) {
    return { status: 'invalid' };
  }
  return { status: 'valid', invite };
}

function sendAlreadyClaimedInvitation(res) {
  return res.status(409).json({
    success: false,
    code: 'invitation_already_claimed',
    message: 'Your portal account has already been created. Sign in with the email address and password you chose to upload documents.',
  });
}

router.post('/invitations/status', async (req, res) => {
  try {
    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Client portal enrollment is temporarily unavailable.' });
    }
    if (!(await consumeInvitationRateLimit(req, res, 'status'))) return;
    const token = req.body?.token;
    let alreadyClaimed = false;
    let clientEmailChanged = false;
    if (typeof token === 'string' && PORTAL_INVITE_TOKEN_PATTERN.test(token)) {
      const { data: invite, error } = await supabase.from('client_portal_invites')
        .select('client_id, invited_email, consumed_at')
        .eq('token_hash', hashInviteToken(token))
        .maybeSingle();
      if (error) throw error;
      if (invite) {
        const { data: client, error: clientError } = await supabase.from('clients')
          .select('email, status')
          .eq('id', invite.client_id)
          .maybeSingle();
        if (clientError) throw clientError;
        const emailStillMatches = Boolean(
          client?.status === 'Active'
          && normalizePortalEmail(client.email) === normalizePortalEmail(invite.invited_email)
        );
        alreadyClaimed = Boolean(invite.consumed_at && emailStillMatches);
        clientEmailChanged = Boolean(client?.status === 'Active' && !emailStillMatches);
      }
    }
    return res.json({ success: true, data: { alreadyClaimed, clientEmailChanged } });
  } catch (error) {
    if (error instanceof RateLimiterUnavailableError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Client Portal] Invitation status check failed:', error.message);
    return res.status(503).json({ success: false, message: 'The invitation status could not be checked. Please try again shortly.' });
  }
});

async function claimPortalInvite(user, token) {
  if (
    !user?.id
    || user.app_metadata?.taxflow_client_portal !== true
    || typeof token !== 'string'
    || !PORTAL_INVITE_TOKEN_PATTERN.test(token)
  ) {
    return { error: 'This invitation cannot be used with this account.' };
  }
  const { data, error } = await supabase.rpc('claim_client_portal_invite', {
    p_user_id: user.id,
    p_token_hash: hashInviteToken(token),
  });
  if (error) {
    console.error('[Client Portal] Invitation claim failed:', error.message);
    return { error: 'This invitation is invalid, expired, already used, or does not match this account.' };
  }
  const claimed = Array.isArray(data) ? data[0] : data;
  if (!claimed?.client_id || normalizePortalEmail(claimed.invited_email) !== normalizePortalEmail(user.email)) {
    return { error: 'This invitation could not be connected to the client account.' };
  }
  return { data: claimed };
}

async function getAuthenticatedPortalUser(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

function validateFile(buffer, fileName, declaredMimeType) {
  const extension = path.extname(fileName).toLowerCase();
  const definition = FILE_TYPES.get(extension);
  if (!definition) {
    throw Object.assign(new Error('Upload a PDF, PNG, JPG, WEBP, CSV, or XLSX file.'), { status: 415 });
  }

  const mimeType = normalizeMimeType(declaredMimeType);
  if (mimeType !== 'application/octet-stream' && !definition.mimeTypes.includes(mimeType)) {
    throw Object.assign(new Error('The file type does not match its filename.'), { status: 415 });
  }
  if (!definition.signature(buffer)) {
    throw Object.assign(new Error('The uploaded file content does not match a supported file format.'), { status: 415 });
  }
  return { fileType: definition.fileType, mimeType: mimeType === 'application/octet-stream' ? definition.mimeTypes[0] : mimeType };
}

async function requireStaffClient(req, res) {
  if (!isConnected || !supabase) {
    res.status(503).json({ success: false, message: 'Client portal administration is temporarily unavailable.' });
    return null;
  }
  if (!(await assertOwnedClient(req.user.id, req.params.clientId))) {
    res.status(404).json({ success: false, message: 'Client not found.' });
    return null;
  }
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, email, status')
    .eq('id', req.params.clientId)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    res.status(404).json({ success: false, message: 'Client not found.' });
    return null;
  }
  return data;
}

router.get('/clients/:clientId/access', requireAuth, async (req, res) => {
  try {
    const client = await requireStaffClient(req, res);
    if (!client) return;
    const { data, error } = await supabase
      .from('client_portal_access')
      .select('active, user_id, invited_email, created_at')
      .eq('client_id', client.id)
      .maybeSingle();
    if (error) throw error;
    return res.json({
      success: true,
      data: {
        enabled: Boolean(
          data?.active
          && String(data.invited_email || '').toLowerCase() === String(client.email || '').trim().toLowerCase()
        ),
        linked: Boolean(data?.active && data.user_id),
        email: client.email || null,
        createdAt: data?.created_at || null
      }
    });
  } catch (error) {
    console.error('[Client Portal] Could not load client access:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load this client’s portal access.' });
  }
});

router.post('/invitations/validate', async (req, res) => {
  try {
    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Client portal enrollment is temporarily unavailable.' });
    }
    if (!(await consumeInvitationRateLimit(req, res, 'validate'))) return;
    const token = req.body?.token;
    const email = normalizePortalEmail(req.body?.email);
    const invitation = await inspectPortalInvite(token, email);
    if (invitation.status === 'already_claimed') return sendAlreadyClaimedInvitation(res);
    if (invitation.status !== 'valid') {
      return res.status(400).json({ success: false, message: 'This invitation is invalid or expired. Ask your CA to send you a new portal link.' });
    }
    return res.json({ success: true, data: { email } });
  } catch (error) {
    if (error instanceof RateLimiterUnavailableError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Client Portal] Invitation validation failed:', error.message);
    return res.status(503).json({ success: false, message: 'The invitation could not be checked. Please try again shortly.' });
  }
});

router.post('/invitations/register', async (req, res) => {
  let createdUserId = null;
  let createdNewUser = false;
  try {
    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Client portal enrollment is temporarily unavailable.' });
    }
    if (!(await consumeInvitationRateLimit(req, res, 'register'))) return;
    const token = req.body?.token;
    const email = normalizePortalEmail(req.body?.email);
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      return res.status(400).json({ success: false, message: 'Choose a password between 12 and 128 characters.' });
    }
    const invitation = await inspectPortalInvite(token, email);
    if (invitation.status === 'already_claimed') return sendAlreadyClaimedInvitation(res);
    if (invitation.status !== 'valid') {
      return res.status(400).json({ success: false, message: 'This invitation is invalid or expired. Ask your CA to send you a new portal link.' });
    }

    let { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created?.user?.id) {
      if (createError?.status === 422 || createError?.code === 'email_exists' || createError?.code === 'user_already_exists') {
        const { data: existingUserId, error: lookupError } = await supabase.rpc('find_client_portal_auth_user', {
          p_email: email,
        });
        if (lookupError) {
          console.error('[Client Portal] Could not verify the existing account for an invitation:', lookupError.message);
          return res.status(502).json({ success: false, message: 'The existing account could not be verified. Please try again or contact your CA.' });
        }
        if (!existingUserId) {
          return res.status(409).json({
            success: false,
            code: 'email_in_use_by_non_portal_account',
            message: 'This email already belongs to an existing TaxFlow account, such as a CA or staff login. Client portal access requires a separate email address. Ask your CA to use an email that is not already used for a TaxFlow account.',
          });
        }
        const { data: existingUserData, error: existingUserError } = await supabase.auth.admin.getUserById(existingUserId);
        const existingUser = existingUserData?.user;
        if (existingUserError || !existingUser || existingUser.app_metadata?.taxflow_client_portal !== true) {
          console.error('[Client Portal] Existing portal account lookup failed:', existingUserError?.message || 'Account metadata did not match.');
          return res.status(502).json({ success: false, message: 'The existing portal account could not be verified. Please contact your CA.' });
        }
        const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(existingUserId, {
          password,
          email_confirm: true,
          app_metadata: { ...existingUser.app_metadata, taxflow_client_portal: true },
        });
        if (updateError || !updated?.user?.id) {
          console.error('[Client Portal] Could not update the existing invited account password:', updateError?.message || 'Supabase returned no user.');
          return res.status(502).json({ success: false, message: 'The portal password could not be updated. Please try again or contact your CA.' });
        }
        created = updated;
      } else {
        console.error('[Client Portal] Could not create the invited client account:', createError?.message || 'Supabase returned no user.');
        if (
          createError?.code === 'email_address_invalid'
          || /email address.*invalid|invalid.*email/i.test(String(createError?.message || ''))
        ) {
          return res.status(400).json({
            success: false,
            code: 'invalid_email',
            message: 'This email address was rejected. Check it for typing errors and confirm it matches the email your CA has on file.',
          });
        }
        if (createError?.status === 429) {
          return res.status(429).json({
            success: false,
            code: 'portal_auth_rate_limited',
            message: 'Too many account attempts were made. Please wait a few minutes before trying again.',
          });
        }
        return res.status(502).json({
          success: false,
          code: 'portal_account_creation_failed',
          message: 'The portal could not finish creating your account. If this email is already used for a CA or staff TaxFlow login, ask your CA to use a different client email. Otherwise, try again shortly or contact your CA.',
        });
      }
    } else {
      createdNewUser = true;
      createdUserId = created.user.id;
      const { data: marked, error: metadataError } = await supabase.auth.admin.updateUserById(createdUserId, {
        app_metadata: { ...created.user.app_metadata, taxflow_client_portal: true },
      });
      if (metadataError || !marked?.user?.id) {
        console.error('[Client Portal] Could not mark the new account as a portal identity:', metadataError?.message || 'Supabase returned no user.');
        const { error: cleanupError } = await supabase.auth.admin.deleteUser(createdUserId);
        if (cleanupError) console.error('[Client Portal] Failed to clean up an unmarked account:', cleanupError.message);
        createdUserId = null;
        return res.status(502).json({ success: false, message: 'Your account could not be secured. Please try again or contact your CA.' });
      }
      created = marked;
    }

    createdUserId = created.user.id;
    const claim = await claimPortalInvite(created.user, token);
    if (claim.error) {
      if (createdNewUser) {
        const { error: cleanupError } = await supabase.auth.admin.deleteUser(createdUserId);
        if (cleanupError) console.error('[Client Portal] Failed to clean up an unclaimed account:', cleanupError.message);
      }
      createdUserId = null;
      const latestInvitation = await inspectPortalInvite(token, email);
      if (latestInvitation.status === 'already_claimed') return sendAlreadyClaimedInvitation(res);
      return res.status(409).json({ success: false, message: claim.error });
    }
    createdUserId = null;
    return res.status(201).json({ success: true, data: { email } });
  } catch (error) {
    if (createdUserId && createdNewUser) {
      const { error: cleanupError } = await supabase.auth.admin.deleteUser(createdUserId);
      if (cleanupError) console.error('[Client Portal] Failed to clean up an incomplete portal account:', cleanupError.message);
    }
    if (error instanceof RateLimiterUnavailableError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Client Portal] Client account registration failed:', error.message);
    return res.status(503).json({ success: false, message: 'Your account could not be created right now. Please try again shortly.' });
  }
});

router.post('/invitations/claim', async (req, res) => {
  try {
    if (!isConnected || !supabase) {
      return res.status(503).json({ success: false, message: 'Client portal enrollment is temporarily unavailable.' });
    }
    if (!(await consumeInvitationRateLimit(req, res, 'claim'))) return;
    const user = await getAuthenticatedPortalUser(req);
    if (!user) return res.status(401).json({ success: false, message: 'Sign in with your invited client account first.' });
    const claim = await claimPortalInvite(user, req.body?.token);
    if (claim.error) return res.status(403).json({ success: false, message: claim.error });
    return res.json({ success: true, data: claim.data });
  } catch (error) {
    if (error instanceof RateLimiterUnavailableError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error('[Client Portal] Authenticated invitation claim failed:', error.message);
    return res.status(503).json({ success: false, message: 'Your portal invitation could not be claimed. Please try again shortly.' });
  }
});

router.post('/clients/:clientId/invite', requireAuth, async (req, res) => {
  try {
    const client = await requireStaffClient(req, res);
    if (!client) return;
    const email = String(client.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(422).json({ success: false, message: 'Add a valid email address to this client before creating a portal invitation.' });
    }
    if (client.status !== 'Active') {
      return res.status(422).json({ success: false, message: 'Only active clients can be invited to the portal.' });
    }
    const invitation = await createClientPortalInvite({
      clientId: client.id,
      email,
      createdBy: req.user.id,
    });
    return res.status(201).json({
      success: true,
      data: {
        email,
        link: getClientPortalInvitationLink(invitation.token),
        expiresAt: invitation.expiresAt,
      },
    });
  } catch (error) {
    console.error('[Client Portal] Portal invitation creation failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not create the portal invitation. Please try again.' });
  }
});

router.delete('/clients/:clientId/access', requireAuth, async (req, res) => {
  try {
    const client = await requireStaffClient(req, res);
    if (!client) return;
    await revokeClientPortalInvites(client.id);
    const { data, error } = await supabase
      .from('client_portal_access')
      .update({ user_id: null, active: false, invitation_pending: false, updated_at: new Date().toISOString() })
      .eq('client_id', client.id)
      .eq('active', true)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'This client does not have active portal access.' });
    return res.json({ success: true, data: { enabled: false } });
  } catch (error) {
    console.error('[Client Portal] Access revocation failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not revoke this client’s portal access.' });
  }
});

router.get('/me', requireClientPortalAuth, async (req, res) => {
  return res.json({
    success: true,
    data: {
      client: { id: req.portalClient.id, name: req.portalClient.name },
      email: req.portalUser.email
    }
  });
});

router.get('/documents', requireClientPortalAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('documents_metadata')
      .select('id, file_name, file_type, file_size_kb, status, created_at')
      .eq('client_id', req.portalClient.id)
      .eq('source', 'Portal')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('[Client Portal] Document list failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load your uploaded documents.' });
  }
});

router.post(
  '/documents',
  requireClientPortalAuth,
  express.raw({ type: 'application/octet-stream', limit: MAX_UPLOAD_BYTES }),
  async (req, res) => {
    let objectKey = null;
    let bucket = null;
    let documentId = null;
    try {
      const minute = await consume(`client-portal:upload:${req.portalUser.id}:minute`, 5, 60);
      if (!minute.allowed) {
        res.set('Retry-After', String(minute.retryAfterSeconds));
        return res.status(429).json({ success: false, message: 'You have uploaded files too quickly. Please wait a moment and try again.' });
      }
      const day = await consume(`client-portal:upload:${req.portalUser.id}:day`, 50, 86400);
      if (!day.allowed) {
        res.set('Retry-After', String(day.retryAfterSeconds));
        return res.status(429).json({ success: false, message: 'The daily upload limit has been reached. Please contact the practice if you need help.' });
      }

      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ success: false, message: 'Choose a non-empty file to upload.' });
      }
      if (req.body.length > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ success: false, message: 'Files must be 20 MB or smaller.' });
      }

      let fileName;
      try {
        fileName = normalizePortalFileName(decodeURIComponent(req.get('X-File-Name') || ''));
      } catch {
        return res.status(400).json({ success: false, message: 'The uploaded file name is invalid. Rename the file and try again.' });
      }
      const { fileType, mimeType } = validateFile(req.body, fileName, req.get('X-File-Mime-Type'));
      bucket = getStorageBucket();
      if (!bucket) {
        return res.status(503).json({ success: false, message: 'Secure file storage is not configured. Please contact the practice.' });
      }
      const { data: bucketConfig, error: bucketError } = await supabase.storage.getBucket(bucket);
      if (bucketError) {
        console.error('[Client Portal] Private storage bucket check failed:', bucketError.message);
        return res.status(503).json({ success: false, message: 'Secure file storage is temporarily unavailable. Please contact the practice.' });
      }
      if (!bucketConfig || bucketConfig.public !== false) {
        console.error(`[Client Portal] Refusing uploads because bucket "${bucket}" is not private.`);
        return res.status(503).json({ success: false, message: 'Secure file storage is not configured as private. Please contact the practice.' });
      }

      const createdAt = new Date();
      const year = String(createdAt.getUTCFullYear());
      const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(createdAt);
      documentId = crypto.randomUUID();
      objectKey = getStorageObjectKey({
        userId: req.portalClient.user_id,
        clientId: req.portalClient.id,
        year,
        month,
        documentId,
        fileName
      });

      const { error: uploadError } = await supabase.storage.from(bucket).upload(objectKey, req.body, {
        contentType: mimeType,
        upsert: false
      });
      if (uploadError) throw uploadError;

      const metadata = {
        id: documentId,
        client_id: req.portalClient.id,
        client_name: req.portalClient.name,
        file_name: fileName,
        file_type: fileType,
        file_size_kb: Number((req.body.length / 1024).toFixed(2)),
        category: 'General',
        source: 'Portal',
        status: 'Pending',
        vault_path: `supabase://${bucket}/${objectKey}`,
        storage_bucket: bucket,
        storage_object_path: objectKey,
        file_sha256: sha256(req.body),
        mime_type: mimeType,
        created_at: createdAt.toISOString()
      };
      const { data, error } = await supabase.from('documents_metadata').insert(metadata).select(
        'id, file_name, file_type, file_size_kb, status, created_at'
      ).single();
      if (error) throw error;

      return res.status(201).json({ success: true, data });
    } catch (error) {
      if (error instanceof RateLimiterUnavailableError) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      if (bucket && objectKey) {
        const { data: savedDocument, error: lookupError } = await supabase
          .from('documents_metadata')
          .select('id')
          .eq('id', documentId)
          .eq('source', 'Portal')
          .maybeSingle();
        if (lookupError) {
          console.error('[Client Portal] Could not confirm failed-upload metadata cleanup:', lookupError.message);
        } else if (!savedDocument) {
          const { error: cleanupError } = await supabase.storage.from(bucket).remove([objectKey]);
          if (cleanupError) console.error('[Client Portal] Failed upload cleanup:', cleanupError.message);
        }
      }
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error('[Client Portal] Upload failed:', error.message);
      return res.status(500).json({ success: false, message: 'The file could not be saved securely. Please try again.' });
    }
  }
);

module.exports = router;
