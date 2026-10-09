# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

The project is a React + TypeScript application located in `apps/desktop`. All commands should be run from that directory.

### Common Tasks
- **Install dependencies**: `npm install` (from `apps/desktop`)
- **Start development server**: `npm run dev` (from `apps/desktop`)
- **Build for production**: `npm run build` (from `apps/desktop`)
- **Preview production build**: `npm run preview` (from `apps/desktop`)

## Architecture & Structure

Taxflow.AI is a frontend-only demo that rebuilds a single-file HTML prototype into a structured React application. It uses a shared state store and a centralized design system.

### High-Level Architecture
- **State Management**: Uses plain **React Context + `useReducer`** implemented in `apps/desktop/src/state/store.tsx`. All application actions and state transitions are centralized here.
- **Design System**: A single, comprehensive CSS file (`apps/desktop/src/styles.css`) defines the entire visual identity, layout, and component styles.
- **Data Layer**: In-memory sample data is provided in `apps/desktop/src/data/seed.ts`. There is no backend; data does not persist across refreshes.
- **Business Logic**: Domain-specific logic (tax calculations, task progress, document auditing) is isolated in `apps/desktop/src/lib/domain.ts`.

### Project Layout (`apps/desktop/src/`)
- `App.tsx`: The main layout shell containing the Titlebar, Sidebar, Page Router, and Chat panel.
- `pages/`: Contains the primary feature views (Dashboard, Extract, WhatsApp, Files, Deadlines, Generate, Other).
- `components/`: Shared UI elements like `Icon.tsx` (inline SVGs), `Sidebar.tsx`, `Titlebar.tsx`, and `Chat.tsx` (scripted AI assistant).
- `lib/`: Utility functions for formatting (`format.ts`) and business logic (`domain.ts`).
- `types.ts`: Global TypeScript definitions for domain entities (Clients, Invoices, Reminders, etc.).
