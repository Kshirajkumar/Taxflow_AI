# BACKEND_GUIDE.md

This document defines the architectural standards, design rules, and implementation patterns for the TaxFlow.AI backend. All new routes, database changes, and storage logic must adhere to these rules to ensure system stability, security, and consistency.

## 1. High-Level Architecture

TaxFlow.AI employs a **Hybrid Metadata/Binary Storage Model**. This separates structured data from heavy physical files to optimize performance and privacy.

### The Data Flow
`Frontend Request` $\rightarrow$ `Express Route` $\rightarrow$ `(Supabase Metadata + private Telegram object storage; local vault for other workflows)` $\rightarrow$ `Standardized JSON Response`

- **Supabase Database**: Stores structured metadata, relationships, logs, and state.
- **Supabase Storage**: Private durable source for production Telegram attachments; only the server service-role client can access this bucket.
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
5. **Telegram Attachments**: The webhook stores each inbound message before acknowledging it, then queues supported attachments immediately. In production, bytes are uploaded to the private `SUPABASE_STORAGE_BUCKET`; a checksum and object key are recorded with the document metadata. A database-backed worker resumes pending downloads after backend restarts and retries transient failures. Authenticated desktops poll for pending documents, verify SHA-256, atomically save each copy under `client/year/month/Raw`, and record a per-device sync receipt. Keep the Supabase object as the recovery source; do not delete it after local sync. In development, if the Storage bucket is not configured, the existing backend-local vault path is used.

Before enabling Telegram on an existing database, ensure `clients`, `user_profiles`, and `documents_metadata` exist, then run `npm run migrate:telegram` from `services/backend` with `DATABASE_URL` set. It applies the Telegram schema, private Storage bucket/device-sync migration, and clears previously persisted machine-specific vault paths. Alternatively, run `db/telegram.sql`, `db/telegram_document_storage.sql`, then `db/create_taxflow_storage_bucket.sql` in Supabase SQL Editor. Set `SUPABASE_STORAGE_BUCKET=taxflow-intake`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_WEBHOOK_SECRET`, and a public HTTPS URL before starting the production backend. Never grant `anon` or `authenticated` access to the private intake bucket or expose the service-role key.

If inbound attachments show a Row Level Security error, run `db/fix_telegram_attachment_rls.sql` in the Supabase project configured by this backend, verify that `SUPABASE_SERVICE_ROLE_KEY` is that same project's service-role key (not its anon/publishable key), then restart or redeploy the backend. The repair grants only `service_role` access to the private Telegram bucket and document metadata; never work around the error by granting access to `anon` or `authenticated`.

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
