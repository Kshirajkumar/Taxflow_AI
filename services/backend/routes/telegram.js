const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { requireAuth } = require('../middleware/requireAuth');
const { assertOwnedClient } = require('../lib/ownership');
const { saveFileToVault, deleteVaultFile, getCurrentVaultPeriod } = require('../vault/vaultManager');

const botToken = () => process.env.TELEGRAM_BOT_TOKEN || '';
const webhookSecret = () => process.env.TELEGRAM_WEBHOOK_SECRET || '';
const botUsername = () => String(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const TELEGRAM_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
const attachmentDownloads = new Map();
const attachmentDownloadQueue = [];
let activeAttachmentDownloads = 0;
const MAX_CONCURRENT_ATTACHMENT_DOWNLOADS = 4;
const FILE_TYPES = {
  '.pdf': 'PDF', '.png': 'PNG', '.jpg': 'JPG', '.jpeg': 'JPEG', '.webp': 'WEBP',
  '.xls': 'XLS', '.xlsx': 'XLSX', '.csv': 'CSV', '.doc': 'DOC', '.docx': 'DOCX'
};
const MIME_EXTENSIONS = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/csv': '.csv',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
};
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function secretMatches(value, expected) { const left = Buffer.from(String(value || '')); const right = Buffer.from(String(expected || '')); return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right); }

function getTelegramAttachment(message) {
  if (message.document?.file_id) {
    return {
      fileId: message.document.file_id,
      fileName: message.document.file_name || `telegram-document-${message.message_id}`,
      mimeType: message.document.mime_type || 'application/octet-stream',
      fileSize: Number(message.document.file_size) || null,
      messageType: 'document'
    };
  }
  if (Array.isArray(message.photo) && message.photo.length) {
    const photo = message.photo[message.photo.length - 1];
    return {
      fileId: photo.file_id,
      fileName: `telegram-photo-${message.message_id}.jpg`,
      mimeType: 'image/jpeg',
      fileSize: Number(photo.file_size) || null,
      messageType: 'image'
    };
  }
  return null;
}

function normalizeTelegramFileName(fileName, mimeType) {
  const baseName = String(fileName || 'telegram-document').replace(/[\\/]/g, '_').replace(/[^\w.\- ]/g, '_').slice(0, 200);
  let extension = path.extname(baseName).toLowerCase();
  if (!FILE_TYPES[extension]) extension = MIME_EXTENSIONS[String(mimeType || '').split(';')[0].trim().toLowerCase()];
  if (!extension || !FILE_TYPES[extension]) {
    throw new Error('This Telegram attachment format is not supported for the client vault.');
  }
  const stem = path.basename(baseName, path.extname(baseName)).slice(0, 160) || 'telegram-document';
  return { fileName: `${stem}${extension}`, fileType: FILE_TYPES[extension] };
}

function getTelegramMessageDate(message) {
  const date = new Date(message?.created_at);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Telegram message has an invalid timestamp; its attachment cannot be filed.');
  }
  return date;
}

function getAssessmentYear(date) {
  const firstAssessmentYear = date.getFullYear() - (date.getMonth() < 3 ? 1 : 0);
  return `${firstAssessmentYear}-${String(firstAssessmentYear + 1).slice(-2)}`;
}

