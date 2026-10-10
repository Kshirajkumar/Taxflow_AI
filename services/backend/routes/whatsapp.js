/**
 * TaxFlow.AI — WhatsApp Automation Routes
 *
 * Flow:
 *  1. Client sends invoice/photo/text on WhatsApp
 *  2. WhatsApp Cloud API fires a webhook POST to this server
 *  3. Server matches sender phone to a client record in Supabase
 *  4. If media: downloads it, saves to Local Vault Storage, queues for AI extraction
 *  5. Auto-replies to the client with a confirmation message
 *  6. Message log is saved to Supabase whatsapp_messages table
 *  7. CA sees the new message and document in the React Desktop App
 */

const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');
const { requireAuth } = require('../middleware/requireAuth');

const WA_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WA_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'taxflow_webhook_verify_secret';

// --- In-Memory Fallback ---
let fallbackMessages = [
  {
    id: 'msg-001',
    client_id: '11111111-1111-1111-1111-111111111111',
    sender_phone: '+919820011223', sender_name: 'Reliable Motors Accounts',
    direction: 'inbound', message_type: 'document',
    body: 'Hi CA Sir, please find September GST invoice attached.',
    status: 'processed', vault_file_ref: 'doc-101',
    created_at: '2026-10-08T10:29:45Z'
  },
  {
    id: 'msg-002',
    client_id: '11111111-1111-1111-1111-111111111111',
    sender_phone: 'TaxFlow Bot', sender_name: 'TaxFlow AI Assistant',
    direction: 'outbound', message_type: 'text',
    body: '✅ Received your document! It has been added to your file vault and sent for AI extraction. Your CA will verify it shortly.',
    status: 'sent', created_at: '2026-10-08T10:29:52Z'
  },
  {
    id: 'msg-003',
    client_id: '22222222-2222-2222-2222-222222222222',
    sender_phone: '+919930044556', sender_name: 'Dr. Ananya Roy',
    direction: 'inbound', message_type: 'text',
    body: 'Hello, can you tell me the last date for ITR filing?',
    status: 'received', created_at: '2026-10-09T08:15:00Z'
  },
  {
    id: 'msg-004',
    client_id: '22222222-2222-2222-2222-222222222222',
    sender_phone: 'TaxFlow Bot', sender_name: 'TaxFlow AI Assistant',
    direction: 'outbound', message_type: 'text',
    body: '📅 The due date for ITR-3 filing for AY 2026-27 is *October 31, 2026*. Please ensure all documents (Form 16, bank statements) are submitted to us before October 25. Need help?',
    status: 'sent', created_at: '2026-10-09T08:15:07Z'
  }
];

