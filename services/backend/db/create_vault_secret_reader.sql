-- Allows only the backend service_role to read one decrypted Vault secret.
-- Do not grant this function to anon or authenticated users.

CREATE OR REPLACE FUNCTION public.get_vault_secret(p_secret_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE id = p_secret_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_vault_secret(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vault_secret(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
