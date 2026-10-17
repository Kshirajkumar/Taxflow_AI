create table if not exists public.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.telegram_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  provider_message_id text not null,
  provider_response_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  chat_id text not null,
  sender_user_id text,
  body text not null check (char_length(body) between 1 and 4096),
  message_type text not null default 'text',
  telegram_file_id text,
  telegram_file_name text,
  mime_type text,
  file_size bigint,
  vault_file_ref uuid,
  file_download_error text,
  delivery_status text not null default 'received',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider_message_id, direction)
);

alter table public.clients add column if not exists telegram_user_id text;
alter table public.clients add column if not exists telegram_chat_id text;
alter table public.clients add column if not exists telegram_linked_at timestamptz;
create unique index if not exists clients_telegram_chat_id_unique on public.clients(telegram_chat_id) where telegram_chat_id is not null;
create unique index if not exists telegram_messages_provider_direction_unique on public.telegram_messages(provider_message_id, direction);
create index if not exists telegram_messages_client_created_idx on public.telegram_messages(client_id, created_at desc);
alter table public.telegram_messages add column if not exists approved_by uuid references auth.users(id);
alter table public.telegram_messages add column if not exists approved_at timestamptz;
alter table public.telegram_messages add column if not exists provider_response_id text;
alter table public.telegram_messages add column if not exists telegram_file_id text;
alter table public.telegram_messages add column if not exists telegram_file_name text;
alter table public.telegram_messages add column if not exists mime_type text;
alter table public.telegram_messages add column if not exists file_size bigint;
alter table public.telegram_messages add column if not exists vault_file_ref uuid;
alter table public.telegram_messages add column if not exists file_download_error text;
alter table public.telegram_messages drop constraint if exists telegram_messages_delivery_status_check;
alter table public.telegram_messages add constraint telegram_messages_delivery_status_check check (delivery_status in ('received', 'queued', 'sent', 'failed'));

alter table public.telegram_link_tokens enable row level security;
alter table public.telegram_messages enable row level security;

-- The backend uses the service role. Authenticated access remains ownership-scoped.
grant all on public.telegram_link_tokens to service_role;
grant all on public.telegram_messages to service_role;
grant select, insert, update, delete on public.telegram_link_tokens to authenticated;
grant select, insert, update, delete on public.telegram_messages to authenticated;
revoke all on public.telegram_link_tokens from anon;
revoke all on public.telegram_messages from anon;

-- 1. Full access for service_role (backend worker)
drop policy if exists telegram_link_tokens_service_role on public.telegram_link_tokens;
create policy telegram_link_tokens_service_role on public.telegram_link_tokens
  for all to service_role using (true) with check (true);

drop policy if exists telegram_messages_service_role on public.telegram_messages;
create policy telegram_messages_service_role on public.telegram_messages
  for all to service_role using (true) with check (true);

-- 2. Authenticated user access (scoped to client ownership)
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

-- Remove legacy anon fallback policies. The backend must use SUPABASE_SERVICE_ROLE_KEY.
drop policy if exists telegram_messages_backend_fallback on public.telegram_messages;
drop policy if exists telegram_link_tokens_backend_fallback on public.telegram_link_tokens;

-- 4. Unread tracking and automatic notifications
alter table public.telegram_messages add column if not exists is_read boolean not null default false;
alter table public.telegram_messages add column if not exists read_at timestamptz;
create index if not exists idx_telegram_messages_unread on public.telegram_messages(client_id, is_read) where direction = 'inbound' and is_read = false;

create or replace function public.create_telegram_message_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_client_name text;
  v_body_preview text;
begin
  if NEW.direction = 'inbound' then
    select user_id, name into v_user_id, v_client_name
    from public.clients
    where id = NEW.client_id;

    if v_user_id is not null then
      if length(NEW.body) > 120 then
        v_body_preview := substring(NEW.body from 1 for 117) || '...';
      else
        v_body_preview := NEW.body;
      end if;

      insert into public.notifications (
        user_id,
        event_type,
        title,
        message,
        entity_type,
        entity_id,
        metadata
      ) values (
        v_user_id,
        'telegram.message_received',
        format('Telegram from %s', coalesce(v_client_name, 'Client')),
        v_body_preview,
        'client',
        NEW.client_id,
        jsonb_build_object(
          'client_id', NEW.client_id,
          'client_name', v_client_name,
          'chat_id', NEW.chat_id,
          'message_id', NEW.id
        )
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_telegram_message_notification on public.telegram_messages;
create trigger trg_telegram_message_notification
  after insert on public.telegram_messages
  for each row
  execute function public.create_telegram_message_notification();
