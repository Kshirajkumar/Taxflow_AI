/**
 * TaxFlow.AI — Backend API Server
 * ═══════════════════════════════════════════════════════════════
 *
 * ARCHITECTURE SUMMARY:
 *
 *  ┌────────────────────────────────────────────────────────────┐
 *  │  React Desktop App  (apps/desktop/src)                     │
 *  │  All pages talk to this server via HTTP REST API           │
 *  └──────────────────────────┬─────────────────────────────────┘
 *                             │ HTTP Requests (port 5000)
 *                             ▼
 *  ┌────────────────────────────────────────────────────────────┐
 *  │  Express API Server  (this file)                           │
 *  │  Routes:                                                   │
 *  │   /api/v1/clients        → Client Master Registry          │
 *  │   /api/v1/documents      → File metadata + vault upload    │
 *  │   /api/v1/extraction     → Gemini AI OCR processing        │
 *  │   /api/v1/whatsapp       → WhatsApp webhook & messages     │
 *  │   /api/v1/deadlines      → Compliance tasks & deadlines    │
 *  │   /api/v1/generate       → AI Notice/Report generator      │
 *  └──────┬────────────────────────────────┬───────────────────┘
 *         │                                │
 *         ▼                                ▼
 *  ┌──────────────────┐        ┌───────────────────────────┐
 *  │ SUPABASE CLOUD   │        │ LOCAL VAULT STORAGE       │
 *  │ (Metadata only)  │        │ (Physical files only)     │
 *  │                  │        │                           │
 *  │ • clients        │        │ vault/                    │
 *  │ • documents_meta │        │ └── clients/              │
 *  │ • ai_usage_log   │        │     └── {client_id}/      │
 *  │ • whatsapp_msgs  │        │         ├── GST/2026-27/  │
 *  │ • compliance_tasks│       │         ├── Form16/       │
 *  │ • extracted_fields│       │         ├── Notice/       │
 *  └──────────────────┘        │         └── Generated/    │
 *                              └───────────────────────────┘
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import vault manager (must init before routes)
const { initVault } = require('./vault/vaultManager');

// Import all route modules
const authRouter = require('./routes/auth');
const clientsRouter = require('./routes/clients');
const documentsRouter = require('./routes/documents');
const extractionRouter = require('./routes/extraction');
const whatsappRouter = require('./routes/whatsapp');
const deadlinesRouter = require('./routes/deadlines');
const generateRouter = require('./routes/generate');
const metadataRouter = require('./routes/metadata');
const { requireAuth } = require('./middleware/requireAuth');

const { supabase, isConnected } = require('./db/supabase');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[API] ${new Date().toISOString().substring(11, 19)} ${req.method} ${req.path}`);
  next();
});

// ─── Initialize Local Vault Storage ───────────────────────────
initVault();

// ─── Mount Routes ─────────────────────────────────────────────
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/metadata', requireAuth, metadataRouter);
app.use('/api/v1/clients', requireAuth, clientsRouter);
app.use('/api/v1/notifications', requireAuth, require('./routes/notifications'));
app.use('/api/v1/documents', requireAuth, documentsRouter);
app.use('/api/v1/extraction', requireAuth, extractionRouter);
app.use('/api/v1/whatsapp', whatsappRouter);
app.use('/api/v1/deadlines', requireAuth, deadlinesRouter);
app.use('/api/v1/generate', requireAuth, generateRouter);

// ─── Health & System Status ────────────────────────────────────
app.get('/api/v1/health', async (req, res) => {
  const { getVaultBaseDir, getVaultUsage } = require('./vault/vaultManager');
  const fs = require('fs');
  const vaultDir = getVaultBaseDir();

  let dbStatus = 'demo_mode';
  let totalClients = 0;

  if (isConnected) {
    try {
      const { count } = await supabase.from('clients').select('*', { count: 'exact', head: true });
      totalClients = count || 0;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'error';
    }
  }

  res.json({
    status: 'ok',
    service: 'TaxFlow.AI Backend API v2.0',
    timestamp: new Date().toISOString(),
    database: {
      provider: 'Supabase',
      status: dbStatus,
      totalClients
    },
    vault: {
      status: fs.existsSync(vaultDir) ? 'active' : 'not_configured',
      path: vaultDir,
      usage: getVaultUsage()
    },
    ai: {
      provider: 'Google Gemini',
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      apiKeyConfigured: !!(process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('your_'))
    },
    whatsapp: {
      apiKeyConfigured: !!(process.env.WHATSAPP_ACCESS_TOKEN && !process.env.WHATSAPP_ACCESS_TOKEN.includes('your_'))
    },
    routes: [
      'GET  /api/v1/clients',
      'POST /api/v1/clients',
      'GET  /api/v1/clients/:id',
      'DELETE /api/v1/clients/:id',
      'GET  /api/v1/clients/:id/vault-summary',
      'GET  /api/v1/documents',
      'POST /api/v1/documents/upload-vault',
      'GET  /api/v1/documents/:id/serve',
      'POST /api/v1/documents/:id/verify',
      'POST /api/v1/extraction/process',
      'GET  /api/v1/extraction/pending',
      'GET  /api/v1/extraction/ai-usage',
      'GET  /api/v1/whatsapp/messages',
      'GET  /api/v1/whatsapp/webhook (Meta verification)',
      'POST /api/v1/whatsapp/webhook (Incoming messages)',
      'POST /api/v1/whatsapp/send',
      'GET  /api/v1/deadlines',
      'GET  /api/v1/deadlines/upcoming',
      'GET  /api/v1/deadlines/summary',
      'POST /api/v1/deadlines',
      'POST /api/v1/generate/notice-response',
      'POST /api/v1/generate/computation-sheet'
    ]
  });
});

// ─── 404 Handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
});

// ─── Global Error Handler ─────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
});

// ─── Start Server ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║    TaxFlow.AI Backend API Server v2.0         ║');
  console.log('╠═══════════════════════════════════════════════╣');
  console.log(`║  Server:    http://localhost:${PORT}              ║`);
  console.log(`║  Database:  ${isConnected ? 'Supabase ✅' : 'Demo Mode ⚠️ (set .env)   '}  ║`);
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('');
  console.log('  API Health:  http://localhost:5000/api/v1/health');
  console.log('  Clients:     http://localhost:5000/api/v1/clients');
  console.log('  Documents:   http://localhost:5000/api/v1/documents');
  console.log('  Deadlines:   http://localhost:5000/api/v1/deadlines');
  console.log('');
});
