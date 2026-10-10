# BACKEND_GUIDE.md

This document defines the architectural standards, design rules, and implementation patterns for the TaxFlow.AI backend. All new routes, database changes, and storage logic must adhere to these rules to ensure system stability, security, and consistency.

## 1. High-Level Architecture

TaxFlow.AI employs a **Hybrid Metadata/Binary Storage Model**. This separates structured data from heavy physical files to optimize performance and privacy.

### The Data Flow
`Frontend Request` $\rightarrow$ `Express Route` $\rightarrow$ `(Supabase Metadata $\leftrightarrow$ Local Vault Binary)` $\rightarrow$ `Standardized JSON Response`

- **Supabase (Cloud)**: Acts as the "Brain." Stores only structured metadata, relationships, logs, and state.
- **Local Vault (Disk)**: Acts as the "Storage." Stores the actual physical files (PDFs, Images) in a structured directory tree.

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
