const express = require('express');
const crypto = require('node:crypto');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const {
  createClientPortalInvite,
  deriveTelegramPortalInviteToken,
  hashInviteToken,
} = require('../lib/clientPortalInvites');
const { requireAuth } = require('../middleware/requireAuth');
const { assertOwnedClient } = require('../lib/ownership');

const botToken = () => process.env.TELEGRAM_BOT_TOKEN || '';
const webhookSecret = () => process.env.TELEGRAM_WEBHOOK_SECRET || '';
const botUsername = () => String(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
const webhookAutoConfigureEnabled = () => String(process.env.TELEGRAM_WEBHOOK_AUTO_CONFIGURE || '').toLowerCase() === 'true';
const PORTAL_INVITE_LINK_PATTERN = /https?:\/\/[^\s<>"']+\/portal#invite=[A-Za-z0-9_-]{40,64}/gi;

function redactPortalInviteLinks(message) {
  return message.replace(PORTAL_INVITE_LINK_PATTERN, '[private client portal invitation link]');
}
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function secretMatches(value, expected) { const left = Buffer.from(String(value || '')); const right = Buffer.from(String(expected || '')); return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right); }

function isMissingDatabaseSchema(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return ['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code)
    || /relation .* does not exist|could not find .* in the schema cache/i.test(message);
}

function getUnsupportedTelegramMessageType(message) {
  const unsupportedTypes = [
    ['photo', message.photo],
    ['document', message.document],
    ['video', message.video],
    ['animation', message.animation],
    ['video_note', message.video_note],
    ['audio', message.audio],
    ['voice', message.voice],
    ['sticker', message.sticker],
    ['contact', message.contact],
    ['location', message.location],
    ['venue', message.venue],
    ['poll', message.poll],
    ['dice', message.dice],
    ['game', message.game],
    ['story', message.story],
    ['paid_media', message.paid_media],
    ['checklist', message.checklist],
  ];
  return unsupportedTypes.find(([, value]) => value)?.[0] || null;
}

function publicTelegramMessage(message) {
  const {
    telegram_file_id,
    telegram_file_name,
    file_size,
    vault_file_ref,
    file_download_error,
    attachment_download_status,
    attachment_download_attempts,
    attachment_download_next_attempt_at,
    attachment_download_started_at,
    file_download_pending,
    ...visibleMessage
  } = message;
  if (!telegram_file_id && !telegram_file_name && !vault_file_ref && !file_download_pending) {
    return visibleMessage;
  }
  return {
    ...visibleMessage,
    body: 'Telegram supports text messages only. This file was not processed; use the secure client portal for document uploads.',
    message_type: 'text',
  };
}

async function telegramCall(method, payload) {
  if (!botToken()) throw new Error('Telegram bot is not configured');
  const response = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API request failed (${response.status})`);
  return result.result;
}

function getClientPortalLink(inviteToken) {
  if (typeof inviteToken !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(inviteToken)) {
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
  return `${portalUrl.origin}/portal#invite=${encodeURIComponent(inviteToken)}`;
}

function createTelegramWelcome(clientName) {
  return [
    `Welcome to TaxFlow, ${clientName}! Your private Telegram chat is connected.`,
    '',
    'Privacy reminder: use Telegram for ordinary messages and questions only. Do not send tax, financial, identity, or other sensitive documents here. Upload files only through your secure client portal.',
    '',
    'I will send your private client portal invitation in the next message.',
    'Use that portal for all document uploads.',
  ].join('\n');
}

function createTelegramPortalInvitation(inviteToken) {
  if (!inviteToken) {
    return 'Your secure client portal invitation is unavailable or has expired. Please ask your CA to issue a new invitation.';
  }
  return [
    `Your secure client portal invitation is ready:\n${getClientPortalLink(inviteToken)}`,
    '',
    'Open the link and use the same email address you gave your CA.',
    'Create a password the first time. On future visits, sign in with that email and password.',
    'Your invitation is private; do not forward it. If you lose access, contact your CA for a new invitation.',
    'Upload documents only through the secure portal. Do not send documents in Telegram.',
  ].join('\n');
}

async function sendTrackedTelegramMessage({ client, chatId, providerMessageId, body, label }) {
  let { data: queuedMessage, error: queueError } = await supabase.from('telegram_messages')
    .insert({
      client_id: client.id,
      provider_message_id: providerMessageId,
      direction: 'outbound',
      chat_id: String(chatId),
      body: redactPortalInviteLinks(body),
      delivery_status: 'queued'
    })
    .select('*')
    .single();

  if (queueError?.code === '23505') {
    const existing = await supabase.from('telegram_messages')
      .select('*')
      .eq('provider_message_id', providerMessageId)
      .eq('direction', 'outbound')
      .single();
    if (existing.error) throw existing.error;
    queuedMessage = existing.data;
    if (queuedMessage.delivery_status === 'sent') return;
  } else if (queueError) {
    throw queueError;
  }

  try {
    const sent = await telegramCall('sendMessage', { chat_id: chatId, text: body });
    const { error: updateError } = await supabase.from('telegram_messages')
      .update({ delivery_status: 'sent', provider_response_id: String(sent.message_id), sender_user_id: String(sent.from?.id || '') })
      .eq('provider_message_id', providerMessageId)
      .eq('direction', 'outbound');
    if (updateError) console.error(`[Telegram] ${label} was sent but its delivery status could not be saved:`, updateError.message);
  } catch (error) {
    const { error: statusError } = await supabase.from('telegram_messages')
      .update({ delivery_status: 'failed' })
      .eq('provider_message_id', providerMessageId)
      .eq('direction', 'outbound');
    if (statusError) console.error(`[Telegram] ${label} failure status could not be saved:`, statusError.message);
    throw error;
  }
}

async function sendTelegramWelcome(client, chatId, telegramToken, createdBy) {
  let portalInviteToken = deriveTelegramPortalInviteToken(telegramToken);
  const { data: invitation, error: invitationLookupError } = await supabase.from('client_portal_invites')
    .select('id,invited_email,expires_at,consumed_at,revoked_at')
    .eq('token_hash', hashInviteToken(portalInviteToken))
    .maybeSingle();
  if (invitationLookupError) throw invitationLookupError;
  if (!invitation) {
    if (!client.email || client.status !== 'Active') {
      throw new Error('An active client email is required to create the portal invitation.');
    }
    await createClientPortalInvite({
      clientId: client.id,
      email: client.email,
      createdBy,
      token: portalInviteToken,
    });
  } else if (
    invitation.consumed_at
    || invitation.revoked_at
    || new Date(invitation.expires_at).getTime() <= Date.now()
    || String(invitation.invited_email || '').trim().toLowerCase() !== String(client.email || '').trim().toLowerCase()
  ) {
    portalInviteToken = null;
  }

  await sendTrackedTelegramMessage({
    client,
    chatId,
    providerMessageId: `taxflow:welcome:${client.id}:${chatId}`,
    body: createTelegramWelcome(client.name),
    label: 'Welcome message',
  });
  await sendTrackedTelegramMessage({
    client,
    chatId,
    providerMessageId: `taxflow:portal-invite:${client.id}:${chatId}`,
    body: createTelegramPortalInvitation(portalInviteToken),
    label: 'Portal invitation message',
  });
}

function expectedWebhookUrl() {
  if (!webhookAutoConfigureEnabled()) {
    const relayUrl = String(process.env.TELEGRAM_WEBHOOK_RELAY_URL || '').trim();
    if (relayUrl) {
      try {
        const parsed = new URL(relayUrl);
        if (parsed.protocol === 'https:' && parsed.pathname === '/telegram/webhook' && !parsed.search
          && !parsed.hash && !parsed.username && !parsed.password) {
          return parsed.toString().replace(/\/+$/, '');
        }
      } catch {
        return null;
      }
      return null;
    }
  }
  const publicUrl = String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  return publicUrl ? `${publicUrl}/api/v1/telegram/webhook` : null;
}

async function configureWebhook() {
  if (!webhookAutoConfigureEnabled()) {
    console.log('[Telegram] Webhook auto-configuration is disabled; the registered Telegram webhook was left unchanged.');
    return { configured: false, reason: 'auto_configuration_disabled' };
  }
  const webhookUrl = expectedWebhookUrl();
  if (!webhookUrl) {
    console.warn('[Telegram] Webhook auto-configuration skipped: PUBLIC_URL/RENDER_EXTERNAL_URL is not set.');
    return { configured: false, reason: 'public_url_missing' };
  }
  if (!/^https:\/\//i.test(webhookUrl)) throw new Error('Telegram webhook public URL must use HTTPS');
  if (!webhookSecret()) throw new Error('TELEGRAM_WEBHOOK_SECRET must be configured before enabling the Telegram webhook.');
  await telegramCall('setWebhook', { url: webhookUrl, ...(webhookSecret() ? { secret_token: webhookSecret() } : {}), allowed_updates: ['message', 'edited_message'] });
  console.log(`[Telegram] Webhook configured: ${webhookUrl}`);
  return { configured: true, webhookUrl };
}

router.get('/status', requireAuth, async (_req, res) => {
  const warnings = [];
  let bot;
  let webhookInfo = null;
  let telegramSchemaReady = false;
  let clientPortalInvitesReady = false;
  try {
    bot = await telegramCall('getMe', {});
    webhookInfo = await telegramCall('getWebhookInfo', {});
  } catch (error) {
    return res.status(503).json({ success: false, connected: false, message: error.message });
  }

  const targetWebhookUrl = expectedWebhookUrl();
  const webhookIngress = webhookAutoConfigureEnabled()
    ? 'direct'
    : process.env.TELEGRAM_WEBHOOK_RELAY_URL ? 'relay' : 'unconfigured';
  if (!isConnected || !supabase) {
    warnings.push('This backend is not connected to Supabase. Telegram messages cannot be saved.');
  } else {
    try {
      const [
        { error: messagesSchemaError },
        { error: linkTokensSchemaError },
        { error: invitesSchemaError },
      ] = await Promise.all([
        supabase.from('telegram_messages')
          .select('id,body')
          .limit(1),
        supabase.from('telegram_link_tokens').select('id').limit(1),
        supabase.from('client_portal_invites').select('id').limit(1),
      ]);
      telegramSchemaReady = !messagesSchemaError && !linkTokensSchemaError;
      clientPortalInvitesReady = !invitesSchemaError;
      if (!telegramSchemaReady) {
        throw messagesSchemaError || linkTokensSchemaError;
      }
    } catch (error) {
      console.error('[Telegram] Runtime database schema check failed:', error.message);
      warnings.push('Telegram message or connection-link migrations are missing, or the configured Supabase project is unavailable. Apply the Telegram text and link migrations to the project used by this backend.');
    }
    if (!clientPortalInvitesReady) {
      warnings.push('Client connection links require the client_portal and client_portal_invites migrations. Apply the Telegram setup migrations to the same Supabase project used by this backend.');
    }
  }

  if (!webhookInfo?.url) {
    warnings.push('No Telegram webhook is currently registered for this bot.');
  } else if (targetWebhookUrl && webhookInfo.url.replace(/\/+$/, '') !== targetWebhookUrl) {
    warnings.push('Telegram is delivering updates to a different service than this backend. Check the webhook URL and ensure only the intended Render service configures this bot.');
  }
  if (webhookInfo?.last_error_message) {
    warnings.push(`Telegram reported a recent webhook delivery error: ${webhookInfo.last_error_message}`);
  }
  if (!targetWebhookUrl) {
    warnings.push(webhookIngress === 'relay'
      ? 'TELEGRAM_WEBHOOK_RELAY_URL is invalid. Set it to the relay service HTTPS URL ending in /telegram/webhook.'
      : 'Set PUBLIC_URL on the direct webhook service, or configure TELEGRAM_WEBHOOK_RELAY_URL when using the separate relay service.');
  }

  return res.json({
    success: true,
    connected: true,
    bot: { id: bot.id, username: bot.username, name: bot.first_name },
    diagnostics: {
      expectedWebhookUrl: targetWebhookUrl,
      webhookUrl: webhookInfo?.url || null,
      webhookMatchesThisService: targetWebhookUrl
        ? webhookInfo?.url?.replace(/\/+$/, '') === targetWebhookUrl
        : null,
      webhookPendingUpdates: Number(webhookInfo?.pending_update_count || 0),
      webhookLastError: webhookInfo?.last_error_message || null,
      telegramSchemaReady,
      clientPortalInvitesReady,
      webhookAutoConfigureEnabled: webhookAutoConfigureEnabled(),
      webhookIngress,
      warnings
    }
  });
});

router.post('/clients/:clientId/link', requireAuth, async (req, res) => {
  try {
    if (!isConnected || !(await assertOwnedClient(req.user.id, req.params.clientId))) return res.status(404).json({ success: false, message: 'Client not found.' });
    const { data: client, error: clientError } = await supabase.from('clients')
      .select('id,email,status')
      .eq('id', req.params.clientId)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client) return res.status(404).json({ success: false, message: 'Client not found.' });
    if (client.status !== 'Active') return res.status(422).json({ success: false, message: 'Only active clients can be connected to Telegram.' });
    const clientEmail = String(client.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail) || clientEmail.length > 254) {
      return res.status(422).json({ success: false, message: 'Add a valid client email address before creating their secure portal invitation.' });
    }
    const username = botUsername() || (await telegramCall('getMe', {})).username;
    const raw = crypto.randomBytes(32).toString('base64url');
    const portalInviteToken = deriveTelegramPortalInviteToken(raw);
    getClientPortalLink(portalInviteToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const telegramTokenHash = hash(raw);
    const { error } = await supabase.from('telegram_link_tokens').insert({ client_id: req.params.clientId, token_hash: telegramTokenHash, expires_at: expiresAt, created_by: req.user.id });
    if (error) throw error;
    try {
      await createClientPortalInvite({
        clientId: client.id,
        email: clientEmail,
        createdBy: req.user.id,
        token: portalInviteToken,
      });
    } catch (inviteError) {
      const { error: cleanupError } = await supabase.from('telegram_link_tokens')
        .delete()
        .eq('token_hash', telegramTokenHash);
      if (cleanupError) console.error('[Telegram] Failed to remove the incomplete client link token:', cleanupError.message);
      throw inviteError;
    }
    return res.status(201).json({ success: true, link: `https://t.me/${username}?start=${encodeURIComponent(raw)}`, expiresAt });
  } catch (error) {
    console.error('[Telegram] Could not create a client connection invitation:', error.message);
    if (isMissingDatabaseSchema(error)) {
      return res.status(503).json({
        success: false,
        message: 'Telegram database setup is incomplete. Apply the Telegram, client portal, and client portal invitation migrations to the Supabase project configured by this backend, then retry.',
      });
    }
    if (/CLIENT_PORTAL_URL|Portal invitation signing is not configured/i.test(String(error.message || ''))) {
      return res.status(503).json({
        success: false,
        message: 'Secure client invitations are not configured. Set CLIENT_PORTAL_URL and SUPABASE_SERVICE_ROLE_KEY on the backend, then retry.',
      });
    }
    return res.status(500).json({ success: false, message: 'Could not create the secure client connection invitation. Please try again.' });
  }
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
      supabase.from('telegram_messages').select('*')
        .eq('client_id', req.params.clientId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit),
      supabase.from('clients').select('id,name,telegram_chat_id').eq('id', req.params.clientId).eq('user_id', req.user.id).single(),
    ]);
    if (error) throw error;
    if (clientError) throw clientError;

    const messages = (data || []).reverse();

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
      data: messages.map(publicTelegramMessage)
    });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

