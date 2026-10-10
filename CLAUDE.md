# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Frontend (React + TypeScript)
All commands should be run from `apps/desktop`.
- **Install dependencies**: `npm install`
- **Start development server**: `npm run dev`
- **Build for production**: `npm run build`
- **Preview production build**: `npm run preview`

### Backend (Node.js + Express)
All commands should be run from `services/backend`.
- **Install dependencies**: `npm install`
- **Start server**: `node index.js` (or `npm start` if configured)

## Architecture & Structure

TaxFlow.AI is a full-stack practice suite for tax professionals, consisting of a React frontend and a Node.js backend.

### High-Level Architecture
- **Frontend**: A React application that provides a unified dashboard for client management, document extraction, and compliance tracking.
  - **State Management**: Centralized in `apps/desktop/src/state/store.tsx` using React Context + `useReducer`.
  - **Design System**: Defined in `apps/desktop/src/styles.css`.
  - **Business Logic**: Domain-specific logic (tax calculations, auditing) in `apps/desktop/src/lib/domain.ts`.
- **Backend**: An Express API server (`services/backend/index.js`) that orchestrates data and AI services.
  - **Database**: Uses **Supabase (Postgres)** for metadata (clients, documents, logs, compliance tasks).
  - **File Storage**: A **Local Vault System** (`services/backend/vault/`) for physical document storage, organized by client ID and category.
  - **AI Integration**: Integrates **Google Gemini** for OCR/extraction and report generation.
  - **Communications**: Integrates **WhatsApp Business API** for client reminders and messaging.

### Project Layout

#### Frontend (`apps/desktop/src/`)
- `App.tsx`: Main layout shell (Titlebar, Sidebar, Page Router, Chat).
- `pages/`: Feature views (Dashboard, Extract, WhatsApp, Files, Deadlines, Generate, Other).
- `components/`: Shared UI elements (Icon, Sidebar, Titlebar, Chat).
- `lib/`: Utilities (`format.ts`) and domain logic (`domain.ts`).
- `state/`: Global store and action definitions.
- `data/`: Seed data for demo mode.

#### Backend (`services/backend/`)
- `index.js`: Entry point; mounts all API routes and initializes the vault.
- `routes/`: Modular route handlers for `auth`, `clients`, `documents`, `extraction`, `whatsapp`, `deadlines`, and `generate`.
- `db/`: Supabase client configuration and connection logic.
- `vault/`: Logic for managing physical file storage on the local filesystem.
