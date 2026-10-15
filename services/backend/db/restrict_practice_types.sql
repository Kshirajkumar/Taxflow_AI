-- Restrict personal account categories to the two supported values.
-- This migration refuses to guess how any legacy category should be mapped.

begin;

do $$
begin
  if exists (
    select 1
    from public.user_profiles
    where practice_type is not null
      and practice_type not in ('Chartered Accountant (CA)', 'Individual')
  ) then
    raise exception 'Migration refused: user_profiles contains an unsupported practice_type. Review those rows before retrying.';
  end if;
end;
$$;

alter table public.user_profiles
  drop constraint if exists user_profiles_practice_type_check;

alter table public.user_profiles
  add constraint user_profiles_practice_type_check
  check (practice_type in ('Chartered Accountant (CA)', 'Individual'));

commit;
