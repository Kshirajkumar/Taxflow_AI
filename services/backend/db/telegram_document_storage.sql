-- Legacy filename/attachment fields have been removed from the Telegram model.
-- Document metadata and Storage remain available for secure client-portal uploads.

ALTER TABLE public.documents_metadata
  DROP CONSTRAINT IF EXISTS documents_metadata_source_check;
ALTER TABLE public.documents_metadata
  ADD CONSTRAINT documents_metadata_source_check
  CHECK (source IN ('WhatsApp', 'Telegram', 'Manual', 'Portal', 'Upload'));

ALTER TABLE public.documents_metadata
  DROP CONSTRAINT IF EXISTS documents_metadata_file_type_check;
ALTER TABLE public.documents_metadata
  ADD CONSTRAINT documents_metadata_file_type_check
  CHECK (file_type IN ('PDF', 'PNG', 'JPG', 'JPEG', 'WEBP', 'XLS', 'XLSX', 'CSV', 'DOC', 'DOCX', 'OTHER'));

NOTIFY pgrst, 'reload schema';
