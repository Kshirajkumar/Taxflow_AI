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
  getStorageBucket,
  getStorageObjectKey,
  normalizeMimeType,
  sha256
} = require('../lib/documentStorage');

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
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

function getPortalBaseUrl() {
  const value = String(process.env.CLIENT_PORTAL_URL || '').trim();
  if (!value) throw new Error('CLIENT_PORTAL_URL is not configured.');
  const url = new URL(value);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('CLIENT_PORTAL_URL must use HTTPS in production.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('CLIENT_PORTAL_URL must be the website origin without a path or credentials.');
  }
  return url.toString().replace(/\/+$/, '');
}

function normalizePortalFileName(value) {
  const original = String(value || '').replace(/\\/g, '/');
  const baseName = path.posix.basename(original).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!baseName || baseName === '.' || baseName === '..' || baseName.length > 180) {
    throw new Error('Choose a file with a name under 180 characters.');
  }
  return baseName;
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
          && data.user_id
          && String(data.invited_email || '').toLowerCase() === String(client.email || '').trim().toLowerCase()
        ),
        email: client.email || null,
        createdAt: data?.created_at || null
      }
    });
  } catch (error) {
    console.error('[Client Portal] Could not load client access:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load this client’s portal access.' });
  }
});

router.post('/clients/:clientId/invite', requireAuth, async (req, res) => {
  let reservedAccessId = null;
  let invitedUserId = null;
  try {
    const client = await requireStaffClient(req, res);
    if (!client) return;
    const email = String(client.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(422).json({ success: false, message: 'Add a valid email address to this client before sending a portal invitation.' });
    }
    if (client.status !== 'Active') {
      return res.status(422).json({ success: false, message: 'Only active clients can be invited to the portal.' });
    }

    const { data: previous, error: previousError } = await supabase
      .from('client_portal_access')
      .select('id, active, user_id, invited_email')
      .eq('client_id', client.id)
      .maybeSingle();
    if (previousError) throw previousError;
    if (previous?.active && previous.user_id && String(previous.invited_email || '').toLowerCase() === email) {
      return res.status(409).json({ success: false, message: 'Portal access is already active. The client can sign in from the portal page.' });
    }

    if (previous) {
      let reservationQuery = supabase
        .from('client_portal_access')
        .update({
          user_id: null,
          invited_email: email,
          active: false,
          invitation_pending: true,
          created_by: req.user.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', previous.id);
      if (previous.active) {
        reservationQuery = reservationQuery
          .eq('active', true)
          .eq('invited_email', previous.invited_email);
      } else {
        reservationQuery = reservationQuery.eq('active', false).eq('invitation_pending', false);
      }
      const { data: reserved, error } = await reservationQuery.select('id').maybeSingle();
      if (error) throw error;
      if (!reserved) return res.status(409).json({ success: false, message: 'Portal access changed at the same time. Refresh and try again.' });
      reservedAccessId = reserved.id;
    } else {
      const { data: reserved, error } = await supabase
        .from('client_portal_access')
        .insert({ client_id: client.id, invited_email: email, invitation_pending: true, created_by: req.user.id })
        .select('id')
        .single();
      if (error?.code === '23505') {
        return res.status(409).json({ success: false, message: 'Portal access is being set up for this client. Refresh and try again.' });
      }
      if (error) throw error;
      reservedAccessId = reserved.id;
    }

    const redirectTo = `${getPortalBaseUrl()}/portal`;
    const { data: invite, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (inviteError || !invite?.user?.id) {
      console.error('[Client Portal] Supabase invitation failed:', inviteError?.message || 'No invited user returned.');
      const { error: cleanupError } = await supabase.from('client_portal_access')
        .update({ user_id: null, active: false, invitation_pending: false, updated_at: new Date().toISOString() })
        .eq('id', reservedAccessId);
      if (cleanupError) console.error('[Client Portal] Failed invitation reservation cleanup:', cleanupError.message);
      reservedAccessId = null;
      return res.status(502).json({ success: false, message: 'The invitation email could not be sent. Check the Supabase Auth email configuration and try again.' });
    }
    invitedUserId = invite.user.id;

    const { error: roleError } = await supabase.auth.admin.updateUserById(invitedUserId, {
      app_metadata: { ...invite.user.app_metadata, taxflow_client_portal: true }
    });
    if (roleError) throw roleError;

    const { error: accessError } = await supabase
      .from('client_portal_access')
      .update({ user_id: invitedUserId, invited_email: email, active: true, invitation_pending: false, updated_at: new Date().toISOString() })
      .eq('id', reservedAccessId);
    if (accessError) throw accessError;

    return res.status(201).json({ success: true, data: { enabled: true, email } });
  } catch (error) {
    if (reservedAccessId) {
      const { error: cleanupError } = await supabase.from('client_portal_access')
        .update({ user_id: null, active: false, invitation_pending: false, updated_at: new Date().toISOString() })
        .eq('id', reservedAccessId);
      if (cleanupError) console.error('[Client Portal] Invitation reservation cleanup failed:', cleanupError.message);
    }
    if (invitedUserId) {
      const { error: cleanupError } = await supabase.auth.admin.deleteUser(invitedUserId);
      if (cleanupError) console.error('[Client Portal] Incomplete invitation account cleanup failed:', cleanupError.message);
    }
    console.error('[Client Portal] Invitation failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not finish the portal invitation. Please try again or contact support.' });
  }
});

router.delete('/clients/:clientId/access', requireAuth, async (req, res) => {
  try {
    const client = await requireStaffClient(req, res);
    if (!client) return;
    const { data, error } = await supabase
      .from('client_portal_access')
      .update({ active: false, updated_at: new Date().toISOString() })
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
