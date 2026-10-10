# Repository Guidelines

## Project Structure

TaxFlow.AI is a small full-stack monorepo:

- `apps/desktop/` contains the React + TypeScript + Vite UI and Tauri wrapper. Put screens in `src/pages/`, reusable UI in `src/components/`, shared state in `src/state/`, and domain helpers in `src/lib/`.
- `services/backend/` contains the Node.js + Express API. Add domain routes under `routes/`, Supabase integration under `db/`, and physical document handling through `vault/vaultManager.js`.
- `docs/` contains product and architecture references; `DESIGN_GUIDE.md` documents the visual system.

## Skills and Guide Usage

Always choose and use the best available skill for the task and the project’s stack. For frontend work, apply the most suitable React, TypeScript, Vite, and Tauri practices; for backend work, apply the most suitable Node.js, Express, Supabase, vault, and API-design practices. Do not introduce a new framework or pattern when an existing project convention already covers the need.

Before making changes, follow the relevant repository guides:

- Frontend changes: read and follow `DESIGN_GUIDE.md`, and consult `CLAUDE.md` for the frontend architecture and conventions.
- Backend changes: read and follow `BACKEND_GUIDE.md`, and consult `CLAUDE.md` for the backend architecture and conventions.
- Cross-cutting changes: follow both guides and keep frontend/backend responsibilities separated.

Keep implementation, validation, security, and documentation decisions consistent with these guides. If a guide conflicts with the live codebase, inspect the current implementation, preserve established working conventions, and update the guide only when the user explicitly requests documentation changes.

## Build, Test, and Development Commands

Run commands from the relevant package directory:

```bash
cd apps/desktop && npm install
cd apps/desktop && npm run dev       # Start the Vite development server
cd apps/desktop && npm run build     # Type-check and create a production build
cd apps/desktop && npm run preview   # Serve the production build locally
cd services/backend && npm install
cd services/backend && npm run dev   # Start the Express server on PORT or 5000
```

There is no automated test suite or linter configured yet. The backend `npm test` script is currently a placeholder; at minimum, run the desktop production build and manually exercise changed API paths.

## Coding Style and Naming

Use two-space indentation, semicolons, and the existing TypeScript/JavaScript conventions. Use `PascalCase` for React components, `camelCase` for functions and variables, and descriptive plural names for API resources (for example, `/api/v1/clients`). Keep route modules focused by domain and preserve the standard `{ success, source, data }` response shape. Run formatting through the project’s existing style; no formatter or lint command is currently defined.

## Testing Guidelines

Until tests are introduced, validate UI changes with `npm run build` and a local `npm run dev` session. For backend changes, verify success, validation, and failure responses, including demo-mode behavior when Supabase is unavailable.

## Security and Configuration

Keep secrets in `services/backend/.env` and never commit them. Use `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and relevant Gemini/WhatsApp variables only on the server. Sanitize vault inputs and use `vaultManager.js`; do not hardcode filesystem paths or call external AI services directly from the frontend.

## Commits and Pull Requests

Use concise Conventional Commit-style subjects, such as `feat: add client export` or `chore: update dependencies`. PRs should explain the change, list verification commands, link the related issue when applicable, and include screenshots or a short recording for UI changes. Call out schema, environment-variable, or migration requirements explicitly.