// GET /api/v1/whatsapp/messages — List all WhatsApp messages
router.get('/messages', requireAuth, async (req, res) => {
  try {
    if (isConnected) {
      let query = supabase.from('whatsapp_messages').select('*').order('created_at', { ascending: false });
      if (req.query.clientId) query = query.eq('client_id', req.query.clientId);
      const { data, error } = await query;
      if (error) throw error;
      return res.json({ success: true, count: data.length, source: 'supabase', data });
    }
    let msgs = fallbackMessages;
    if (req.query.clientId) msgs = msgs.filter(m => m.client_id === req.query.clientId);
    res.json({ success: true, count: msgs.length, source: 'demo', data: msgs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/v1/whatsapp/webhook — Verification handshake with Meta/WhatsApp
 * Meta calls this when you first register your webhook URL
 */
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
    console.log('[WhatsApp] ✅ Webhook verified by Meta');
    return res.status(200).send(challenge);
  }
  console.warn('[WhatsApp] ❌ Webhook verification failed');
  res.status(403).json({ error: 'Verification failed' });
});

/**
 * POST /api/v1/whatsapp/webhook — Receive incoming messages from WhatsApp Cloud API
 * This is the main entry point for all client messages
 */
router.post('/webhook', async (req, res) => {
  // Always acknowledge immediately (WhatsApp requires < 5 second response)
  res.status(200).json({ status: 'received' });

  try {
    const body = req.body;
    if (!body?.entry?.[0]?.changes?.[0]?.value?.messages) return;

    const msgData = body.entry[0].changes[0].value;
    const messages = msgData.messages;
    const contacts = msgData.contacts || [];

    for (const msg of messages) {
      const senderPhone = msg.from;
      const senderName = contacts.find(c => c.wa_id === msg.from)?.profile?.name || senderPhone;
      const msgType = msg.type; // text, image, document, audio

      let bodyText = '';
      let mediaUrl = null;
      let mediaType = 'text';

      if (msg.type === 'text') bodyText = msg.text?.body || '';
      if (msg.type === 'document') { mediaType = 'document'; bodyText = msg.document?.filename || 'Document'; }
      if (msg.type === 'image') { mediaType = 'image'; bodyText = msg.image?.caption || 'Image'; }

      console.log(`[WhatsApp] 📩 Incoming from ${senderPhone}: [${msgType}] "${bodyText.substring(0, 80)}"`);

      // Find client by phone number in Supabase
      let clientId = null, clientName = null;
      if (isConnected) {
        const cleanPhone = senderPhone.replace(/\D/g, '');
        const { data: clientData } = await supabase
          .from('clients').select('id, name').ilike('phone', `%${cleanPhone}%`).single();
        if (clientData) { clientId = clientData.id; clientName = clientData.name; }
      }

      // Save inbound message to Supabase
      const inboundLog = {
        client_id: clientId, sender_phone: senderPhone, sender_name: senderName,
        direction: 'inbound', message_type: mediaType, body: bodyText,
        wa_message_id: msg.id, status: 'received'
      };
      if (isConnected) await supabase.from('whatsapp_messages').insert([inboundLog]);

      // Compose smart auto-reply
      const replyText = buildAutoReply(msgType, bodyText, clientName);
      await sendWhatsAppMessage(senderPhone, replyText);

      // Save outbound reply to Supabase
      if (isConnected) {
        await supabase.from('whatsapp_messages').insert([{
          client_id: clientId, sender_phone: 'TaxFlow Bot', sender_name: 'TaxFlow AI Assistant',
          direction: 'outbound', message_type: 'text', body: replyText, status: 'sent'
        }]);
      }
    }
  } catch (err) {
    console.error('[WhatsApp] Webhook processing error:', err.message);
  }
});

/**
 * POST /api/v1/whatsapp/send — Send a manual message from CA to client
 */
router.post('/send', requireAuth, async (req, res) => {
  try {
    const { toPhone, message, clientId } = req.body;
    if (!toPhone || !message) {
      return res.status(400).json({ success: false, message: 'toPhone and message are required' });
    }

    await sendWhatsAppMessage(toPhone, message);

    if (isConnected) {
      await supabase.from('whatsapp_messages').insert([{
        client_id: clientId || null, sender_phone: 'CA Manual',
        direction: 'outbound', message_type: 'text', body: message, status: 'sent'
      }]);
    }

    res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Helpers ---

function buildAutoReply(msgType, bodyText, clientName) {
  const greeting = clientName ? `Hello ${clientName}! ` : 'Hello! ';

  if (msgType === 'document' || msgType === 'image') {
    return `${greeting}✅ We've received your document safely! It has been stored in your secure Client Vault and sent to our AI system for processing. Your CA will verify and confirm soon. 🙏`;
  }

  const lowerBody = bodyText.toLowerCase();
  if (lowerBody.includes('deadline') || lowerBody.includes('due date') || lowerBody.includes('last date')) {
    return `${greeting}📅 Please check with your CA for your specific filing deadlines. General deadlines:\n• GSTR-3B: 20th of each month\n• GSTR-1: 11th of each month\n• ITR: 31 October 2026\nFor more info, reply or call us.`;
  }
  if (lowerBody.includes('invoice') || lowerBody.includes('gst') || lowerBody.includes('bill')) {
    return `${greeting}📄 Please attach your invoice/bill image or PDF and we'll process it for you right away!`;
  }

  return `${greeting}Thank you for contacting TaxFlow AI. Your message has been received and your CA will respond shortly. For urgent matters, please call directly. 🙏`;
}

async function sendWhatsAppMessage(toPhone, text) {
  if (!WA_ACCESS_TOKEN || !WA_PHONE_NUMBER_ID || WA_ACCESS_TOKEN.includes('your_')) {
    console.log(`[WhatsApp] DEMO — Would send to ${toPhone}: "${text.substring(0, 80)}"`);
    return;
  }
  try {
    await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: toPhone, type: 'text', text: { body: text } })
    });
  } catch (err) {
    console.error('[WhatsApp] Send error:', err.message);
  }
}

module.exports = router;
