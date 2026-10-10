-- Adds the selected supported country to every client.
-- Run after supported_countries has been created and seeded.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS country_id UUID REFERENCES supported_countries(id) ON DELETE RESTRICT;

UPDATE clients
SET country_id = (
  SELECT id FROM supported_countries WHERE country_code = 'IN'
)
WHERE country_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_clients_country_id ON clients(country_id);

ALTER TABLE clients
  ALTER COLUMN country_id SET NOT NULL;

-- Existing clients are treated as India because the old UI was India-only.
-- New clients must select a supported country in the application.
