-- Grant the backend service role the minimum access required for AI integration metadata.
-- Browser roles remain blocked; the Gemini key itself stays in Supabase Vault.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, UPDATE ON TABLE public.integration_secrets TO service_role;

-- Keep the Vault reader restricted to the backend service role as well.
GRANT EXECUTE ON FUNCTION public.get_vault_secret(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';