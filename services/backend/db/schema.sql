/**
 * TaxFlow.AI — Supabase Schema Migration SQL
 *
 * Run this entire script inside the Supabase SQL Editor at:
 * https://supabase.com -> Your Project -> SQL Editor -> New Query
 *
 * IMPORTANT:
 *  - This schema stores ONLY metadata — no binary files or documents
 *  - The vault_path column stores the LOCAL disk path pointer to the physical file
 *  - Physical files are stored in Local Vault Storage (configured in .env VAULT_PATH)
 */

-- Supabase Auth profile row. The trigger below runs after a real Auth user is
-- created, so every account gets an onboarding record before first login.
CREATE TABLE IF NOT EXISTS user_profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name           VARCHAR(255),
  firm_name           VARCHAR(255),
  practice_type       VARCHAR(100),
  membership_no       VARCHAR(100),
  role                VARCHAR(100) NOT NULL DEFAULT 'Managing Partner',
  vault_path          TEXT,
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read their own profile" ON user_profiles;
CREATE POLICY "Users can read their own profile" ON user_profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update their own profile" ON user_profiles;
CREATE POLICY "Users can update their own profile" ON user_profiles FOR UPDATE USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, firm_name, practice_type, membership_no)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'firm_name',
    COALESCE(NEW.raw_user_meta_data ->> 'practice_type', 'Chartered Accountant (CA)'),
    NEW.raw_user_meta_data ->> 'membership_no'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════