function processTelegramAttachmentDownload(message, client) {
  return (async () => {
    const { data: current, error: lookupError } = await supabase
      .from('telegram_messages')
      .select('vault_file_ref, telegram_file_id, telegram_file_name, mime_type, file_size, created_at')
      .eq('id', message.id)
      .eq('client_id', client.id)
      .single();
    if (lookupError) throw lookupError;
    if (current.vault_file_ref) return { ...message, ...current, file_download_error: null };

    const normalized = normalizeTelegramFileName(current.telegram_file_name, current.mime_type);
    if (current.file_size && Number(current.file_size) > TELEGRAM_FILE_LIMIT_BYTES) {
      throw new Error('Telegram files larger than 20 MB cannot be downloaded by this bot.');
    }

    const file = await telegramCall('getFile', { file_id: current.telegram_file_id });
    if (!file.file_path) throw new Error('Telegram did not provide a download path for this attachment.');
    if (Number(file.file_size) > TELEGRAM_FILE_LIMIT_BYTES) {
      throw new Error('Telegram files larger than 20 MB cannot be downloaded by this bot.');
    }
    const response = await fetch(`https://api.telegram.org/file/bot${botToken()}/${file.file_path}`, {
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Telegram file download failed (${response.status}).`);
    const buffer = await readTelegramFile(response);
    if (!buffer.length) throw new Error('Telegram returned an empty file.');

    const receivedAt = getTelegramMessageDate(current);
    // General is the document metadata category; the vault maps it to the Raw bucket.
    const saved = saveFileToVault(client.name, normalized.fileName, buffer.toString('base64'), 'General', undefined, receivedAt);
    const metadata = {
      client_id: client.id,
      client_name: client.name,
      file_name: saved.fileName,
      file_type: normalized.fileType,
      file_size_kb: saved.fileSizeKb,
      category: 'General',
      source: 'Telegram',
      status: 'Pending',
      vault_path: saved.vaultPath,
      assessment_year: getAssessmentYear(receivedAt),
      telegram_message_id: message.id
    };

    let document;
    const { data, error } = await supabase.from('documents_metadata').insert(metadata).select('id').single();
    if (error?.code === '23505') {
      deleteVaultFile(saved.vaultPath);
      const existing = await supabase.from('documents_metadata').select('id').eq('telegram_message_id', message.id).single();
      if (existing.error) throw existing.error;
      document = existing.data;
    } else if (error) {
      deleteVaultFile(saved.vaultPath);
      throw error;
    } else {
      document = data;
    }

    const { data: updated, error: updateError } = await supabase
      .from('telegram_messages')
      .update({ vault_file_ref: document.id, file_download_error: null })
      .eq('id', message.id)
      .eq('client_id', client.id)
      .select('*')
      .single();
    if (updateError) throw updateError;
    return updated;
  })().catch(async (error) => {
    const messageText = error instanceof Error ? error.message : 'Telegram attachment could not be downloaded.';
    const { error: updateError } = await supabase.from('telegram_messages')
      .update({ file_download_error: messageText })
      .eq('id', message.id)
      .eq('client_id', client.id);
    if (updateError) console.error('[Telegram] attachment failure status persistence failed:', updateError.message);
    console.error(`[Telegram] attachment download failed for message ${message.id}:`, messageText);
    return { ...message, file_download_error: messageText };
  });
}

function startQueuedAttachmentDownloads() {
  while (activeAttachmentDownloads < MAX_CONCURRENT_ATTACHMENT_DOWNLOADS && attachmentDownloadQueue.length) {
    const job = attachmentDownloadQueue.shift();
    activeAttachmentDownloads += 1;
    processTelegramAttachmentDownload(job.message, job.client)
      .then(job.resolve)
      .catch((error) => {
        console.error(`[Telegram] attachment queue failed for message ${job.message.id}:`, error);
        job.resolve({ ...job.message, file_download_error: 'Attachment download failed. Check the backend logs and retry.' });
      })
      .finally(() => {
        attachmentDownloads.delete(job.message.id);
        activeAttachmentDownloads -= 1;
        startQueuedAttachmentDownloads();
      });
  }
}

function downloadTelegramAttachment(message, client) {
  if (!message.telegram_file_id || message.vault_file_ref || message.file_download_error) {
    return Promise.resolve(message);
  }

  const pending = attachmentDownloads.get(message.id);
  if (pending) return pending;

  let resolve;
  const download = new Promise((complete) => { resolve = complete; });
  attachmentDownloads.set(message.id, download);
  attachmentDownloadQueue.push({ message, client, resolve });
  startQueuedAttachmentDownloads();
  return download;
}

function publicTelegramMessage(message) {
  const { telegram_file_id, ...visibleMessage } = message;
  return visibleMessage;
}

async function readTelegramFile(response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength && contentLength > TELEGRAM_FILE_LIMIT_BYTES) {
    throw new Error('Telegram files larger than 20 MB cannot be downloaded by this bot.');
  }
  if (!response.body) throw new Error('Telegram returned an empty file response.');

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > TELEGRAM_FILE_LIMIT_BYTES) {
      await reader.cancel();
      throw new Error('Telegram files larger than 20 MB cannot be downloaded by this bot.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

async function telegramCall(method, payload) {
  if (!botToken()) throw new Error('Telegram bot is not configured');
  const response = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API request failed (${response.status})`);
  return result.result;
}

async function configureWebhook() {
  const publicUrl = String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  if (!publicUrl) {
    console.warn('[Telegram] Webhook auto-configuration skipped: PUBLIC_URL/RENDER_EXTERNAL_URL is not set.');
    return { configured: false, reason: 'public_url_missing' };
  }
  if (!/^https:\/\//i.test(publicUrl)) throw new Error('Telegram webhook public URL must use HTTPS');
  if (!webhookSecret()) throw new Error('TELEGRAM_WEBHOOK_SECRET must be configured before enabling the Telegram webhook.');
  const webhookUrl = `${publicUrl}/api/v1/telegram/webhook`;
  await telegramCall('setWebhook', { url: webhookUrl, ...(webhookSecret() ? { secret_token: webhookSecret() } : {}), allowed_updates: ['message'] });
  console.log(`[Telegram] Webhook configured: ${webhookUrl}`);
  return { configured: true, webhookUrl };
}

router.get('/status', requireAuth, async (_req, res) => {
  try { const bot = await telegramCall('getMe', {}); return res.json({ success: true, connected: true, bot: { id: bot.id, username: bot.username, name: bot.first_name } }); }
  catch (error) { return res.status(503).json({ success: false, connected: false, message: error.message }); }
});

router.post('/clients/:clientId/link', requireAuth, async (req, res) => {
  try {
    if (!isConnected || !(await assertOwnedClient(req.user.id, req.params.clientId))) return res.status(404).json({ success: false, message: 'Client not found.' });
    const username = botUsername() || (await telegramCall('getMe', {})).username;
    const raw = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { error } = await supabase.from('telegram_link_tokens').insert({ client_id: req.params.clientId, token_hash: hash(raw), expires_at: expiresAt, created_by: req.user.id });
    if (error) throw error;
    return res.status(201).json({ success: true, link: `https://t.me/${username}?start=${encodeURIComponent(raw)}`, expiresAt });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.get('/search', requireAuth, async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 2 || query.length > 100) {
      return res.status(400).json({ success: false, message: 'Search text must be between 2 and 100 characters.' });
    }
    if (!isConnected) return res.json({ success: true, source: 'demo', data: [] });

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name')
      .eq('user_id', req.user.id)
      .limit(1000);
    if (clientsError) throw clientsError;
    const clientNames = new Map((clients || []).map((client) => [client.id, client.name]));
    if (!clientNames.size) return res.json({ success: true, source: 'supabase', data: [] });

    const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
    const { data: messages, error } = await supabase
      .from('telegram_messages')
      .select('id, client_id, body, created_at')
      .in('client_id', Array.from(clientNames.keys()))
      .ilike('body', `%${escapedQuery}%`)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;

    return res.json({
      success: true,
      source: 'supabase',
      data: (messages || []).map((message) => ({
        id: message.id,
        clientId: message.client_id,
        clientName: clientNames.get(message.client_id),
        body: message.body || '',
        createdAt: message.created_at
      }))
    });
  } catch (error) {
    console.error('[Telegram] Global message search failed:', error);
    return res.status(500).json({ success: false, message: 'Telegram conversations could not be searched.' });
  }
});

router.get('/unread', requireAuth, async (req, res) => {
  try {
    if (!isConnected) return res.json({ success: true, counts: {}, total: 0 });
    const { data: clients, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', req.user.id);
    if (clientError) throw clientError;
    const clientIds = (clients || []).map((c) => c.id);
    if (!clientIds.length) return res.json({ success: true, counts: {}, total: 0 });

    const { data: unreadRows, error } = await supabase
      .from('telegram_messages')
      .select('client_id')
      .in('client_id', clientIds)
      .eq('direction', 'inbound')
      .eq('is_read', false);
    if (error) throw error;

    const counts = {};
    let total = 0;
    (unreadRows || []).forEach((r) => {
      counts[r.client_id] = (counts[r.client_id] || 0) + 1;
      total += 1;
    });

    return res.json({ success: true, counts, total });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.get('/previews', requireAuth, async (req, res) => {
  try {
    if (!isConnected) return res.json({ success: true, data: {} });
    const { data: clients, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', req.user.id);
    if (clientError) throw clientError;
    const clientIds = (clients || []).map((client) => client.id);
    if (!clientIds.length) return res.json({ success: true, data: {} });

    const data = {};
    const batchSize = 10;
    for (let index = 0; index < clientIds.length; index += batchSize) {
      const batch = await Promise.all(clientIds.slice(index, index + batchSize).map(async (clientId) => {
        const { data: message, error } = await supabase
          .from('telegram_messages')
          .select('client_id,body,message_type,direction,created_at')
          .eq('client_id', clientId)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return message;
      }));
      batch.filter(Boolean).forEach((message) => {
        data[message.client_id] = message;
      });
    }
    return res.json({ success: true, data });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.post('/clients/:clientId/read', requireAuth, async (req, res) => {
  try {
    if (!isConnected || !(await assertOwnedClient(req.user.id, req.params.clientId))) return res.status(404).json({ success: false, message: 'Client not found.' });
    const { error } = await supabase.from('telegram_messages')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('client_id', req.params.clientId)
      .eq('direction', 'inbound')
      .eq('is_read', false);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.get('/clients/:clientId/messages', requireAuth, async (req, res) => {
  try {
    if (!isConnected || !(await assertOwnedClient(req.user.id, req.params.clientId))) return res.status(404).json({ success: false, message: 'Client not found.' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const [{ data, error }, { data: client, error: clientError }] = await Promise.all([
      supabase.from('telegram_messages').select('*').eq('client_id', req.params.clientId).order('created_at', { ascending: true }).limit(limit),
      supabase.from('clients').select('id,name,telegram_chat_id').eq('id', req.params.clientId).eq('user_id', req.user.id).single(),
    ]);
    if (error) throw error;
    if (clientError) throw clientError;

    const messages = data || [];
    messages.forEach((message) => {
      if (message.direction === 'inbound' && message.telegram_file_id && !message.vault_file_ref && !message.file_download_error) {
        void downloadTelegramAttachment(message, client);
      }
    });

    // Automatically mark unread inbound messages as read for this client
    const { error: markReadError } = await supabase.from('telegram_messages')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('client_id', req.params.clientId)
      .eq('direction', 'inbound')
      .eq('is_read', false);
    if (markReadError) throw markReadError;

    return res.json({
      success: true,
      linked: Boolean(client?.telegram_chat_id),
      data: messages.map((message) => publicTelegramMessage({
        ...message,
        file_download_pending: Boolean(message.telegram_file_id && !message.vault_file_ref && !message.file_download_error)
      }))
    });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.post('/clients/:clientId/messages/:messageId/download', requireAuth, async (req, res) => {
  try {
    if (!isConnected || !(await assertOwnedClient(req.user.id, req.params.clientId))) return res.status(404).json({ success: false, message: 'Client not found.' });
    const [{ data: client, error: clientError }, { data: message, error: messageError }] = await Promise.all([
      supabase.from('clients').select('id,name').eq('id', req.params.clientId).eq('user_id', req.user.id).single(),
      supabase.from('telegram_messages').select('*').eq('id', req.params.messageId).eq('client_id', req.params.clientId).eq('direction', 'inbound').single(),
    ]);
    if (clientError) throw clientError;
    if (messageError) throw messageError;
    if (!message.telegram_file_id) return res.status(422).json({ success: false, message: 'This Telegram message has no downloadable attachment.' });
    const updated = await downloadTelegramAttachment({ ...message, file_download_error: null }, client);
    if (updated.file_download_error) return res.status(502).json({ success: false, message: updated.file_download_error });
    return res.json({ success: true, data: publicTelegramMessage(updated) });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.post('/send', requireAuth, async (req, res) => {
  try {
    const { clientId, message, approved, requestId } = req.body || {};
    if (!clientId || typeof message !== 'string' || !message.trim() || message.length > 4096) return res.status(400).json({ success: false, message: 'clientId and a message between 1 and 4096 characters are required.' });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(requestId || ''))) return res.status(400).json({ success: false, message: 'A valid requestId is required.' });
    if (approved !== true) return res.status(422).json({ success: false, message: 'Explicit message approval is required.' });
    if (!isConnected || !(await assertOwnedClient(req.user.id, clientId))) return res.status(404).json({ success: false, message: 'Client not found.' });
    const { data: client, error: clientError } = await supabase.from('clients').select('id,telegram_chat_id').eq('id', clientId).eq('user_id', req.user.id).single();
    if (clientError) throw clientError;
    if (!client.telegram_chat_id) return res.status(422).json({ success: false, message: 'This client has not linked Telegram.' });
    const providerMessageId = `taxflow:${requestId}`;
    const { data: queuedMessage, error: queueError } = await supabase.from('telegram_messages')
      .insert({ client_id: clientId, provider_message_id: providerMessageId, direction: 'outbound', chat_id: String(client.telegram_chat_id), body: message.trim(), delivery_status: 'queued', approved_by: req.user.id, approved_at: new Date().toISOString() })
      .select('*')
      .single();
    if (queueError?.code === '23505') return res.status(409).json({ success: false, message: 'This message request has already been processed.' });
    if (queueError) throw queueError;
    try {
      const sent = await telegramCall('sendMessage', { chat_id: client.telegram_chat_id, text: message.trim() });
      const sentFields = { delivery_status: 'sent', provider_response_id: String(sent.message_id), sender_user_id: String(sent.from?.id || '') };
      const { data: sentMessage, error: updateError } = await supabase.from('telegram_messages')
        .update(sentFields)
        .eq('provider_message_id', providerMessageId)
        .eq('direction', 'outbound')
        .select('*')
        .single();
      if (updateError) {
        console.error('[Telegram] sent message status persistence failed:', updateError.message);
        return res.json({
          success: true,
          data: { ...queuedMessage, ...sentFields },
          warning: 'delivery_status_persistence_failed'
        });
      }
      return res.json({ success: true, data: sentMessage });
    } catch (error) {
      await supabase.from('telegram_messages').update({ delivery_status: 'failed' }).eq('provider_message_id', providerMessageId).eq('direction', 'outbound');
      throw error;
    }
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.post('/webhook', express.json({ limit: '2mb' }), async (req, res) => {
  if (!webhookSecret()) {
    console.error('[Telegram] Webhook request rejected: TELEGRAM_WEBHOOK_SECRET is not configured.');
    return res.status(503).json({ ok: false, message: 'Telegram webhook is not configured.' });
  }
  if (!secretMatches(req.headers['x-telegram-bot-api-secret-token'], webhookSecret())) return res.sendStatus(401);
  if (!isConnected || !supabase) {
    console.error('[Telegram] Webhook request rejected: Supabase is not configured.');
    return res.status(503).json({ ok: false, message: 'Message storage is unavailable; Telegram should retry this update.' });
  }

  try {
    const update = req.body || {}; const message = update.message || update.edited_message;
    if (!message?.chat?.id) return res.status(200).json({ ok: true, ignored: true });
    const text = typeof message.text === 'string'
      ? message.text.trim()
      : typeof message.caption === 'string' ? message.caption.trim() : '';
    if (text.startsWith('/start')) {
      const token = text.replace(/^\/start(?:@[^\s]+)?\s*/i, '').trim();
      if (!token || message.chat.type !== 'private') return res.status(200).json({ ok: true, ignored: true });
      const { data: link, error: linkLookupError } = await supabase.from('telegram_link_tokens').select('id,client_id').eq('token_hash', hash(token)).is('consumed_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (linkLookupError) throw linkLookupError;
      if (!link) return res.status(200).json({ ok: true, ignored: true });
      const { data: client, error: clientLookupError } = await supabase.from('clients').select('id,name').eq('id', link.client_id).single();
      if (clientLookupError) throw clientLookupError;
      if (!client) return res.status(200).json({ ok: true, ignored: true });
      const { data: consumed, error: consumeError } = await supabase.from('telegram_link_tokens').update({ consumed_at: new Date().toISOString() }).eq('id', link.id).is('consumed_at', null).select('id').maybeSingle();
      if (consumeError) throw consumeError;
      if (!consumed) return res.status(200).json({ ok: true, ignored: true });
      const { error: linkError } = await supabase.from('clients').update({ telegram_user_id: message.from?.id ? String(message.from.id) : null, telegram_chat_id: String(message.chat.id), telegram_linked_at: new Date().toISOString() }).eq('id', client.id);
      if (linkError) {
        const { error: restoreError } = await supabase.from('telegram_link_tokens').update({ consumed_at: null }).eq('id', link.id);
        if (restoreError) console.error('[Telegram] failed to restore consumed link token:', restoreError.message);
        throw linkError;
      }
      const welcome = `Your Telegram account is connected to TaxFlow for ${client.name}.`;
      const sent = await telegramCall('sendMessage', { chat_id: message.chat.id, text: welcome });
      const { error: welcomeError } = await supabase.from('telegram_messages').insert({ client_id: client.id, provider_message_id: `telegram:${message.chat.id}:${sent.message_id}`, direction: 'outbound', chat_id: String(message.chat.id), body: welcome, delivery_status: 'sent' });
      if (welcomeError) throw welcomeError;
      return res.status(200).json({ ok: true });
    }
    const attachment = getTelegramAttachment(message);
    if ((!text && !attachment) || message.chat.type !== 'private') return res.status(200).json({ ok: true, ignored: true });
    const { data: client, error: clientError } = await supabase.from('clients').select('id').eq('telegram_chat_id', String(message.chat.id)).maybeSingle();
    if (clientError) throw clientError;
    if (!client) {
      console.warn(`[Telegram] Ignored inbound message from unlinked chat ${message.chat.id}.`);
      return res.status(200).json({ ok: true, ignored: true });
    }
    const { error } = await supabase.from('telegram_messages').insert({
      client_id: client.id,
      provider_message_id: `telegram:update:${String(update.update_id || message.message_id)}`,
      direction: 'inbound',
      chat_id: String(message.chat.id),
      sender_user_id: message.from?.id ? String(message.from.id) : null,
      body: text || attachment.fileName,
      message_type: attachment?.messageType || 'text',
      ...(attachment ? {
        telegram_file_id: attachment.fileId,
        telegram_file_name: attachment.fileName,
        mime_type: attachment.mimeType,
        file_size: attachment.fileSize
      } : {}),
      delivery_status: 'received'
    });
    if (error && error.code !== '23505') throw error;
    return res.status(200).json({ ok: true, duplicate: error?.code === '23505' });
  } catch (error) {
    console.error('[Telegram] webhook processing failed; returning a retryable response:', error.message);
    return res.status(503).json({ ok: false, message: 'Telegram update could not be stored; please retry.' });
  }
});

module.exports = router;
module.exports.configureWebhook = configureWebhook;
module.exports._test = { secretMatches, getTelegramAttachment, normalizeTelegramFileName, getTelegramMessageDate, getAssessmentYear };
