/**
 * TaxFlow.AI — Documents & Extraction Routes
 *
 * HYBRID STORAGE MODEL:
 *   Physical file (PDF/image) → Saved to Local Vault Storage on disk
 *   File metadata + extracted fields → Saved to Supabase cloud database
 *   AI usage count → Logged to Supabase ai_usage_log table
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { supabase, isConnected } = require('../db/supabase');
const { saveFileToVault, vaultFileExists, getVaultBaseDir } = require('../vault/vaultManager');
const { getOwnedClientIds, assertOwnedClient } = require('../lib/ownership');
const {
  downloadDocument,
  isExpectedTelegramObject,
  normalizeMimeType
} = require('../lib/documentStorage');

function normalizeFileType(fileType, fileName) {
  const extension = String(fileName || '').split('.').pop().toLowerCase();
  const value = String(fileType || '').toLowerCase();
  const types = {
    pdf: 'PDF', png: 'PNG', jpg: 'JPG', jpeg: 'JPEG', webp: 'WEBP',
    csv: 'CSV', xlsx: 'XLSX', xls: 'XLS', doc: 'DOC', docx: 'DOCX'
  };
  if (types[extension]) return types[extension];
  if (value.includes('pdf')) return 'PDF';
  if (value.includes('png')) return 'PNG';
  if (value.includes('jpeg') || value.includes('jpg')) return value.includes('jpeg') ? 'JPEG' : 'JPG';
  if (value.includes('spreadsheet') || value.includes('excel')) return 'XLSX';
  if (value.includes('word')) return 'DOCX';
  return 'PDF';
}
const VAULT_BASE_DIR = getVaultBaseDir();

// --- In-Memory Fallback ---
let fallbackDocuments = [
  {
    id: 'doc-101',
    client_id: '11111111-1111-1111-1111-111111111111',
    client_name: 'Reliable Motors Pvt Ltd',
    file_name: 'GST_Invoice_Sep_2026.pdf',
    file_type: 'PDF', file_size_kb: 420,
    category: 'GST', source: 'WhatsApp', status: 'Extracted',
    vault_path: path.join(VAULT_BASE_DIR, 'clients', '11111111-1111-1111-1111-111111111111', 'GST', '2026-27', 'sample.pdf'),
    assessment_year: '2026-27', confidence_score: 96,
    extracted_data: {
      invoice_number: 'INV-2026-889', vendor_name: 'Mahindra Auto Parts',
      vendor_gstin: '27AAACM1122K1Z9', taxable_value: 450000,
      gst_amount: 81000, total_amount: 531000, invoice_date: '2026-09-28'
    },
    created_at: '2026-10-08T10:30:00Z'
  }
];

// GET /api/v1/documents — List documents (optional ?clientId= filter)
router.get('/', async (req, res) => {
  try {
    if (isConnected) {
      const ownedClientIds = await getOwnedClientIds(req.user.id);
      let query = supabase.from('documents_metadata').select('*').in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000']).order('created_at', { ascending: false });
      if (req.query.clientId) query = query.eq('client_id', req.query.clientId);
      if (req.query.status) query = query.eq('status', req.query.status);
      if (req.query.category) query = query.eq('category', req.query.category);
      const { data, error } = await query;
      if (error) throw error;
      return res.json({ success: true, count: data.length, source: 'supabase', data });
    }
    let docs = fallbackDocuments;
    if (req.query.clientId) docs = docs.filter(d => d.client_id === req.query.clientId);
    res.json({ success: true, count: docs.length, source: 'demo', data: docs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/documents/:id — Get single document metadata
router.get('/:id', async (req, res) => {
  try {
    if (isConnected) {
      const { data, error } = await supabase
        .from('documents_metadata').select('*').eq('id', req.params.id).in('client_id', (await getOwnedClientIds(req.user.id)).length ? await getOwnedClientIds(req.user.id) : ['00000000-0000-0000-0000-000000000000']).single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data });
    }
    const doc = fallbackDocuments.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    res.json({ success: true, source: 'demo', data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/v1/documents/upload-vault
 * Save physical file to Local Vault Storage, save metadata to Supabase
 * Body: { clientId, clientName, fileName, fileType, category, fileBase64, source, assessmentYear }
 */
