/**
 * TaxFlow.AI — Clients Routes
 * Supabase: Stores client metadata (name, PAN, GSTIN, entity type, status)
 * Vault: Creates a dedicated folder per client on local disk
 */

const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { getClientVaultDir, VAULT_BASE_DIR } = require('../vault/vaultManager');
const path = require('path');

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
        .select('*')
        .eq('owner_id', req.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.json({ success: true, count: data.length, source: 'supabase', data });
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
        .from('clients').select('*').eq('id', req.params.id).eq('owner_id', req.user.id).single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data });
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
    const { name, entity_type, pan, gstin, phone, email, assigned_ca } = req.body;

    if (!name || !entity_type) {
      return res.status(400).json({ success: false, message: 'name and entity_type are required' });
    }

    if (isConnected) {
      const { data, error } = await supabase
        .from('clients')
        .insert([{ owner_id: req.user.id, name, entity_type, pan, gstin, phone, email, assigned_ca, status: 'Active' }])
        .select()
        .single();
      if (error) throw error;

      // Create vault folder for the new client
      getClientVaultDir(data.id, 'General');
      return res.status(201).json({ success: true, source: 'supabase', data });
    }

    // Fallback
    const newClient = {
      id: `demo_${Date.now()}`, name, entity_type, pan, gstin, phone, email,
      assigned_ca, status: 'Active', total_docs: 0, total_ai_calls: 0,
      created_at: new Date().toISOString()
    };
    fallbackClients.push(newClient);
    getClientVaultDir(newClient.id, 'General');
    res.status(201).json({ success: true, source: 'demo', data: newClient });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/v1/clients/:id — Update client info
router.patch('/:id', async (req, res) => {
  try {
    if (isConnected) {
      const { data, error } = await supabase
        .from('clients').update(req.body).eq('id', req.params.id).eq('owner_id', req.user.id).select().single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data });
    }
    const idx = fallbackClients.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Not found' });
    fallbackClients[idx] = { ...fallbackClients[idx], ...req.body };
    res.json({ success: true, source: 'demo', data: fallbackClients[idx] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/clients/:id/vault-summary — Show vault folder contents for a client
router.get('/:id/vault-summary', async (req, res) => {
  const { listClientVaultFiles } = require('../vault/vaultManager');
  const categories = ['GST', 'IncomeTax', 'Form16', 'BankStatement', 'Notice', 'TDS', 'General'];
  const summary = {};
  for (const cat of categories) {
    const files = listClientVaultFiles(req.params.id, cat);
    if (files.length > 0) summary[cat] = files;
  }
  res.json({ success: true, clientId: req.params.id, vaultSummary: summary });
});

module.exports = router;
