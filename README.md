# Taxflow.AI

**AI-powered practice automation for Chartered Accountants and accounting firms.**

Taxflow.AI is a Windows desktop application that removes repetitive work from a CA practice: collecting client documents over WhatsApp, extracting data from invoices with AI, tracking compliance deadlines, and generating filing-ready outputs. Client files stay on the firm's own machine, and only metadata goes to the cloud.

> **Status:** Working demo (v0.1). Not yet production-ready. See [Roadmap](#roadmap).

---

## Features

| Module | What it does |
|---|---|
| **Dashboard** | Practice overview: clients, pending documents, upcoming deadlines |
| **Extract** | AI/OCR extraction of dates, amounts, GSTIN/PAN and line items from bills and invoices (Google Gemini) |
| **WhatsApp** | Receive client documents and send automated reminders via the WhatsApp Cloud API |
| **Files** | Local vault organised by client > year > month, raw vs. extracted |
| **Deadlines** | Per-client compliance tracking with progress bars |
| **Generate** | Draft notice responses and computation sheets (GSTR, ITR and more) from extracted data |
| **AI Assistant** | In-app chat panel that answers questions and jumps to the relevant page |

Also included: light/dark theme, a custom frameless Windows title bar, and firm sign-in and registration.

---

## Architecture

```
┌──────────────────────────────────────┐
│  Desktop App (Tauri v2)              │
│  React + TypeScript + Vite           │
└──────────────────┬───────────────────┘
                   │ REST (localhost:5000)
                   ▼
┌──────────────────────────────────────┐
│  Express API  (services/backend)     │
│  auth · clients · documents ·        │
│  extraction · whatsapp ·             │
│  deadlines · generate                │
└─────────┬──────────────────┬─────────┘
          ▼                  ▼
┌──────────────────┐  ┌──────────────────────┐
│ Supabase         │  │ Local Vault          │
│ metadata only    │  │ client files on disk │
└──────────────────┘  └──────────────────────┘
```

**Privacy by design:** physical client files (PDFs, images) never leave the local vault. Supabase stores metadata only. The backend runs in **demo mode** with in-memory data when no `.env` is configured.

---

## Tech Stack

- **Desktop shell:** Tauri v2 (Rust)
- **Frontend:** React 18, TypeScript, Vite
- **State:** React Context + `useReducer`
- **Backend:** Node.js, Express 5
- **Database:** Supabase (PostgreSQL), schema in `services/backend/db/schema.sql`
- **AI:** Google Gemini
- **Messaging:** WhatsApp Cloud API (Meta)

---

## Project Structure

```
Taxflow_AI/
├── apps/
│   └── desktop/              # Tauri + React desktop app
│       ├── src/              # pages, components, state, lib
│       └── src-tauri/        # Rust shell and Tauri config
├── services/
│   └── backend/              # Express API
│       ├── routes/           # auth, clients, documents, extraction, ...
│       ├── db/               # Supabase client and SQL schema
│       └── vault/            # Local file vault manager
├── docs/Claude Context/      # PRD, backend plan, UAE launch plan, tax filing guide
└── CLAUDE.md
```

---

## Getting Started

### Prerequisites

- **Node.js** 18 or newer
- **Rust** (stable) via [rustup](https://rustup.rs)
- **Windows:** Microsoft C++ Build Tools and WebView2 (see the [Tauri prerequisites](https://tauri.app/start/prerequisites/))

### 1. Start the backend

```bash
cd services/backend
npm install
cp .env.example .env     # on Windows: copy .env.example .env
node index.js
```

The API runs at `http://localhost:5000`. Check it at `http://localhost:5000/api/v1/health`.

Without a configured `.env`, the backend starts in demo mode.

### 2. Start the desktop app

```bash
cd apps/desktop
npm install
npm run tauri dev
```

To run the UI in a browser only (no Tauri window): `npm run dev`, then open `http://localhost:5173`.

### 3. Build an installer

```bash
cd apps/desktop
npm run tauri build
```

---

## Configuration

Edit `services/backend/.env`:

| Variable | Purpose |
|---|---|
| `PORT` | API port (default `5000`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | Cloud metadata database |
| `VAULT_PATH` | Local folder for client files. **Do not** place it in a cloud-synced folder. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | AI extraction and generation |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN` | WhatsApp Cloud API |

Never commit your `.env` file or API keys.

To set up the database, run `services/backend/db/schema.sql` in the Supabase SQL editor.

---

## API Overview

Base URL: `http://localhost:5000/api/v1`

| Route | Description |
|---|---|
| `GET /health` | System status (database, vault, AI, WhatsApp) |
| `/auth` | Firm registration, login, session |
| `/clients` | Client registry and vault summary |
| `/documents` | Upload to vault, serve, verify |
| `/extraction` | AI extraction, pending queue, usage log |
| `/whatsapp` | Webhook (Meta), messages, send |
| `/deadlines` | Compliance tasks, upcoming, summary |
| `/generate` | Notice responses, computation sheets |

---

## Roadmap

- [ ] Production-grade auth (bcrypt/argon2, JWT, route protection)
- [ ] Meta webhook signature verification and restricted CORS
- [ ] Bundle the backend as a Tauri sidecar for a single-installer experience
- [ ] Tauri CSP hardening and a proper app identifier
- [ ] Multi-country filing support (India, US, UAE, Singapore, UK)
- [ ] Automated tests and CI

---

## Documentation

Product and planning documents are in [`docs/Claude Context`](docs/Claude%20Context):

- Product Requirements Document
- Backend Architecture Plan
- UAE PRD, Business Model and Launch Plan
- Global tax filing guide (India, US, UAE, Singapore, UK)

---

## Contributing

Issues and pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

## License

Add a license (for example MIT) or state "All rights reserved" if the project is proprietary.

---

**Taxflow.AI**: less paperwork, more advisory.
