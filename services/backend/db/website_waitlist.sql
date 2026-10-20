-- TaxFlow marketing-site waitlist for the existing application Supabase project.
-- Run this in the SQL Editor of the same project used by the TaxFlow app.
-- This migration does not create another project or modify app auth/profile tables.

create table if not exists public.website_waitlist (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null,
  firm text,
  role text,
  country text,
  team_size text,
  consent boolean not null,
  consent_at timestamptz not null default now(),
  source text not null default 'website',
  created_at timestamptz not null default now()
);

alter table public.website_waitlist add column if not exists name text;
alter table public.website_waitlist add column if not exists email text;
alter table public.website_waitlist add column if not exists firm text;
alter table public.website_waitlist add column if not exists role text;
alter table public.website_waitlist add column if not exists country text;
alter table public.website_waitlist add column if not exists team_size text;
alter table public.website_waitlist add column if not exists consent boolean;
alter table public.website_waitlist add column if not exists consent_at timestamptz not null default now();
alter table public.website_waitlist add column if not exists source text not null default 'website';
alter table public.website_waitlist add column if not exists created_at timestamptz not null default now();

alter table public.website_waitlist alter column name drop not null;
alter table public.website_waitlist alter column firm drop not null;
alter table public.website_waitlist alter column role drop not null;
alter table public.website_waitlist alter column country drop not null;
alter table public.website_waitlist alter column team_size drop not null;
alter table public.website_waitlist alter column email set not null;
alter table public.website_waitlist alter column consent set not null;

alter table public.website_waitlist drop constraint if exists website_waitlist_email_check;
alter table public.website_waitlist
  add constraint website_waitlist_email_check
  check (
    email = lower(btrim(email))
    and char_length(email) <= 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  );

alter table public.website_waitlist drop constraint if exists website_waitlist_name_check;
alter table public.website_waitlist
  add constraint website_waitlist_name_check
  check (name is null or char_length(btrim(name)) between 1 and 120);

alter table public.website_waitlist drop constraint if exists website_waitlist_firm_check;
alter table public.website_waitlist
  add constraint website_waitlist_firm_check
  check (firm is null or char_length(btrim(firm)) between 1 and 160);

alter table public.website_waitlist drop constraint if exists website_waitlist_role_check;
alter table public.website_waitlist
  add constraint website_waitlist_role_check
  check (role is null or char_length(btrim(role)) between 1 and 120);

alter table public.website_waitlist drop constraint if exists website_waitlist_country_check;
alter table public.website_waitlist
  add constraint website_waitlist_country_check
  check (country is null or char_length(btrim(country)) between 1 and 100);

alter table public.website_waitlist drop constraint if exists website_waitlist_team_size_check;
alter table public.website_waitlist
  add constraint website_waitlist_team_size_check
  check (team_size is null or char_length(btrim(team_size)) between 1 and 40);

alter table public.website_waitlist drop constraint if exists website_waitlist_consent_check;
alter table public.website_waitlist
  add constraint website_waitlist_consent_check
  check (consent is true);

alter table public.website_waitlist drop constraint if exists website_waitlist_source_check;
alter table public.website_waitlist
  add constraint website_waitlist_source_check
  check (source = 'website');

create unique index if not exists website_waitlist_email_lower_uidx
  on public.website_waitlist (lower(email));

create index if not exists website_waitlist_created_at_idx
  on public.website_waitlist (created_at desc);

create or replace function public.normalize_website_waitlist_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name = nullif(btrim(new.name), '');
  new.email = lower(btrim(new.email));
  new.firm = nullif(btrim(new.firm), '');
  new.role = nullif(btrim(new.role), '');
  new.country = nullif(btrim(new.country), '');
  new.team_size = nullif(btrim(new.team_size), '');
  new.source = 'website';
  return new;
end;
$$;

drop trigger if exists website_waitlist_normalize_entry on public.website_waitlist;
create trigger website_waitlist_normalize_entry
  before insert on public.website_waitlist
  for each row execute function public.normalize_website_waitlist_entry();

alter table public.website_waitlist enable row level security;

drop policy if exists "Website visitors can join the waitlist" on public.website_waitlist;
revoke all on table public.website_waitlist from public, anon, authenticated;

create or replace function public.join_website_waitlist(
  p_email text,
  p_consent boolean,
  p_name text default null,
  p_firm text default null,
  p_role text default null,
  p_country text default null,
  p_team_size text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_name text := nullif(btrim(p_name), '');
  normalized_firm text := nullif(btrim(p_firm), '');
  normalized_role text := nullif(btrim(p_role), '');
  normalized_country text := nullif(btrim(p_country), '');
  normalized_team_size text := nullif(btrim(p_team_size), '');
begin
  if p_consent is distinct from true then
    raise exception 'Consent is required to join the waitlist.' using errcode = '22023';
  end if;

  if char_length(normalized_email) > 254
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  if (normalized_name is not null and char_length(normalized_name) > 120)
    or (normalized_firm is not null and char_length(normalized_firm) > 160)
    or (normalized_role is not null and char_length(normalized_role) > 120)
    or (normalized_country is not null and char_length(normalized_country) > 100)
    or (normalized_team_size is not null and char_length(normalized_team_size) > 40) then
    raise exception 'One or more waitlist fields are too long.' using errcode = '22023';
  end if;

  insert into public.website_waitlist (name, email, firm, role, country, team_size, consent, source)
  values (
    normalized_name,
    normalized_email,
    normalized_firm,
    normalized_role,
    normalized_country,
    normalized_team_size,
    true,
    'website'
  )
  on conflict (lower(email)) do nothing;
end;
$$;

revoke all on function public.join_website_waitlist(text, boolean, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.join_website_waitlist(text, boolean, text, text, text, text, text) to anon, authenticated;
revoke all on function public.normalize_website_waitlist_entry() from public, anon, authenticated;

comment on table public.website_waitlist is
  'Marketing-site waitlist submissions. Public clients submit through a validation function and cannot read or change entries.';
