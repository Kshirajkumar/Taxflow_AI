-- TaxFlow.AI: database-backed activity notifications.
-- Run this migration in the Supabase SQL editor after the clients table exists.

CREATE TABLE IF NOT EXISTS public.notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type    VARCHAR(50) NOT NULL,
  title         VARCHAR(160) NOT NULL,
  message       TEXT NOT NULL,
  entity_type   VARCHAR(50),
  entity_id     UUID,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own notifications" ON public.notifications;
CREATE POLICY "Users can read their own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, read_at)
  WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION public.create_client_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  client_name TEXT;
  notification_user_id UUID;
  notification_client_id UUID;
  notification_type TEXT;
  notification_title TEXT;
  notification_message TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    client_name := NEW.name;
    notification_user_id := NEW.user_id;
    notification_client_id := NEW.id;
    notification_type := 'client.created';
    notification_title := 'New client added';
    notification_message := format('%s was added to your client registry.', NEW.name);
  ELSIF TG_OP = 'DELETE' THEN
    client_name := OLD.name;
    notification_user_id := OLD.user_id;
    notification_client_id := OLD.id;
    notification_type := 'client.deleted';
    notification_title := 'Client removed';
    notification_message := format('%s was permanently removed from your client registry.', OLD.name);
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id,
    event_type,
    title,
    message,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    notification_user_id,
    notification_type,
    notification_title,
    notification_message,
    'client',
    notification_client_id,
    jsonb_build_object('client_name', client_name)
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_create_notification ON public.clients;
CREATE TRIGGER trg_clients_create_notification
  AFTER INSERT OR DELETE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.create_client_notification();

NOTIFY pgrst, 'reload schema';
