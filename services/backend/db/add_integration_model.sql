-- Store the AI model alongside the integration secret metadata.
-- The API key remains inside Supabase Vault; this column stores only the model ID.

ALTER TABLE public.integration_secrets
  ADD COLUMN IF NOT EXISTS model_name VARCHAR(120);

-- Current Gemini Flash model supports text and multimodal input, including images.
UPDATE public.integration_secrets
SET model_name = 'gemini-3.8-flash',
    updated_at = NOW()
WHERE provider = 'gemini'
  AND secret_name = 'chat_ai_api_key'
  AND (model_name IS NULL OR model_name = '');

NOTIFY pgrst, 'reload schema';
