-- ==============================================================================
-- TaxFlow.AI — Telegram Tables RLS Fix
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/_/sql
-- ==============================================================================

-- 1. Ensure tables have Row Level Security enabled
alter table public.telegram_link_tokens enable row level security;
alter table public.telegram_messages enable row level security;

-- 2. Grant table permissions to service_role, authenticated, and anon
grant all on public.telegram_link_tokens to service_role;
grant all on public.telegram_messages to service_role;
grant select, insert, update, delete on public.telegram_link_tokens to authenticated, anon;
grant select, insert, update, delete on public.telegram_messages to authenticated, anon;

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

-- 5. Fallback policy for backend operations running under anon key (e.g. Render server or Telegram Webhook updates)
drop policy if exists telegram_messages_backend_fallback on public.telegram_messages;
create policy telegram_messages_backend_fallback on public.telegram_messages
  for all to anon
  using (true)
  with check (true);

drop policy if exists telegram_link_tokens_backend_fallback on public.telegram_link_tokens;
create policy telegram_link_tokens_backend_fallback on public.telegram_link_tokens
  for all to anon
  using (true)
  with check (true);

notify pgrst, 'reload schema';
