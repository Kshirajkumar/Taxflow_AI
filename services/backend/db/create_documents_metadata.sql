-- TaxFlow.AI: document metadata table
-- Run this once in Supabase SQL Editor after the clients table exists.
-- Physical PDFs/images remain in the Local Vault; this table stores metadata only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.documents_metadata (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name         VARCHAR(255),
  file_name           VARCHAR(255) NOT NULL,
  file_type           VARCHAR(20) NOT NULL CHECK (file_type IN ('PDF', 'PNG', 'JPG', 'JPEG', 'XLSX', 'CSV')),
  file_size_kb        NUMERIC(10,2),
  category            VARCHAR(50) NOT NULL CHECK (category IN ('GST', 'IncomeTax', 'Form16', 'BankStatement', 'Notice', 'TDS', 'Audit', 'General', 'Extracted')),
  source              VARCHAR(20) NOT NULL DEFAULT 'Manual' CHECK (source IN ('WhatsApp', 'Manual', 'Portal')),
  status              VARCHAR(30) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Processing', 'Extracted', 'Verified', 'Rejected')),
  vault_path          TEXT NOT NULL,
  assessment_year     VARCHAR(10) DEFAULT '2026-27',
  confidence_score    NUMERIC(5,2),
  extracted_data      JSONB,
  verified_by         VARCHAR(255),
  verified_at         TIMESTAMPTZ,
  whatsapp_message_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_metadata_client_id ON public.documents_metadata(client_id);
CREATE INDEX IF NOT EXISTS idx_documents_metadata_status ON public.documents_metadata(status);
CREATE INDEX IF NOT EXISTS idx_documents_metadata_created_at ON public.documents_metadata(created_at DESC);

-- Protect client documents from cross-account access. The backend uses the
-- Supabase service role and therefore bypasses these policies; they protect
-- direct anon/authenticated access from the client side.
ALTER TABLE public.documents_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own document metadata" ON public.documents_metadata;
CREATE POLICY "Users can read their own document metadata"
  ON public.documents_metadata FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = documents_metadata.client_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create their own document metadata" ON public.documents_metadata;
CREATE POLICY "Users can create their own document metadata"
  ON public.documents_metadata FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = documents_metadata.client_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own document metadata" ON public.documents_metadata;
CREATE POLICY "Users can update their own document metadata"
  ON public.documents_metadata FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = documents_metadata.client_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = documents_metadata.client_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete their own document metadata" ON public.documents_metadata;
CREATE POLICY "Users can delete their own document metadata"
  ON public.documents_metadata FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = documents_metadata.client_id
        AND c.user_id = auth.uid()
    )
  );

-- Refresh PostgREST's schema cache immediately after creating the table.
NOTIFY pgrst, 'reload schema';
