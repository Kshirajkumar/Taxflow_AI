/**
 * TaxFlow.AI — Clients Routes
 * Supabase: Stores client metadata (name, PAN, GSTIN, entity type, status)
 * Vault: Creates a dedicated folder per client on local disk
 */

const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { revokeClientPortalInvites } = require('../lib/clientPortalInvites');
const { ensureClientVaultStructure, listClientVaultTree, getClientVaultRoot, deleteClientVaultFile, resolveClientVaultFile, searchClientVaultFiles } = require('../vault/vaultManager');
const {
  downloadDocument,
  isExpectedPortalObject,
  isExpectedTelegramObject,
  normalizeMimeType
} = require('../lib/documentStorage');

function addCloudDocumentToTree(entries, document) {
  const createdAt = new Date(document.created_at);
  if (Number.isNaN(createdAt.getTime())) throw new Error(`Cloud document ${document.id} has an invalid creation date.`);
  const year = String(createdAt.getFullYear());
  const month = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(createdAt);
  let yearEntry = entries.find(entry => entry.type === 'folder' && entry.name === year);
  if (!yearEntry) {
    yearEntry = { name: year, type: 'folder', modifiedAt: document.created_at, children: [] };
    entries.push(yearEntry);
  }
  let monthEntry = yearEntry.children.find(entry => entry.type === 'folder' && entry.name === month);
  if (!monthEntry) {
    monthEntry = { name: month, type: 'folder', modifiedAt: document.created_at, children: [] };
    yearEntry.children.push(monthEntry);
  }
  let rawEntry = monthEntry.children.find(entry => entry.type === 'folder' && entry.name === 'Raw');
  if (!rawEntry) {
    rawEntry = { name: 'Raw', type: 'folder', modifiedAt: document.created_at, children: [] };
    monthEntry.children.push(rawEntry);
  }
  if (!rawEntry.children.some(entry => entry.type === 'file' && entry.name === document.file_name)) {
    rawEntry.children.push({
      name: document.file_name,
      type: 'file',
      size: Math.max(0, Math.round(Number(document.file_size_kb || 0) * 1024)),
      modifiedAt: document.created_at,
      cloudRetained: true
    });
  }
}

// --- In-Memory Fallback Data (used when Supabase is not connected) ---
let fallbackClients = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Reliable Motors Pvt Ltd', entity_type: 'Pvt Ltd',
    pan: 'AACCR1234F', gstin: '27AACCR1234F1Z5',
    phone: '+919820011223', email: 'accounts@reliablemotors.com',
    status: 'Active', assigned_ca: 'CA Rajesh Kumar',
    filing_status: 'Pending (GSTR-3B)', total_docs: 3, total_ai_calls: 7,
    created_at: '2026-09-01T10:00:00Z'
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Dr. Ananya Roy', entity_type: 'Individual',
    pan: 'APCPR5678K', gstin: null,
    phone: '+919930044556', email: 'ananya.roy@medclinic.in',
    status: 'Active', assigned_ca: 'CA Priya Sharma',
    filing_status: 'Docs Collected', total_docs: 2, total_ai_calls: 3,
    created_at: '2026-09-05T09:00:00Z'
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Apex Logistics LLP', entity_type: 'LLP',
    pan: 'ABBFA9876M', gstin: '27ABBFA9876M1Z2',
    phone: '+919819988776', email: 'finance@apexlogistics.in',
    status: 'Active', assigned_ca: 'CA Rajesh Kumar',
    filing_status: 'Filed (Q2)', total_docs: 5, total_ai_calls: 12,
    created_at: '2026-09-10T11:00:00Z'
  }
];

const CLIENT_CACHE_LIMIT = 100;
const clientsCache = new Map();
const clientsCacheVersions = new Map();

function invalidateClientsCache(userId) {
  clientsCache.delete(userId);
  clientsCacheVersions.set(userId, (clientsCacheVersions.get(userId) || 0) + 1);
}