router.post('/clients/:clientId/messages/:messageId/download', requireAuth, (_req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Telegram file downloads are disabled. Ask the client to upload documents through the secure client portal.'
  });
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
      .insert({ client_id: clientId, provider_message_id: providerMessageId, direction: 'outbound', chat_id: String(client.telegram_chat_id), body: redactPortalInviteLinks(message.trim()), delivery_status: 'queued', approved_by: req.user.id, approved_at: new Date().toISOString() })
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

router.post('/clients/:clientId/send-file', requireAuth, (_req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Sending files through Telegram is disabled. Use the secure client portal for document sharing.'
  });
});

router.post('/webhook', express.json({ limit: '2mb' }), async (req, res) => {
  if (!webhookSecret()) {
    console.error('[Telegram] Webhook request rejected: TELEGRAM_WEBHOOK_SECRET is not configured.');
    return res.status(503).json({ ok: false, message: 'Telegram webhook is not configured.' });
  }
  if (!secretMatches(req.headers['x-telegram-bot-api-secret-token'], webhookSecret())) return res.sendStatus(401);
  const update = req.body || {};
  const message = update.message || update.edited_message;
  const unsupportedType = message ? getUnsupportedTelegramMessageType(message) : null;
  if (unsupportedType) {
    console.info(`[Telegram] Ignored ${unsupportedType} update ${update.update_id ?? 'unknown'}; file transfers are disabled.`);
    return res.status(200).json({ ok: true, ignored: true, reason: 'text_messages_only' });
  }
  if (!isConnected || !supabase) {
    console.error('[Telegram] Webhook request rejected: Supabase is not configured.');
    return res.status(503).json({ ok: false, message: 'Message storage is unavailable; Telegram should retry this update.' });
  }

  try {
    if (!message?.chat?.id) return res.status(200).json({ ok: true, ignored: true });
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if (text.startsWith('/start')) {
      const token = text.replace(/^\/start(?:@[^\s]+)?\s*/i, '').trim();
      if (!token || message.chat.type !== 'private') return res.status(200).json({ ok: true, ignored: true });
      const { data: link, error: linkLookupError } = await supabase.from('telegram_link_tokens')
        .select('id,client_id,created_by,consumed_at,expires_at')
        .eq('token_hash', hash(token))
        .maybeSingle();
      if (linkLookupError) throw linkLookupError;
      if (!link) return res.status(200).json({ ok: true, ignored: true });
      const { data: client, error: clientLookupError } = await supabase.from('clients')
        .select('id,name,email,status,telegram_chat_id,telegram_user_id')
        .eq('id', link.client_id)
        .single();
      if (clientLookupError) throw clientLookupError;
      if (!client) return res.status(200).json({ ok: true, ignored: true });
      const telegramUserId = message.from?.id ? String(message.from.id) : null;
      if (link.consumed_at) {
        if (
          String(client.telegram_chat_id || '') === String(message.chat.id)
          && String(client.telegram_user_id || '') === String(telegramUserId || '')
        ) {
          await sendTelegramWelcome(client, message.chat.id, token, link.created_by);
          return res.status(200).json({ ok: true, duplicate: true });
        }
        return res.status(200).json({ ok: true, ignored: true });
      }
      if (!link.expires_at || new Date(link.expires_at).getTime() <= Date.now()) {
        return res.status(200).json({ ok: true, ignored: true });
      }
      const { data: consumed, error: consumeError } = await supabase.from('telegram_link_tokens').update({ consumed_at: new Date().toISOString() }).eq('id', link.id).is('consumed_at', null).select('id').maybeSingle();
      if (consumeError) throw consumeError;
      if (!consumed) return res.status(200).json({ ok: true, ignored: true });
      const { error: linkError } = await supabase.from('clients').update({ telegram_user_id: telegramUserId, telegram_chat_id: String(message.chat.id), telegram_linked_at: new Date().toISOString() }).eq('id', client.id);
      if (linkError) {
        const { error: restoreError } = await supabase.from('telegram_link_tokens').update({ consumed_at: null }).eq('id', link.id);
        if (restoreError) console.error('[Telegram] failed to restore consumed link token:', restoreError.message);
        throw linkError;
      }
      await sendTelegramWelcome(client, message.chat.id, token, link.created_by);
      return res.status(200).json({ ok: true });
    }
    if (message.chat.type !== 'private') {
      console.warn(`[Telegram] Ignored message ${message.message_id} from unsupported ${message.chat.type} chat ${message.chat.id}.`);
      return res.status(200).json({ ok: true, ignored: true, reason: 'private_chat_required' });
    }
    const { data: client, error: clientError } = await supabase.from('clients').select('id,name,user_id').eq('telegram_chat_id', String(message.chat.id)).maybeSingle();
    if (clientError) throw clientError;
    if (!client) {
      console.warn(`[Telegram] Ignored inbound message from unlinked chat ${message.chat.id}.`);
      return res.status(200).json({ ok: true, ignored: true });
    }
    if (!text) return res.status(200).json({ ok: true, ignored: true, reason: 'text_messages_only' });
    const body = redactPortalInviteLinks(text);
    const telegramDate = Number(message.date);
    const createdAt = Number.isFinite(telegramDate) && telegramDate > 0
      ? new Date(telegramDate * 1000).toISOString()
      : new Date().toISOString();
    const { data: savedMessage, error } = await supabase.from('telegram_messages').insert({
      client_id: client.id,
      provider_message_id: `telegram:update:${String(update.update_id || message.message_id)}`,
      direction: 'inbound',
      chat_id: String(message.chat.id),
      sender_user_id: message.from?.id ? String(message.from.id) : null,
      body,
      message_type: 'text',
      delivery_status: 'received',
      created_at: createdAt
    }).select('*').single();
    if (error?.code === '23505') {
      const { data: duplicate, error: duplicateError } = await supabase.from('telegram_messages')
        .select('*')
        .eq('provider_message_id', `telegram:update:${String(update.update_id || message.message_id)}`)
        .eq('direction', 'inbound')
        .single();
      if (duplicateError) throw duplicateError;
      return res.status(200).json({ ok: true, duplicate: true });
    }
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[Telegram] webhook processing failed; returning a retryable response:', error.message);
    return res.status(503).json({ ok: false, message: 'Telegram update could not be stored; please retry.' });
  }
});

module.exports = router;
module.exports.configureWebhook = configureWebhook;
module.exports._test = {
  secretMatches,
  expectedWebhookUrl,
  webhookAutoConfigureEnabled,
  isMissingDatabaseSchema,
  configureWebhook,
  getUnsupportedTelegramMessageType,
  publicTelegramMessage
};
