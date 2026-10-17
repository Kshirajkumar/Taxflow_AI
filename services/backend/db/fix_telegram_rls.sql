-- ==============================================================================
-- TaxFlow.AI — Telegram Tables RLS Fix
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/_/sql
-- ==============================================================================

-- 1. Ensure tables have Row Level Security enabled
alter table public.telegram_link_tokens enable row level security;
alter table public.telegram_messages enable row level security;

-- 2. The backend uses the service role; authenticated access remains ownership-scoped.
grant all on public.telegram_link_tokens to service_role;
grant all on public.telegram_messages to service_role;
grant select, insert, update, delete on public.telegram_link_tokens to authenticated;
grant select, insert, update, delete on public.telegram_messages to authenticated;
revoke all on public.telegram_link_tokens from anon;
revoke all on public.telegram_messages from anon;

-- 3. Policy for service_role (Full administrative and webhook access)
drop policy if exists telegram_link_tokens_service_role on public.telegram_link_tokens;
create policy telegram_link_tokens_service_role on public.telegram_link_tokens
  for all to service_role
  using (true)
  with check (true);

drop policy if exists telegram_messages_service_role on public.telegram_messages;
create policy telegram_messages_service_role on public.telegram_messages
  for all to service_role
  using (true)
  with check (true);

-- 4. Policy for authenticated users (Scoped to clients they own)
drop policy if exists telegram_link_tokens_owner on public.telegram_link_tokens;
create policy telegram_link_tokens_owner on public.telegram_link_tokens
  for all to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid()));

drop policy if exists telegram_messages_owner on public.telegram_messages;
create policy telegram_messages_owner on public.telegram_messages
  for all to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid()));

-- 5. Remove legacy anon policies. The backend must use SUPABASE_SERVICE_ROLE_KEY.
drop policy if exists telegram_messages_backend_fallback on public.telegram_messages;
drop policy if exists telegram_link_tokens_backend_fallback on public.telegram_link_tokens;

notify pgrst, 'reload schema';