function storeClientsCache(userId, clients) {
  if (!clientsCache.has(userId) && clientsCache.size >= CLIENT_CACHE_LIMIT) {
    clientsCache.delete(clientsCache.keys().next().value);
  }
  clientsCache.delete(userId);
  clientsCache.set(userId, clients);
}

// GET /api/v1/clients/search/files — search filenames in this user's vaults
router.get('/search/files', async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 2 || query.length > 100) {
      return res.status(400).json({ success: false, message: 'Search text must be between 2 and 100 characters.' });
    }

    let clients;
    if (isConnected) {
      const cachedClients = clientsCache.get(req.user.id);
      if (cachedClients) {
        clients = cachedClients.map(({ id, name }) => ({ id, name }));
      } else {
        const { data, error } = await supabase
          .from('clients')
          .select('id, name')
          .eq('user_id', req.user.id)
          .order('created_at', { ascending: false })
          .limit(500);
        if (error) throw error;
        clients = data || [];
      }
    } else {
      clients = fallbackClients.map(({ id, name }) => ({ id, name }));
    }

    const data = searchClientVaultFiles(
      clients.map(client => ({ ...client, root: getClientVaultRoot(client.name) })),
      query
    );
    return res.json({ success: true, source: isConnected ? 'supabase' : 'demo', data });
  } catch (err) {
    console.error('[Clients] Vault filename search failed:', err);
    return res.status(500).json({ success: false, message: 'The local vault could not be searched.' });
  }
});

