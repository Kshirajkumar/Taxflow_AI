# BACKEND_GUIDE.md

This document defines the architectural standards, design rules, and implementation patterns for the TaxFlow.AI backend. All new routes, database changes, and storage logic must adhere to these rules to ensure system stability, security, and consistency.

## 1. High-Level Architecture

TaxFlow.AI employs a **Hybrid Metadata/Binary Storage Model**. This separates structured data from heavy physical files to optimize performance and privacy.

### The Data Flow
`Frontend Request` $\rightarrow$ `Express Route` $\rightarrow$ `(Supabase Metadata + private Telegram/client-portal object storage; local vault for other workflows)` $\rightarrow$ `Standardized JSON Response`

- **Supabase Database**: Stores structured metadata, relationships, logs, and state.
- **Supabase Storage**: Private durable source for production Telegram attachments and client-portal uploads; only the server service-role client can access this bucket.
- **Local Vault (Disk)**: Desktop copies of Telegram attachments are verified and stored in the user-selected directory; other existing upload workflows still use the backend's local vault.

---

## 2. API Design Standards

### 2.1 Endpoint Structure
All endpoints must be versioned and modularized by domain.
- **Base Path**: `/api/v1/`
- **Naming**: Use plural nouns for resources (e.g., `/api/v1/clients`, `/api/v1/documents`).
- **Methods**: 
    - `GET`: Retrieve data.
    - `POST`: Create new records or trigger complex actions (e.g., AI processing).
    - `PATCH/PUT`: Update existing records.
    - `DELETE`: Remove records (usually marked as `deleted: true` rather than hard deletion).

### 2.2 Standard Response Format
To ensure the frontend can handle responses predictably, all routes **must** return a JSON object with this structure:

**Success Response:**
```json
{
  "success": true,
  "source": "supabase" | "demo",
  "data": { ... },
  "count": 123
}
```

**Failure Response:**
```json
{
  "success": false,
  "message": "Clear, human-readable error description"
}
```

### 2.3 Error Handling
- **Global Handler**: Use the global error middleware in `index.js` for unexpected crashes.
- **Status Codes**:
    - `200 OK`: Standard success.
    - `201 Created`: Successful POST.
    - `400 Bad Request`: Validation errors.
    - `401 Unauthorized`: Auth failures.
    - `404 Not Found`: Missing resource.
    - `500 Internal Server Error`: Unhandled exceptions.

---

## 3. Data Management Rules

### 3.1 Supabase (Metadata)
- **Service Role**: Use the `service_role` key for administrative backend operations.
- **Demo Mode**: Every route must check `isConnected` from `db/supabase.js`. If false, provide a fallback to in-memory demo data to ensure the app remains runnable locally.
- **Client List Cache**: The authenticated client-list route may cache results in memory per user. Invalidate that cache after successful client creation, update, or deletion. The desktop may show its last-known per-user client list while refreshing in the background; a backend restart clears the server cache. Changes made outside the app are reflected after that cache is cleared or the backend restarts.

### 3.2 Local Vault (Physical Files)
**Never hardcode filesystem paths.** Always use the helpers provided in `vault/vaultManager.js`.

#### Directory Hierarchy
Files must be organized strictly by this pattern:
`vault/clients/{client_id}/{category}/{assessment_year}/{filename}`

#### Storage Rules:
1. **Sanitization**: All `client_id` and `filename` inputs must be passed through `sanitizeName()` before any OS operation.
2. **Binary Handling**: Convert base64 uploads to buffers immediately.
3. **Collision Prevention**: Prefix files with a timestamp or unique ID during `saveFileToVault()`.
4. **Categories**: Only use `ALLOWED_CATEGORIES` (e.g., `GST`, `IncomeTax`, `Form16`, `Notice`).
5. **Telegram Attachments**: TaxFlow no longer sends Telegram files. New inbound Telegram file messages receive instructions to use the client portal; older already-stored Telegram files remain available through the existing staff review and desktop sync paths.
6. **Client Portal Uploads**: Clients enroll only through a CA-issued, single-use invitation link, create a password for the exact email on their active client record, and use password sign-in for later visits. The invitation table stores only a token hash; invite URLs are redacted from the app's Telegram message history, and the token is removed from the browser URL fragment before any API call. Any messaging provider used to share an invitation link may retain it, so treat it as a bearer credential and share it only with the intended client. The portal API requires a portal-specific Auth identity and a claimed active access record, and rechecks the current client email and active status on every request. Uploads are size-limited, type/signature checked, rate-limited, and accepted only when `SUPABASE_STORAGE_BUCKET` exists and Supabase reports it as private. The backend records metadata and SHA-256 in `documents_metadata`; staff can review/download the files, and the existing desktop sync writes them to the configured local vault and verifies the checksum. Portal files are never transferred through Telegram.

Before enabling Telegram on an existing database, ensure `clients`, `user_profiles`, and `documents_metadata` exist, then run `npm run migrate:telegram` from `services/backend` with `DATABASE_URL` set. Copy the entire PostgreSQL URI from that Supabase project's Dashboard → Connect; use the exact username shown for the selected connection method and replace only `[YOUR-PASSWORD]` with the current database password, URL-encoding reserved characters. The direct connection is recommended for migrations where IPv6 is available; if using the session pooler, its username includes the project reference. A PostgreSQL password authentication error means the migration did not run. It applies the Telegram schema, private Storage bucket/device-sync migration, client portal and invitation tables, and distributed rate-limit function; it also clears previously persisted machine-specific vault paths. Alternatively, run `db/telegram.sql`, `db/telegram_document_storage.sql`, `db/create_taxflow_storage_bucket.sql`, `db/client_portal.sql`, `db/client_portal_invites.sql`, and `db/create_api_rate_limits.sql` in that order in the SQL Editor of the same Supabase project. Set `SUPABASE_STORAGE_BUCKET=taxflow-intake`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_WEBHOOK_SECRET`, and a public HTTPS URL before starting the production backend. Never grant `anon` or `authenticated` access to the private intake bucket or expose the service-role key.