-- TABLE 1: clients — CA Firm's Client Master Registry
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  entity_type     VARCHAR(50) NOT NULL CHECK (entity_type IN ('Individual', 'Pvt Ltd', 'LLP', 'Partnership', 'Trust', 'HUF', 'OPC')),
  pan             VARCHAR(10) UNIQUE,
  gstin           VARCHAR(15),
  phone           VARCHAR(20) UNIQUE,
  email           VARCHAR(255),
  status          VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Suspended')),
  assigned_ca     VARCHAR(255),
  filing_status   VARCHAR(100),
  filing_types    JSONB NOT NULL DEFAULT '[]'::jsonb,
  vault_folder    TEXT,            -- Local disk path to this client's vault folder
  total_docs      INT DEFAULT 0,   -- Counter: how many docs uploaded for this client
  total_ai_calls  INT DEFAULT 0,   -- Counter: total AI extraction calls made for this client
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS filing_types JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own clients" ON clients;
CREATE POLICY "Users can manage their own clients" ON clients
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- TABLE 2: documents_metadata — Pointer Table for Local Vault Documents
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS documents_metadata (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID REFERENCES clients(id) ON DELETE CASCADE,
  client_name         VARCHAR(255),
  file_name           VARCHAR(255) NOT NULL,
  file_type           VARCHAR(20) NOT NULL CHECK (file_type IN ('PDF', 'PNG', 'JPG', 'JPEG', 'XLSX', 'CSV')),
  file_size_kb        NUMERIC(10,2),
  category            VARCHAR(50) NOT NULL CHECK (category IN ('GST', 'IncomeTax', 'Form16', 'BankStatement', 'Notice', 'TDS', 'Audit', 'General')),
  source              VARCHAR(20) DEFAULT 'Manual' CHECK (source IN ('WhatsApp', 'Manual', 'Portal')),
  status              VARCHAR(30) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Processing', 'Extracted', 'Verified', 'Rejected')),
  vault_path          TEXT NOT NULL,   -- LOCAL disk path only (e.g. C:\TaxFlowVault\clients\cli_1\GST\2026\invoice.pdf)
  assessment_year     VARCHAR(10) DEFAULT '2026-27',
  confidence_score    NUMERIC(5,2),
  extracted_data      JSONB,           -- Structured AI-extracted fields (no raw bytes)
  verified_by         VARCHAR(255),
  verified_at         TIMESTAMPTZ,
  whatsapp_message_id UUID,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- TABLE 3: ai_usage_log — Track Every AI API Call for Analytics
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  document_id     UUID REFERENCES documents_metadata(id) ON DELETE SET NULL,
  operation       VARCHAR(50) NOT NULL CHECK (operation IN ('extraction', 'notice_generation', 'chat', 'summary', 'classification')),
  model_used      VARCHAR(100) DEFAULT 'gemini-1.5-flash',
  input_tokens    INT DEFAULT 0,
  output_tokens   INT DEFAULT 0,
  cost_usd        NUMERIC(10,6) DEFAULT 0,
  duration_ms     INT,
  success         BOOLEAN DEFAULT TRUE,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- TABLE 4: whatsapp_messages — Full Message Log for Client Chats
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID REFERENCES clients(id) ON DELETE CASCADE,
  sender_phone        VARCHAR(20) NOT NULL,
  sender_name         VARCHAR(255),
  direction           VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type        VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document', 'audio', 'template')),
  body                TEXT,
  media_mime_type     VARCHAR(100),
  vault_file_ref      UUID REFERENCES documents_metadata(id) ON DELETE SET NULL,  -- Links to Local Vault doc if media
  wa_message_id       VARCHAR(255),    -- WhatsApp's own message ID
  status              VARCHAR(30) DEFAULT 'received' CHECK (status IN ('received', 'sent', 'delivered', 'read', 'failed', 'processed')),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- TABLE 5: compliance_tasks — Deadlines & Tax Filing Tracker
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS compliance_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  client_name     VARCHAR(255),
  form_type       VARCHAR(50) NOT NULL,  -- GSTR-1, GSTR-3B, ITR-3, TDS-26Q, etc.
  due_date        DATE NOT NULL,
  status          VARCHAR(30) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Docs Received', 'In Progress', 'Filed', 'Late Filed', 'Not Applicable')),
  progress        INT DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  assigned_to     VARCHAR(255),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════
-- TABLE 6: extracted_fields — Structured AI Results
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS extracted_fields (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID REFERENCES documents_metadata(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES clients(id) ON DELETE CASCADE,
  field_name        VARCHAR(100) NOT NULL,  -- e.g. 'invoice_number', 'gstin', 'total_amount'
  field_value       TEXT,
  confidence        NUMERIC(5,2),
  is_verified       BOOLEAN DEFAULT FALSE,
  correction        TEXT,                   -- CA's manual correction if field was wrong
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════
-- INDEXES for fast querying
-- ═══════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_documents_client_id ON documents_metadata(client_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents_metadata(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_client_id ON whatsapp_messages(client_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sender ON whatsapp_messages(sender_phone);
CREATE INDEX IF NOT EXISTS idx_compliance_client_id ON compliance_tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_compliance_due_date ON compliance_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_ai_usage_client_id ON ai_usage_log(client_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_log(created_at);

-- ═══════════════════════════════════════════════════
-- AUTO-UPDATE updated_at trigger
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_compliance_updated_at
  BEFORE UPDATE ON compliance_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════
-- SEED DEMO DATA (remove in production)
-- ═══════════════════════════════════════════════════
INSERT INTO clients (id, name, entity_type, pan, gstin, phone, email, status, assigned_ca, filing_status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Reliable Motors Pvt Ltd', 'Pvt Ltd', 'AACCR1234F', '27AACCR1234F1Z5', '+919820011223', 'accounts@reliablemotors.com', 'Active', 'CA Rajesh Kumar', 'Pending (GSTR-3B)'),
  ('22222222-2222-2222-2222-222222222222', 'Dr. Ananya Roy', 'Individual', 'APCPR5678K', NULL, '+919930044556', 'ananya.roy@medclinic.in', 'Active', 'CA Priya Sharma', 'Docs Collected'),
  ('33333333-3333-3333-3333-333333333333', 'Apex Logistics LLP', 'LLP', 'ABBFA9876M', '27ABBFA9876M1Z2', '+919819988776', 'finance@apexlogistics.in', 'Active', 'CA Rajesh Kumar', 'Filed (Q2)')
ON CONFLICT DO NOTHING;

INSERT INTO compliance_tasks (client_id, client_name, form_type, due_date, status, progress, assigned_to)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Reliable Motors Pvt Ltd', 'GSTR-3B', '2026-10-20', 'Pending', 75, 'CA Rajesh Kumar'),
  ('22222222-2222-2222-2222-222222222222', 'Dr. Ananya Roy', 'ITR-3', '2026-10-31', 'Docs Received', 90, 'CA Priya Sharma'),
  ('33333333-3333-3333-3333-333333333333', 'Apex Logistics LLP', 'GSTR-1', '2026-10-11', 'Filed', 100, 'CA Rajesh Kumar')
ON CONFLICT DO NOTHING;
