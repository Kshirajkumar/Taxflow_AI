/**
 * TaxFlow.AI — Clients Routes
 * Supabase: Stores client metadata (name, PAN, GSTIN, entity type, status)
 * Vault: Creates a dedicated folder per client on local disk
 */

const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { ensureClientVaultStructure } = require('../vault/vaultManager');

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

// GET /api/v1/clients — List all clients
router.get('/', async (req, res) => {
  try {
    if (isConnected) {
      const { data, error } = await supabase
        .from('clients')
        .select('*, supported_countries(country_name,currency_code)')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.json({ success: true, count: data.length, source: 'supabase', data: data.map(client => ({ ...client, country_name: client.supported_countries?.country_name, currency_code: client.supported_countries?.currency_code })) });
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
    const filingTypes = (filing_types || []).filter(type => typeof type === 'string' && type.trim()).map(type => type.trim());

    if (isConnected) {
      let { data, error } = await supabase
        .from('clients')
        .insert([{ user_id: req.user.id, name: name.trim(), entity_type: entity_type || 'Individual', pan: pan || null, gstin: gstin || null, phone: phone || null, email: email || null, country_id: country_id || null, filing_type: filing_type || filingTypes[0] || 'ITR-1', filing_types: filingTypes, gstin_registered: gstin_registered ?? Boolean(gstin), notes: notes || null }])
        .select('*, supported_countries(country_name,currency_code)')
        .single();
      if (error) throw error;

      let vault = null;
      try {
        vault = ensureClientVaultStructure(data.name);
        const { data: updated, error: vaultPathError } = await supabase
          .from('clients')
          .update({ vault_folder: vault.clientRoot })
          .eq('id', data.id)
          .eq('user_id', req.user.id)
          .select('*, supported_countries(country_name,currency_code)')
          .single();
        if (!vaultPathError && updated) data = updated;
      } catch (vaultError) {
        console.error(`[Clients] Vault folder creation failed for ${data.id}:`, vaultError);
        vault = { created: false, warning: 'Client saved, but the local vault folder could not be created. Check the configured vault path and permissions.' };
      }
      return res.status(201).json({ success: true, source: 'supabase', data: { ...data, country_name: data.supported_countries?.country_name, currency_code: data.supported_countries?.currency_code }, vault });
    }

    // Fallback
    const newClient = {
      id: `demo_${Date.now()}`, name, entity_type, pan, gstin, phone, email,
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
    if (updates.filing_types !== undefined && !Array.isArray(updates.filing_types)) {
      return res.status(400).json({ success: false, message: 'filing_types must be an array' });
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid client fields were provided.' });
    }
    if (isConnected) {
      const { data, error } = await supabase
        .from('clients').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select('*, supported_countries(country_name,currency_code)').single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data: { ...data, country_name: data.supported_countries?.country_name, currency_code: data.supported_countries?.currency_code } });
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
  const categories = ['GST', 'IncomeTax', 'Form16', 'BankStatement', 'Notice', 'TDS', 'General'];
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

module.exports = router;
