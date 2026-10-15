-- Personal CA account migration
-- Run this only after confirming the account is not a firm owner.
-- This migration intentionally creates no firm and does not move client data.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.user_profiles (id, full_name, practice_type, membership_no)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.raw_user_meta_data ->> 'practice_type', 'Chartered Accountant (CA)'),
    new.raw_user_meta_data ->> 'membership_no'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- The current account is personal. Remove the old constraint first so the
-- existing profile can be cleared safely. No clients exist in the verified DB.
alter table public.user_profiles
  alter column firm_name drop not null;

alter table public.user_profiles
  alter column firm_name drop default;

update public.user_profiles
set firm_name = null,
    updated_at = now();

alter table public.user_profiles
  drop column if exists firm_name;

commit;