// GET /api/v1/clients — List all clients
router.get('/', async (req, res) => {
  try {
    if (isConnected) {
      const userId = req.user.id;
      const cachedClients = clientsCache.get(userId);
      if (cachedClients) {
        return res.json({ success: true, count: cachedClients.length, source: 'supabase', data: cachedClients });
      }
      let cacheVersion;
      let data;
      do {
        cacheVersion = clientsCacheVersions.get(userId) || 0;
        const result = await supabase
          .from('clients')
          .select('*, supported_countries(country_name,currency_code)')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (result.error) throw result.error;
        data = result.data;
      } while ((clientsCacheVersions.get(userId) || 0) !== cacheVersion);
      const clients = data.map(client => ({ ...client, country_name: client.supported_countries?.country_name, currency_code: client.supported_countries?.currency_code }));
      storeClientsCache(userId, clients);
      clientsCacheVersions.delete(userId);
      return res.json({ success: true, count: clients.length, source: 'supabase', data: clients });
    }
    res.json({ success: true, count: fallbackClients.length, source: 'demo', data: fallbackClients });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/clients/:id — Get single client
router.get('/:id', async (req, res) => {
  try {
    if (isConnected) {
      const { data, error } = await supabase
        .from('clients').select('*, supported_countries(country_name,currency_code)').eq('id', req.params.id).eq('user_id', req.user.id).single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data: { ...data, country_name: data.supported_countries?.country_name, currency_code: data.supported_countries?.currency_code } });
    }
    const client = fallbackClients.find(c => c.id === req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.json({ success: true, source: 'demo', data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/clients — Create new client
router.post('/', async (req, res) => {
  try {
    const { name, entity_type, pan, gstin, phone, email, filing_type, filing_types, country_id, gstin_registered, notes } = req.body;

    if (!name || !entity_type || !country_id) {
      return res.status(400).json({ success: false, message: 'name, entity_type, and country_id are required' });
    }
    if (filing_types !== undefined && !Array.isArray(filing_types)) {
      return res.status(400).json({ success: false, message: 'filing_types must be an array' });
    }
    if (email !== undefined && email !== null && typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'Client email must be a string.' });
    }
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Enter a valid client email address.' });
    }
    const filingTypes = (filing_types || []).filter(type => typeof type === 'string' && type.trim()).map(type => type.trim());

    if (isConnected) {
      let { data, error } = await supabase
        .from('clients')
        .insert([{ user_id: req.user.id, name: name.trim(), entity_type: entity_type || 'Individual', pan: pan || null, gstin: gstin || null, phone: phone || null, email: normalizedEmail || null, country_id: country_id || null, filing_type: filing_type || filingTypes[0] || 'ITR-1', filing_types: filingTypes, gstin_registered: gstin_registered ?? Boolean(gstin), notes: notes || null }])
        .select('*, supported_countries(country_name,currency_code)')
        .single();
      if (error) throw error;

      let vault = null;
      try {
        ensureClientVaultStructure(data.name);
        vault = { created: true };
      } catch (vaultError) {
        console.error(`[Clients] Vault folder creation failed for ${data.id}:`, vaultError);
        vault = { created: false, warning: 'Client saved, but the local vault folder could not be created. Check the configured vault path and permissions.' };
      }
      // Auto-create portal access for the client's email so they can log in and upload documents
      let portalAccess = null;
      let portalAccessWarning = '';
      if (normalizedEmail) {
        try {
          const { data: existingAccess, error: existingAccessError } = await supabase
            .from('client_portal_access')
            .select('id')
            .eq('client_id', data.id)
            .maybeSingle();
          if (existingAccessError) throw existingAccessError;
          if (!existingAccess) {
            const { data: newAccess, error: accessError } = await supabase
              .from('client_portal_access')
              .insert({
                client_id: data.id,
                invited_email: normalizedEmail,
                active: true,
                invitation_pending: false,
                created_by: req.user.id,
              })
              .select('id, invited_email, active, created_at')
              .single();
            if (accessError) throw accessError;
            portalAccess = newAccess;
          }
        } catch (portalError) {
          console.error(`[Clients] Auto portal access creation failed for ${data.id}:`, portalError.message);
          portalAccessWarning = 'Client was saved, but portal access could not be enabled. Confirm the client portal database migration has been applied, then enable access from the client portal settings.';
        }
      } else {
        portalAccessWarning = 'Client was saved without an email address, so client portal access is not enabled.';
      }

      invalidateClientsCache(req.user.id);
      return res.status(201).json({ success: true, source: 'supabase', data: { ...data, country_name: data.supported_countries?.country_name, currency_code: data.supported_countries?.currency_code, portalAccess, portalAccessWarning }, vault });
    }

    // Fallback
    const newClient = {
      id: `demo_${Date.now()}`, name, entity_type, pan, gstin, phone, email: normalizedEmail || null,
      status: 'Active', total_docs: 0, total_ai_calls: 0,
      created_at: new Date().toISOString()
    };
    fallbackClients.push(newClient);
    let vault = null;
    try {
      vault = ensureClientVaultStructure(newClient.name);
      newClient.vault_folder = vault.clientRoot;
    } catch (vaultError) {
      console.error(`[Clients] Demo vault folder creation failed for ${newClient.id}:`, vaultError);
      vault = { created: false, warning: 'Client saved, but the local vault folder could not be created. Check the configured vault path and permissions.' };
    }
    res.status(201).json({ success: true, source: 'demo', data: newClient, vault });
  } catch (err) {
    const duplicate = err.code === '23505';
    const message = duplicate ? 'A client with this PAN, phone number, or other unique detail already exists.' : (err.message || 'Failed to save client.');
    res.status(duplicate ? 409 : 500).json({ success: false, message });
  }
});

// PATCH /api/v1/clients/:id — Update client info
router.patch('/:id', async (req, res) => {
  try {
    const allowedFields = ['name', 'entity_type', 'pan', 'gstin', 'phone', 'email', 'country_id', 'filing_type', 'filing_types', 'gstin_registered', 'notes'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowedFields.includes(key)));
    if (updates.email !== undefined) {
      if (updates.email !== null && typeof updates.email !== 'string') {
        return res.status(400).json({ success: false, message: 'Client email must be a string.' });
      }
      const normalizedEmail = typeof updates.email === 'string' ? updates.email.trim().toLowerCase() : '';
      if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ success: false, message: 'Enter a valid client email address.' });
      }
      updates.email = normalizedEmail || null;
    }
    if (updates.filing_types !== undefined && !Array.isArray(updates.filing_types)) {
      return res.status(400).json({ success: false, message: 'filing_types must be an array' });
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid client fields were provided.' });
    }
    if (isConnected) {
      const { data: currentClient, error: currentClientError } = await supabase
        .from('clients')
        .select('email')
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (currentClientError) throw currentClientError;
      if (!currentClient) return res.status(404).json({ success: false, message: 'Client not found.' });
      const { data, error } = await supabase
        .from('clients').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select('*, supported_countries(country_name,currency_code)').single();
      if (error) throw error;
      let portalAccessWarning = '';
      const previousEmail = String(currentClient.email || '').trim().toLowerCase();
      const updatedEmail = String(data.email || '').trim().toLowerCase();
      if (updates.email !== undefined && previousEmail !== updatedEmail) {
        try {
          await revokeClientPortalInvites(data.id);
          const { data: existingAccess, error: accessLookupError } = await supabase
            .from('client_portal_access')
            .select('id')
            .eq('client_id', data.id)
            .maybeSingle();
          if (accessLookupError) throw accessLookupError;
          if (existingAccess && updatedEmail) {
            const { error: accessUpdateError } = await supabase
              .from('client_portal_access')
              .update({ invited_email: updatedEmail, user_id: null, active: true, invitation_pending: false })
              .eq('id', existingAccess.id);
            if (accessUpdateError) throw accessUpdateError;
          } else if (existingAccess) {
            const { error: accessRevokeError } = await supabase
              .from('client_portal_access')
              .update({ invited_email: null, user_id: null, active: false, invitation_pending: false })
              .eq('id', existingAccess.id);
            if (accessRevokeError) throw accessRevokeError;
          } else if (updatedEmail) {
            const { error: accessInsertError } = await supabase
              .from('client_portal_access')
              .insert({ client_id: data.id, invited_email: updatedEmail, active: true, invitation_pending: false, created_by: req.user.id });
            if (accessInsertError) throw accessInsertError;
          }
        } catch (portalError) {
          console.error(`[Clients] Portal access email update failed for ${data.id}:`, portalError.message);
          portalAccessWarning = 'Client details were updated, but portal access could not be updated. Review this client’s portal access before sending an upload link.';
        }
      }
      invalidateClientsCache(req.user.id);
      return res.json({ success: true, source: 'supabase', data: { ...data, country_name: data.supported_countries?.country_name, currency_code: data.supported_countries?.currency_code, portalAccessWarning } });
    }
    const idx = fallbackClients.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Not found' });
    fallbackClients[idx] = { ...fallbackClients[idx], ...req.body };
    res.json({ success: true, source: 'demo', data: fallbackClients[idx] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/v1/clients/:id — permanently delete the client and owned data
router.delete('/:id', async (req, res) => {
  const clientId = String(req.params.id || '').trim();
  if (!clientId || clientId.length > 128) {
    return res.status(400).json({ success: false, message: 'A valid client id is required.' });
  }

  try {
    const { deleteClientVault } = require('../vault/vaultManager');
    if (isConnected) {
      const { data: existing, error: lookupError } = await supabase
        .from('clients')
        // The local filesystem is the source of truth for the vault location.
        // Do not require the optional clients.vault_folder column here: existing
        // Supabase installations may not have received that schema addition.
        .select('id, name')
        .eq('id', clientId)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) return res.status(404).json({ success: false, message: 'Client not found.' });

      const { error: deleteError } = await supabase
        .from('clients')
        .delete()
        .eq('id', clientId)
        .eq('user_id', req.user.id);
      if (deleteError) throw deleteError;
      invalidateClientsCache(req.user.id);

      let vaultWarning = null;
      try { deleteClientVault(existing.name); } catch (vaultError) {
        vaultWarning = 'Database data was deleted, but the local client vault could not be removed. Contact an administrator to clean it up safely.';
        console.error(`[Clients] Vault cleanup failed for ${clientId}:`, vaultError);
      }
      return res.json({ success: true, source: 'supabase', data: { id: clientId, name: existing.name, vaultWarning } });
    }

    const index = fallbackClients.findIndex(client => client.id === clientId);
    if (index === -1) return res.status(404).json({ success: false, message: 'Client not found.' });
    const [deleted] = fallbackClients.splice(index, 1);
    try { deleteClientVault(deleted.name); } catch (vaultError) { console.error(`[Clients] Demo vault cleanup failed for ${clientId}:`, vaultError); }
    return res.json({ success: true, source: 'demo', data: { id: clientId, name: deleted.name } });
  } catch (err) {
    console.error(`[Clients] Delete failed for ${clientId}:`, err);
    return res.status(500).json({ success: false, message: 'Could not permanently delete this client and its connected data.' });
  }
});

// GET /api/v1/clients/:id/vault-summary — Show vault folder contents for a client
router.get('/:id/vault-summary', async (req, res) => {
  const { listClientVaultFiles } = require('../vault/vaultManager');
  const categories = ['Raw', 'Extracted'];
  const summary = {};
  let clientName = req.params.id;
  if (isConnected) {
    const { data } = await supabase.from('clients').select('name').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    if (data?.name) clientName = data.name;
  } else {
    const client = fallbackClients.find(item => item.id === req.params.id);
    if (client?.name) clientName = client.name;
  }
  for (const cat of categories) {
    const files = listClientVaultFiles(clientName, cat);
    if (files.length > 0) summary[cat] = files;
  }
  res.json({ success: true, clientId: req.params.id, vaultSummary: summary });
});

// GET /api/v1/clients/:id/vault-file — open one regular file from this client's vault
router.get('/:id/vault-file', async (req, res) => {
  try {
    const relativePath = typeof req.query.relativePath === 'string' ? req.query.relativePath.trim() : '';
    let client;
    if (isConnected) {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (error) throw error;
      client = data;
    } else {
      client = fallbackClients.find(item => item.id === req.params.id);
    }
    if (!client) return res.status(404).json({ success: false, message: 'Client not found.' });

    const target = resolveClientVaultFile(getClientVaultRoot(client.name), relativePath);
    if (!target && isConnected) {
      const parts = relativePath.split(/[\\/]/);
      if (parts.length === 4 && parts[2] === 'Raw') {
        const { data: documents, error: documentError } = await supabase
          .from('documents_metadata')
          .select('id, client_id, source, file_name, created_at, storage_bucket, storage_object_path, mime_type')
          .eq('client_id', client.id)
          .eq('file_name', parts[3])
          .in('source', ['Telegram', 'Portal'])
          .not('storage_object_path', 'is', null);
        if (documentError) throw documentError;
        const document = (documents || []).find(item => {
          const date = new Date(item.created_at);
          return !Number.isNaN(date.getTime())
            && String(date.getUTCFullYear()) === parts[0]
            && new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date) === parts[1];
        });
        if (document) {
          const safeObject = document.source === 'Portal'
            ? isExpectedPortalObject({
                bucket: document.storage_bucket,
                objectKey: document.storage_object_path,
                userId: req.user.id,
                clientId: document.client_id,
                documentId: document.id,
                createdAt: document.created_at,
                fileName: document.file_name
              })
            : isExpectedTelegramObject({
            bucket: document.storage_bucket,
            objectKey: document.storage_object_path,
            userId: req.user.id,
            clientId: document.client_id,
            createdAt: document.created_at,
            fileName: document.file_name
              });
          if (!safeObject) {
            console.error(`[Clients] Refusing unexpected cloud storage reference for document ${document.id}.`);
            return res.status(404).json({ success: false, message: 'The cloud document reference is invalid.' });
          }
          const buffer = await downloadDocument(document.storage_bucket, document.storage_object_path);
          res.setHeader('Cache-Control', 'private, no-store');
          res.setHeader('Content-Type', normalizeMimeType(document.mime_type));
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Disposition', 'attachment');
          return res.send(buffer);
        }
      }
    }
    if (!target) return res.status(404).json({ success: false, message: 'Vault file not found.' });
    if (isConnected) {
      const { data: document, error: documentError } = await supabase
        .from('documents_metadata')
        .select('id')
        .eq('client_id', client.id)
        .eq('vault_path', target)
        .maybeSingle();
      if (documentError) throw documentError;
      if (!document) return res.status(404).json({ success: false, message: 'This file is not registered to the selected client.' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(target, error => {
      if (error && !res.headersSent) {
        console.error(`[Clients] Could not serve vault file for ${req.params.id}:`, error);
        res.status(500).json({ success: false, message: 'The vault file could not be opened.' });
      }
    });
  } catch (err) {
    console.error(`[Clients] Vault file access failed for ${req.params.id}:`, err);
    return res.status(400).json({ success: false, message: 'The requested vault file could not be opened.' });
  }
});

// DELETE /api/v1/clients/:id/vault-file — permanently remove one local file
router.delete('/:id/vault-file', async (req, res) => {
  try {
    const relativePath = typeof req.body?.relativePath === 'string' ? req.body.relativePath.trim() : '';
    if (!relativePath) {
      return res.status(400).json({ success: false, message: 'A vault file path is required.' });
    }

    let client;
    if (isConnected) {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (error) throw error;
      client = data;
    } else {
      client = fallbackClients.find(item => item.id === req.params.id);
    }
    if (!client) return res.status(404).json({ success: false, message: 'Client not found.' });

    const deleted = deleteClientVaultFile(getClientVaultRoot(client.name), relativePath);
    if (!deleted) return res.status(404).json({ success: false, message: 'This file no longer exists in the local vault.' });

    return res.json({ success: true, source: isConnected ? 'supabase' : 'demo', data: { relativePath } });
  } catch (err) {
    console.error(`[Clients] Vault file deletion failed for ${req.params.id}:`, err);
    return res.status(400).json({ success: false, message: err.message || 'The file could not be deleted from the local vault.' });
  }
});

// GET /api/v1/clients/:id/vault-tree — read-only local folder browser
router.get('/:id/vault-tree', async (req, res) => {
  try {
    let client;
    if (isConnected) {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (error) throw error;
      client = data;
    } else {
      client = fallbackClients.find(item => item.id === req.params.id);
    }
    if (!client) return res.status(404).json({ success: false, message: 'Client not found.' });

    const { ensureClientVaultBuckets } = require('../vault/vaultManager');
    // Always derive the active root from the current configured vault and the
    // sanitized client name, so browsing agrees with uploads.
    const root = getClientVaultRoot(client.name);

    // Reconcile the active period for older clients created before the
    // two-bucket vault layout was introduced. This is idempotent and safe.
    ensureClientVaultBuckets(root);
    const entries = listClientVaultTree(root);
    if (isConnected) {
      const { data: cloudDocuments, error: documentsError } = await supabase
        .from('documents_metadata')
        .select('id, source, file_name, file_size_kb, created_at, storage_bucket, storage_object_path')
        .eq('client_id', client.id)
        .in('source', ['Telegram', 'Portal'])
        .not('storage_object_path', 'is', null);
      if (documentsError) throw documentsError;
      for (const document of cloudDocuments || []) {
        const safeObject = document.source === 'Portal'
          ? isExpectedPortalObject({
              bucket: document.storage_bucket,
              objectKey: document.storage_object_path,
              userId: req.user.id,
              clientId: client.id,
              documentId: document.id,
              createdAt: document.created_at,
              fileName: document.file_name
            })
          : isExpectedTelegramObject({
          bucket: document.storage_bucket,
          objectKey: document.storage_object_path,
          userId: req.user.id,
          clientId: client.id,
          createdAt: document.created_at,
          fileName: document.file_name
            });
        if (!safeObject) {
          console.error(`[Clients] Skipping unexpected cloud storage reference for document ${document.id}.`);
          continue;
        }
        addCloudDocumentToTree(entries, document);
      }
    }
    return res.json({
      success: true,
      source: isConnected ? 'supabase' : 'demo',
      data: { clientId: client.id, clientName: client.name, root, entries }
    });
  } catch (err) {
    console.error(`[Clients] Vault tree failed for ${req.params.id}:`, err);
    return res.status(500).json({
      success: false,
      message: `The local vault could not be read: ${err.message || 'unknown vault error'}`
    });
  }
});

module.exports = router;
