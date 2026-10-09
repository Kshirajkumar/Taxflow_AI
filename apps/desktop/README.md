# Taxflow.AI — CA Practice Suite (React / TypeScript)

A React + TypeScript rebuild of the original single-file HTML demo, split into
proper components with a shared state store, using the exact same CSS design
system so it looks identical.

## What you need installed

- **Node.js 18 or newer** (Node 22 was used to build and test this). Get it from
  https://nodejs.org — installing Node also installs `npm`.
- Nothing else system-wide. No database, no backend, no Docker.

Everything else (React, Vite, TypeScript) is a **project dependency**, listed in
`package.json` and installed into `node_modules/` by the one command below —
you don't install these globally.

## Setup

```bash
# 1. Unzip this folder, then open a terminal inside it
cd taxflow-tsx

# 2. Install dependencies (creates node_modules/, only needed once,
#    or again whenever package.json changes)
npm install

# 3. Start the dev server
npm run dev
```

Open the URL it prints (usually **http://localhost:5173**) in your browser.
That's it — this is exactly what makes it "look like the HTML one," because it
reuses the same CSS file (`src/styles.css`) and the same Google Fonts
(Plus Jakarta Sans, JetBrains Mono, Caveat) that the original demo used, loaded
in `index.html`.

## Other commands

```bash
npm run build      # type-checks and builds an optimized production bundle into dist/
npm run preview    # serves that production build locally, to sanity-check it
```

## Project structure

```
taxflow-tsx/
├── index.html            # HTML shell + Google Fonts links
├── package.json           # dependencies & scripts
├── vite.config.ts         # build tool config
├── tsconfig.json          # TypeScript config
└── src/
    ├── main.tsx           # React entry point
    ├── App.tsx             # layout shell: titlebar, sidebar, page router, chat panel
    ├── styles.css          # the full design system (colors, cards, layout) — same as the HTML demo
    ├── types.ts            # shared TypeScript types (Client, InvoiceDoc, Reminder, ...)
    ├── state/
    │   └── store.tsx       # global state: React Context + useReducer, all app actions
    ├── data/
    │   └── seed.ts         # sample clients, invoices, reminders, tasks — the demo data
    ├── lib/
    │   ├── format.ts       # date/money formatting helpers
    │   └── domain.ts       # business logic: tax calc, task progress, missing docs
    ├── components/
    │   ├── Icon.tsx        # inline-SVG icon set (no icon library dependency)
    │   ├── Sidebar.tsx      # left navigation
    │   ├── Titlebar.tsx     # top bar: search, theme toggle, window controls
    │   └── Chat.tsx         # the AI assistant panel
    └── pages/
        ├── Dashboard.tsx
        ├── Extract.tsx      # invoice extraction & review queue
        ├── WhatsApp.tsx     # chats, scheduled reminders, templates
        ├── Files.tsx        # client folder tree (vault)
        ├── Deadlines.tsx    # filing progress per client
        ├── Generate.tsx     # file generator
        └── Other.tsx        # Clients, Billing, Settings pages
```

## Notes on this conversion

- This is a **frontend-only demo** with sample, in-memory data (defined in
  `src/data/seed.ts`) — exactly like the original HTML file. There is no
  backend and nothing persists after a page refresh.
- The AI assistant in `src/components/Chat.tsx` uses simple keyword matching
  to route to the right page, the same approach as the original — it is a
  scripted demo, not a live model.
- State management uses plain **React Context + useReducer** (no Redux or
  other state library needed) — every action the UI can take lives in
  `src/state/store.tsx` as a typed action.
- Verified with `tsc -b` (zero type errors) and `vite build` (successful
  production build) before delivery.