router.post('/upload-vault', async (req, res) => {
  try {
    const { clientId, clientName, fileName, fileType, category, fileBase64, source, assessmentYear } = req.body;

    if (!clientId || !fileName) {
      return res.status(400).json({ success: false, message: 'clientId and fileName are required' });
    }

    if (isConnected && !(await assertOwnedClient(req.user.id, clientId))) {
      return res.status(404).json({ success: false, message: 'Client not found.' });
    }

    // Step 1: Save physical file to Local Vault Storage
    let vaultPath = null;
    let fileSizeKb = 0;
    let savedFileName = fileName;

    if (fileBase64) {
      const saved = saveFileToVault(clientName || clientId, fileName, fileBase64, category || 'General', assessmentYear || '2026-27');
      vaultPath = saved.vaultPath;
      fileSizeKb = saved.fileSizeKb;
      savedFileName = saved.fileName;
    } else {
      // No file content — create metadata pointer only (e.g. WhatsApp media to be downloaded later)
      vaultPath = `PENDING_DOWNLOAD:${fileName}`;
    }

    // Step 2: Save metadata record to Supabase (no binary data)
    const allowedSources = new Set(['WhatsApp', 'Manual', 'Portal', 'Upload']);
    const normalizedSource = allowedSources.has(source) ? source : 'Manual';
    const docMeta = {
      client_id: clientId,
      client_name: clientName || 'Unknown',
      file_name: savedFileName,
      file_type: normalizeFileType(fileType, fileName),
      file_size_kb: fileSizeKb,
      category: category || 'General',
      source: normalizedSource,
      status: 'Pending',
      vault_path: vaultPath,
      assessment_year: assessmentYear || '2026-27'
    };

    if (isConnected) {
      const { data, error } = await supabase
        .from('documents_metadata').insert([docMeta]).select().single();
      if (error) {
        // The binary has already been safely written to the local vault. Keep
        // that file visible instead of reporting a misleading total failure
        // when a database migration has not been applied yet.
        if (isMissingDocumentsMetadataTable(error)) {
          console.error('[Documents] Metadata table is unavailable:', error.message);
          return res.status(201).json({
            success: true,
            source: 'local-vault',
            message: 'File saved to the Local Vault, but database metadata was not saved.',
            warning: 'Run services/backend/db/schema.sql in the Supabase SQL Editor to enable document metadata and AI extraction.',
            metadataSaved: false,
            data: { id: `local-${Date.now()}`, ...docMeta }
          });
        }
        throw error;
      }

      // Increment client's total_docs counter in Supabase
      try {
        await supabase.rpc('increment_client_docs', { cid: clientId });
      } catch (rpcError) {
        console.warn('[Documents] Could not increment client document count:', rpcError.message);
      }

      return res.status(201).json({
        success: true, source: 'supabase',
        message: 'File saved to Local Vault. Metadata stored in cloud database.',
        data
      });
    }

    // Fallback
    const newDoc = { id: `doc_${Date.now()}`, ...docMeta, created_at: new Date().toISOString() };
    fallbackDocuments.push(newDoc);
    res.status(201).json({
      success: true, source: 'demo',
      message: 'File saved to Local Vault (demo mode — metadata in memory).',
      data: newDoc
    });
  } catch (err) {
    console.error('[Documents] Upload error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

function isMissingDocumentsMetadataTable(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('pgrst205') || (text.includes('documents_metadata') && text.includes('schema cache'));
}

/**
 * GET /api/v1/documents/:id/serve
 * Stream/serve the physical file from Local Vault Storage to the browser/UI
 */
router.get('/:id/serve', async (req, res) => {
  try {
    let vaultPath = null;
    let storageObject = null;

    if (isConnected) {
      const ownedClientIds = await getOwnedClientIds(req.user.id);
      const { data, error } = await supabase
        .from('documents_metadata')
        .select('client_id, source, created_at, vault_path, file_name, storage_bucket, storage_object_path, mime_type')
        .eq('id', req.params.id)
        .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
        .single();
      if (error) throw error;
      vaultPath = data.vault_path;
      if (data.storage_bucket && data.storage_object_path) {
        if (data.source !== 'Telegram' || !isExpectedTelegramObject({
          bucket: data.storage_bucket,
          objectKey: data.storage_object_path,
          userId: req.user.id,
          clientId: data.client_id,
          createdAt: data.created_at,
          fileName: data.file_name
        })) {
          console.error(`[Documents] Refusing unexpected cloud storage reference for document ${req.params.id}.`);
          return res.status(404).json({ success: false, message: 'The cloud document reference is invalid.' });
        }
        storageObject = {
          bucket: data.storage_bucket,
          objectKey: data.storage_object_path,
          mimeType: normalizeMimeType(data.mime_type)
        };
      }
    } else {
      const doc = fallbackDocuments.find(d => d.id === req.params.id);
      if (doc) vaultPath = doc.vault_path;
    }

    if (storageObject) {
      const buffer = await downloadDocument(storageObject.bucket, storageObject.objectKey);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', storageObject.mimeType);
      res.setHeader('Content-Disposition', 'inline');
      return res.send(buffer);
    }

    if (!vaultPath || !vaultFileExists(vaultPath)) {
      return res.status(404).json({ success: false, message: 'Physical file not found in Local Vault Storage.' });
    }

    res.sendFile(path.resolve(vaultPath));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/sync/pending', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
      return res.status(400).json({ success: false, message: 'A valid deviceId is required.' });
    }

    const limitValue = Number(req.query.limit || 50);
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) {
      return res.status(400).json({ success: false, message: 'limit must be between 1 and 100.' });
    }

    const { data: documents, error } = await supabase.rpc('list_pending_document_sync', {
      p_user_id: req.user.id,
      p_device_id: deviceId,
      p_limit: limitValue
    });
    if (error) throw error;

    const pending = (documents || []).map(document => {
        const createdAt = new Date(document.created_at);
        if (Number.isNaN(createdAt.getTime())) throw new Error(`Document ${document.document_id} has an invalid creation date.`);
        return {
          id: document.document_id,
          clientName: document.client_name || 'unknown',
          fileName: document.file_name,
          sha256: document.file_sha256,
          year: String(createdAt.getFullYear()),
          month: new Intl.DateTimeFormat('en-US', { month: 'long' }).format(createdAt)
        };
      });

    return res.json({ success: true, data: pending });
  } catch (error) {
    console.error('[Documents] Local sync queue error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load the local document sync queue.' });
  }
});

router.post('/sync/receipt', async (req, res) => {
  try {
    const { deviceId, documentId, sha256 } = req.body || {};
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(String(deviceId || '')) || !uuidPattern.test(String(documentId || ''))) {
      return res.status(400).json({ success: false, message: 'Valid deviceId and documentId values are required.' });
    }
    if (!/^[0-9a-f]{64}$/i.test(String(sha256 || ''))) {
      return res.status(400).json({ success: false, message: 'A valid SHA-256 checksum is required.' });
    }

    const ownedClientIds = await getOwnedClientIds(req.user.id);
    const { data: document, error: documentError } = await supabase
      .from('documents_metadata')
      .select('id, file_sha256')
      .eq('id', documentId)
      .in('client_id', ownedClientIds.length ? ownedClientIds : ['00000000-0000-0000-0000-000000000000'])
      .single();
    if (documentError) throw documentError;
    if (!document.file_sha256 || document.file_sha256 !== String(sha256).toLowerCase()) {
      return res.status(409).json({ success: false, message: 'The local file checksum does not match the stored document.' });
    }

    const { error } = await supabase.from('document_sync_receipts').upsert({
      user_id: req.user.id,
      device_id: deviceId,
      document_id: documentId,
      file_sha256: document.file_sha256,
      synced_at: new Date().toISOString()
    }, { onConflict: 'user_id,device_id,document_id' });
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error('[Documents] Local sync receipt error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not record the local document sync.' });
  }
});

