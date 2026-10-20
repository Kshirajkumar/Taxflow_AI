const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { requireAuth } = require('../middleware/requireAuth');

const DEFAULT_TEMPLATES = [
  { template_key: 'docs', name: 'GST documents request', cat: 'Utility', body: 'Hello {name}, please upload your {period} sales & purchase invoices through your secure client portal: {portalLink}. Deadline: {due}.', protected: true },
  { template_key: 'pending', name: 'Missing document', cat: 'Utility', body: 'Hi {name}, we have not received the {doc} for {period} yet. Please upload it through your secure client portal: {portalLink}.', protected: true },
  { template_key: 'itr', name: 'ITR documents', cat: 'Utility', body: 'Hi {name}, to file your ITR please upload Form 16 / 26AS, bank interest certificates, and investment proofs through your secure client portal: {portalLink}.', protected: true },
  { template_key: 'portal_invite', name: 'Secure portal invitation', cat: 'Client portal', body: 'Hi {name}, open this private link from your CA to access your documents and upload files using our secure file-transfer service: {portalLink}\n\nUse the same email address your CA has on file. Please do not send tax, financial, identity, or other sensitive documents in Telegram.', protected: true },
];

function normalizedBody(body) {
  const value = body.trim();
  return value.includes('{portalLink}')
    ? value
    : `${value}\n\nUpload documents securely after signing in: {portalLink}`;
}

function validateTemplateFields({ name, cat, body }, { partial = false } = {}) {
  if (!partial || name !== undefined) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) return 'Template name must be between 1 and 200 characters.';
  }
  if (!partial || cat !== undefined) {
    if (cat !== undefined && (typeof cat !== 'string' || cat.trim().length > 50)) return 'Template category must be 50 characters or fewer.';
  }
  if (!partial || body !== undefined) {
    if (typeof body !== 'string' || !body.trim() || body.trim().length > 5000) return 'Template body must be between 1 and 5000 characters.';
  }
  return '';
}

async function ensureDefaultTemplates(userId) {
  const { data: existing, error: selectError } = await supabase
    .from('message_templates')
    .select('template_key')
    .eq('user_id', userId)
    .not('template_key', 'is', null);
  if (selectError) throw selectError;
  const existingKeys = new Set((existing || []).map((item) => item.template_key));
  for (const template of DEFAULT_TEMPLATES.filter((item) => !existingKeys.has(item.template_key))) {
    const { error } = await supabase.from('message_templates').insert({ ...template, user_id: userId });
    if (error && error.code !== '23505') throw error;
  }
}

// GET /api/v1/templates — List all message templates
router.get('/', requireAuth, async (req, res) => {
  try {
    if (isConnected) {
      await ensureDefaultTemplates(req.user.id);
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data: data || [] });
    }
    return res.json({ success: true, source: 'demo', data: [] });
  } catch (err) {
    console.error('[Templates] Could not list templates:', err.message);
    res.status(500).json({ success: false, message: 'Templates could not be loaded.' });
  }
});

// POST /api/v1/templates — Create a new message template
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, cat, body } = req.body || {};
    const validationError = validateTemplateFields({ name, cat, body });
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const category = typeof cat === 'string' ? cat.trim() : '';

    if (isConnected) {
      const { data, error } = await supabase
        .from('message_templates')
        .insert({
          user_id: req.user.id,
          name: name.trim(),
          cat: category || 'Utility',
          body: normalizedBody(body),
          protected: false,
        })
        .select('*')
        .single();
      if (error) throw error;
      return res.status(201).json({ success: true, source: 'supabase', data });
    }
    return res.status(201).json({ success: true, source: 'demo', data: { id: 'demo_' + Date.now(), name: name.trim(), cat: category || 'Utility', body: normalizedBody(body), protected: false } });
  } catch (err) {
    console.error('[Templates] Could not create template:', err.message);
    res.status(500).json({ success: false, message: 'Template could not be created.' });
  }
});

// PATCH /api/v1/templates/:id — Update a message template
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const templateId = String(req.params.id || '').trim();
    if (!templateId) {
      return res.status(400).json({ success: false, message: 'Template id is required.' });
    }
    const { name, cat, body } = req.body || {};
    const validationError = validateTemplateFields({ name, cat, body }, { partial: true });
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (cat !== undefined) updates.cat = cat.trim() || 'Utility';
    if (body !== undefined) updates.body = normalizedBody(body);
    if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: 'At least one template field must be provided.' });

    if (isConnected) {
      const { data: existing, error: existingError } = await supabase
        .from('message_templates')
        .select('protected')
        .eq('id', templateId)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Template not found.' });
      }
      const { data, error } = await supabase
        .from('message_templates')
        .update(updates)
        .eq('id', templateId)
        .eq('user_id', req.user.id)
        .select('*')
        .single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data });
    }
    return res.json({ success: true, source: 'demo', data: { id: templateId, ...updates } });
  } catch (err) {
    console.error('[Templates] Could not update template:', err.message);
    res.status(500).json({ success: false, message: 'Template could not be updated.' });
  }
});

// DELETE /api/v1/templates/:id — Delete a message template
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const templateId = String(req.params.id || '').trim();
    if (!templateId) {
      return res.status(400).json({ success: false, message: 'Template id is required.' });
    }

    if (isConnected) {
      const { data: existing, error: existingError } = await supabase
        .from('message_templates')
        .select('protected')
        .eq('id', templateId)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Template not found.' });
      }
      if (existing.protected) {
        return res.status(403).json({ success: false, message: 'This template is protected and cannot be deleted.' });
      }

      const { error } = await supabase
        .from('message_templates')
        .delete()
        .eq('id', templateId)
        .eq('user_id', req.user.id);
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data: { id: templateId } });
    }
    return res.json({ success: true, source: 'demo', data: { id: templateId } });
  } catch (err) {
    console.error('[Templates] Could not delete template:', err.message);
    res.status(500).json({ success: false, message: 'Template could not be deleted.' });
  }
});

module.exports = router;
