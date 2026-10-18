-- Delete Supabase Vault secrets owned only by the account being removed.
-- Run after enabling Supabase Vault and applying create_integration_secrets.sql.

CREATE OR REPLACE FUNCTION public.delete_account_vault_secrets(
  p_owner_user_id UUID,
  p_secret_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_secret_id UUID;
  v_deleted_count INTEGER := 0;
BEGIN
  IF p_owner_user_id IS NULL OR p_secret_ids IS NULL THEN
    RAISE EXCEPTION 'Account owner and secret IDs are required';
  END IF;

  FOREACH v_secret_id IN ARRAY p_secret_ids LOOP
    IF v_secret_id IS NULL THEN
      RAISE EXCEPTION 'Secret IDs cannot contain null values';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM vault.secrets s
      WHERE s.id = v_secret_id
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.integration_secrets i
      WHERE i.vault_secret_id = v_secret_id
        AND i.owner_user_id IS DISTINCT FROM p_owner_user_id
    ) THEN
      DELETE FROM vault.secrets
      WHERE id = v_secret_id;
      IF FOUND THEN
        v_deleted_count := v_deleted_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_account_vault_secrets(UUID, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account_vault_secrets(UUID, UUID[])
  TO service_role;

NOTIFY pgrst, 'reload schema';
