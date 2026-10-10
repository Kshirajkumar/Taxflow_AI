-- TaxFlow.AI migration: normalize and allow all file types supported by the
-- Invoice Extraction upload control.

ALTER TABLE public.documents_metadata
  ALTER COLUMN file_type TYPE VARCHAR(30);

ALTER TABLE public.documents_metadata
  DROP CONSTRAINT IF EXISTS documents_metadata_file_type_check;

ALTER TABLE public.documents_metadata
  ADD CONSTRAINT documents_metadata_file_type_check
  CHECK (file_type IN ('PDF', 'PNG', 'JPG', 'JPEG', 'WEBP', 'XLS', 'XLSX', 'CSV', 'DOC', 'DOCX'));

NOTIFY pgrst, 'reload schema';
