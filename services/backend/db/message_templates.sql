-- TaxFlow.AI: Message templates for client communication
-- Run after schema.sql. Templates are per-user; protected defaults can be edited but not deleted.

CREATE TABLE IF NOT EXISTS public.message_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  cat         VARCHAR(50) NOT NULL DEFAULT 'Utility',
  body        TEXT NOT NULL,
  protected   BOOLEAN NOT NULL DEFAULT FALSE,
  template_key TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS template_key TEXT;

UPDATE public.message_templates
SET template_key = CASE name
  WHEN 'GST documents request' THEN 'docs'
  WHEN 'Missing document' THEN 'pending'
  WHEN 'ITR documents' THEN 'itr'
  ELSE template_key
END
WHERE protected = TRUE AND template_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_user_template_key_idx
  ON public.message_templates(user_id, template_key)
  WHERE template_key IS NOT NULL;

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_templates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.message_templates TO service_role;

DROP POLICY IF EXISTS message_templates_service_role ON public.message_templates;
CREATE POLICY message_templates_service_role
  ON public.message_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed default protected templates for existing users (idempotent)
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
SELECT
  au.id,
  t.template_key,
  t.name,
  t.cat,
  t.body,
  true
FROM auth.users au
CROSS JOIN (
  VALUES
    ('website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}'),
    ('portal_link', 'Client portal website link', 'Client portal', 'Hello {name}, you can sign in to your TaxFlow client portal and upload your requested documents here: {portalLink}'),
    ('docs', 'GST documents request', 'Utility', 'Hello {name}, please upload your {period} sales & purchase invoices through your secure client portal: {portalLink}. Deadline: {due}.'),
    ('pending', 'Missing document', 'Utility', 'Hi {name}, we have not received the {doc} for {period} yet. Please upload it through your secure client portal: {portalLink}.'),
    ('itr', 'ITR documents', 'Utility', 'Hi {name}, to file your ITR please upload Form 16 / 26AS, bank interest certificates, and investment proofs through your secure client portal: {portalLink}.'),
    ('portal_invite', 'Secure portal invitation', 'Client portal', 'Hi {name}, open this private link from your CA to access your documents and upload files using our secure file-transfer service: {portalLink}

Use the same email address your CA has on file. Please do not send tax, financial, identity, or other sensitive documents in Telegram.')
) AS t(template_key, name, cat, body)
WHERE NOT EXISTS (
  SELECT 1 FROM public.message_templates mt
  WHERE mt.user_id = au.id AND mt.template_key = t.template_key
);

NOTIFY pgrst, 'reload schema';
