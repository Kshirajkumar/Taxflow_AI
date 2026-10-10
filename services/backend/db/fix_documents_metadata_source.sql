-- TaxFlow.AI migration: allow files uploaded from the Extraction and Vault UIs.
-- Run this once in the Supabase SQL Editor if the table already exists.

ALTER TABLE public.documents_metadata
  DROP CONSTRAINT IF EXISTS documents_metadata_source_check;

ALTER TABLE public.documents_metadata
  ADD CONSTRAINT documents_metadata_source_check
  CHECK (source IN ('WhatsApp', 'Manual', 'Portal', 'Upload'));

NOTIFY pgrst, 'reload schema';
