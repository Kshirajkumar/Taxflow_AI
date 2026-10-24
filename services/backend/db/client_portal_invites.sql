-- One-time client portal invitations. The bearer token is stored only as a hash.
-- Run after schema.sql, telegram.sql, and client_portal.sql.

CREATE TABLE IF NOT EXISTS public.client_portal_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_ciphertext TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.client_portal_invites
  ADD COLUMN IF NOT EXISTS token_ciphertext TEXT;
COMMENT ON COLUMN public.client_portal_invites.token_ciphertext IS
  'Authenticated-encrypted invitation token used only by the backend to resend the active private portal link.';

CREATE INDEX IF NOT EXISTS client_portal_invites_client_pending_idx
  ON public.client_portal_invites (client_id, expires_at DESC)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.client_portal_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_invites FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_portal_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.client_portal_invites TO service_role;

DROP POLICY IF EXISTS client_portal_invites_service_role ON public.client_portal_invites;
CREATE POLICY client_portal_invites_service_role
  ON public.client_portal_invites
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Preserve portal-only role separation for identities bound by the previous email-only flow.
UPDATE auth.users AS portal_user
SET raw_app_meta_data = COALESCE(portal_user.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object(
    'taxflow_client_portal', TRUE,
    'taxflow_portal_invite_required', TRUE
  )
WHERE EXISTS (
  SELECT 1
  FROM public.client_portal_access AS access
  WHERE access.user_id = portal_user.id
)
  AND portal_user.raw_app_meta_data ->> 'taxflow_portal_invite_claimed' IS DISTINCT FROM 'true';

-- Remove legacy bindings so they must claim a fresh client-specific invitation.
UPDATE public.client_portal_access AS access
SET user_id = NULL,
    active = FALSE,
    invitation_pending = FALSE,
    updated_at = clock_timestamp()
WHERE access.user_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM auth.users AS portal_user
    WHERE portal_user.id = access.user_id
      AND portal_user.raw_app_meta_data ->> 'taxflow_portal_invite_required' = 'true'
  );

UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data - 'taxflow_portal_invite_required'
WHERE raw_app_meta_data ->> 'taxflow_portal_invite_required' = 'true';

CREATE OR REPLACE FUNCTION public.claim_client_portal_invite(
  p_user_id UUID,
  p_token_hash TEXT
)
RETURNS TABLE (client_id UUID, invited_email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_invite public.client_portal_invites%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_access public.client_portal_access%ROWTYPE;
  v_user auth.users%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid portal invitation';
  END IF;

  SELECT * INTO v_user
  FROM auth.users
  WHERE id = p_user_id
    AND raw_app_meta_data ->> 'taxflow_client_portal' = 'true';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This account is not authorized for client portal enrollment';
  END IF;

  SELECT * INTO v_invite
  FROM public.client_portal_invites
  WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This portal invitation is invalid or expired';
  END IF;

  SELECT * INTO v_client
  FROM public.clients
  WHERE id = v_invite.client_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This portal invitation is no longer valid';
  END IF;

  SELECT * INTO v_invite
  FROM public.client_portal_invites
  WHERE id = v_invite.id
    AND token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND
    OR v_invite.consumed_at IS NOT NULL
    OR v_invite.revoked_at IS NOT NULL
    OR v_invite.expires_at <= clock_timestamp()
    OR lower(btrim(v_user.email)) IS DISTINCT FROM lower(btrim(v_invite.invited_email)) THEN
    RAISE EXCEPTION 'This portal invitation is invalid or expired';
  END IF;

  IF v_client.status IS DISTINCT FROM 'Active'
    OR lower(btrim(v_client.email)) IS DISTINCT FROM lower(btrim(v_invite.invited_email)) THEN
    RAISE EXCEPTION 'This portal invitation is no longer valid';
  END IF;

  SELECT * INTO v_access
  FROM public.client_portal_access
  WHERE client_id = v_client.id
  FOR UPDATE;

  IF FOUND THEN
    IF v_access.active AND v_access.user_id IS NOT NULL AND v_access.user_id <> p_user_id THEN
      RAISE EXCEPTION 'Client portal access is already linked to another account';
    END IF;
    UPDATE public.client_portal_access
    SET user_id = p_user_id,
        invited_email = lower(btrim(v_invite.invited_email)),
        active = TRUE,
        invitation_pending = FALSE,
        updated_at = clock_timestamp()
    WHERE id = v_access.id;
  ELSE
    INSERT INTO public.client_portal_access (
      client_id, user_id, invited_email, active, invitation_pending, created_by
    ) VALUES (
      v_client.id, p_user_id, lower(btrim(v_invite.invited_email)), TRUE, FALSE, v_invite.created_by
    );
  END IF;

  UPDATE public.client_portal_invites
  SET consumed_at = clock_timestamp()
  WHERE id = v_invite.id;

  UPDATE public.client_portal_invites
  SET revoked_at = clock_timestamp()
  WHERE client_portal_invites.client_id = v_client.id
    AND client_portal_invites.id <> v_invite.id
    AND consumed_at IS NULL
    AND revoked_at IS NULL;

  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('taxflow_portal_invite_claimed', TRUE)
  WHERE id = p_user_id;

  RETURN QUERY SELECT v_client.id, lower(btrim(v_invite.invited_email));
END;
$$;

CREATE OR REPLACE FUNCTION public.find_client_portal_auth_user(p_email TEXT)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
  SELECT id
  FROM auth.users
  WHERE email IS NOT NULL
    AND lower(btrim(email)) = lower(btrim(p_email))
    AND raw_app_meta_data ->> 'taxflow_client_portal' = 'true'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.claim_client_portal_invite(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_client_portal_invite(UUID, TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.find_client_portal_auth_user(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_client_portal_auth_user(TEXT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