/**
 * POST /api/v1/documents/:id/verify
 * Mark a document's AI-extracted data as CA-verified
 */
router.post('/:id/verify', async (req, res) => {
  try {
    const { verifiedBy, correctedData } = req.body;

    if (isConnected) {
      const updatePayload = {
        status: 'Verified',
        verified_by: verifiedBy || 'CA Admin',
        verified_at: new Date().toISOString()
      };
      if (correctedData) updatePayload.extracted_data = correctedData;

      const { data, error } = await supabase
        .from('documents_metadata').update(updatePayload).eq('id', req.params.id).in('client_id', (await getOwnedClientIds(req.user.id)).length ? await getOwnedClientIds(req.user.id) : ['00000000-0000-0000-0000-000000000000']).select().single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data });
    }

    const doc = fallbackDocuments.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    doc.status = 'Verified';
    doc.verified_by = verifiedBy || 'CA Admin';
    doc.verified_at = new Date().toISOString();
    res.json({ success: true, source: 'demo', data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/v1/documents/:id/reject
 * Reject a document's extraction (mark for re-upload)
 */
router.post('/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    if (isConnected) {
      const { data, error } = await supabase
        .from('documents_metadata')
        .update({ status: 'Rejected', verified_by: reason || 'Quality check failed' })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data });
    }
    const doc = fallbackDocuments.find(d => d.id === req.params.id);
    if (doc) { doc.status = 'Rejected'; doc.reject_reason = reason; }
    res.json({ success: true, source: 'demo', data: doc || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
module.exports.fallbackDocuments = fallbackDocuments;
