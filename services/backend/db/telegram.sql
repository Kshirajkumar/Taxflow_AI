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
alter table public.telegram_messages drop constraint if exists telegram_messages_delivery_status_check;
alter table public.telegram_messages add constraint telegram_messages_delivery_status_check check (delivery_status in ('received', 'queued', 'sent', 'failed'));

alter table public.telegram_link_tokens enable row level security;
alter table public.telegram_messages enable row level security;
drop policy if exists telegram_link_tokens_owner on public.telegram_link_tokens;
drop policy if exists telegram_messages_owner on public.telegram_messages;
create policy telegram_link_tokens_owner on public.telegram_link_tokens for all using (exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid())) with check (exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid()));
create policy telegram_messages_owner on public.telegram_messages for select using (exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid()));