If inbound attachments show a Row Level Security error, run `db/fix_telegram_attachment_rls.sql` in the Supabase project configured by this backend, verify that `SUPABASE_SERVICE_ROLE_KEY` is that same project's service-role key (not its anon/publishable key), then restart or redeploy the backend. The repair grants only `service_role` access to the private Telegram bucket and document metadata; never work around the error by granting access to `anon` or `authenticated`.

If an existing Telegram document path begins with `undefined/`, do not edit `storage.objects` or change the metadata path manually. Set the backend's project credentials and bucket in `services/backend/.env`, then run `npm run repair:telegram-storage-reference -- <document-uuid>` from `services/backend`. The one-document repair verifies the linked client owner and SHA-256, copies the private object to its canonical owner-scoped key, verifies the copy, and only then updates that document's metadata. The old object is retained as a recovery copy.

Before enabling client-portal uploads, apply the existing database schema, `services/backend/db/telegram.sql`, `services/backend/db/telegram_document_storage.sql`, `services/backend/db/create_taxflow_storage_bucket.sql`, `services/backend/db/client_portal.sql`, `services/backend/db/client_portal_invites.sql`, and `services/backend/db/create_api_rate_limits.sql`. Running `npm run migrate:telegram` applies these Telegram and portal migrations in order. Configure `CLIENT_PORTAL_URL` to the HTTPS website origin and set the website's public Supabase URL/key plus `API_URL`. Portal enrollment creates confirmed Supabase Auth users on the server only after a valid invitation is checked; it does not use Supabase email sign-in or invitation links. The portal shares the private `SUPABASE_STORAGE_BUCKET` with server-managed Telegram storage; the backend checks bucket privacy before accepting each upload. Do not grant `anon` or `authenticated` access to the bucket or expose the service-role key. Apply all portal migrations before deploying backend code that enforces staff/client identity separation.

For portal enrollment, a CA creates and shares a private invitation link for an active client with a valid email address. When a Telegram account-link welcome is generated, it includes the portal invitation derived from that specific Telegram link. The client creates an account with the exact email on the client record and a password; later sign-ins use that password. A valid invitation is consumed transactionally when the authenticated client claims it. Do not allow email-only auto-binding. Apply `services/backend/db/message_templates.sql` after the base schema to enable per-practice inbox templates. Core templates can be edited but not deleted, and all template messages receive the portal page link; do not use Telegram to transmit sensitive files.

### Account Deletion
The authenticated Settings flow requires the current password and the exact confirmation phrase `DELETE MY ACCOUNT`. The backend removes private objects from `SUPABASE_STORAGE_BUCKET` and metadata-linked buckets, deletes account-owned Supabase Vault secrets, then deletes the Supabase Auth user; database foreign keys cascade account-owned rows. Configure `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`), `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` only on the backend. Never put these keys in the desktop application.

Before enabling account deletion on an existing Supabase project, apply `services/backend/db/create_vault_secret_deleter.sql` after enabling Supabase Vault and applying `services/backend/db/create_integration_secrets.sql`. Make sure the other schema migrations are current, too. In particular, run `services/backend/db/delete_client_cascade.sql` if the database predates the client deletion migration; direct user-owned tables must use `ON DELETE CASCADE` as defined by `services/backend/db/schema.sql`, `services/backend/db/create_notifications.sql`, `services/backend/db/create_integration_secrets.sql`, and the Telegram sync migrations. Do not delete an Auth user until the backend is deployed with Storage and Vault cleanup enabled. Local vault files are intentionally preserved; deletion cannot remove copies saved on other devices or revoke credentials at their external providers. If cleanup succeeds but Auth deletion fails, the account remains sign-in capable while some cloud files or Vault secrets may already be gone; correct the foreign-key/configuration issue and retry.

#### Sync Logic:
- **Creation**: When a client is created in Supabase $\rightarrow$ Create their root vault directory.
- **Upload**: Save file to Vault $\rightarrow$ Save the resulting `vault_path` to Supabase `documents_metadata`.
- **Serving**: Query `vault_path` from Supabase $\rightarrow$ Stream file using `res.sendFile()`.

---

## 4. Integration Patterns

### 4.1 AI (Google Gemini)
- **Proxy Pattern**: The backend acts as the sole gateway to Gemini. The frontend never calls the AI API directly.
- **Logging**: Every AI request must be logged in the `ai_usage_log` table in Supabase for auditing and cost tracking.

### 4.2 WhatsApp Business API
- **Webhook Handling**: Incoming messages must be processed asynchronously and stored in `whatsapp_msgs`.
- **Outgoing**: Use a standardized template system to ensure consistent client communication.

---

## 5. Implementation Checklist for New Features

Follow these steps when adding a new backend feature:

- [ ] **Database**: Create the necessary table/column in Supabase.
- [ ] **Vault**: Determine if new `ALLOWED_CATEGORIES` are needed in `vaultManager.js`.
- [ ] **Route**: Create a new route file in `routes/` and mount it in `index.js`.
- [ ] **Logic**:
    - [ ] Implement `isConnected` check for Demo Mode.
    - [ ] Use `vaultManager` for any file operations.
    - [ ] Wrap logic in `try-catch` blocks.
- [ ] **Response**: Ensure the return object matches the `{ success, source, data }` format.
- [ ] **Frontend**: Update the React store/services to call the new endpoint.
