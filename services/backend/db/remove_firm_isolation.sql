-- Remove the retired firm-isolation/intake subsystem.
--
-- This migration intentionally does NOT remove:
--   user_profiles, clients, documents, compliance_tasks, notifications,
--   filing metadata, integration_secrets, or personal user_id ownership.
--
-- The active backend contains no code references to the taxflow_* tables.
-- Run the preflight query below first and confirm that these are the only
-- taxflow_* relations present before running the destructive section.

-- PRE-FLIGHT (run separately and review before continuing):
-- select n.nspname as schema_name, c.relname as relation_name,
--        case c.relkind when 'r' then 'table' when 'v' then 'view'
--          when 'm' then 'materialized view' when 'f' then 'foreign table'
--          else c.relkind::text end as relation_type
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname like 'taxflow_%'
-- order by c.relname;

begin;

-- Refuse to continue if an unrelated table depends on one of the retired
-- relations. This prevents accidental cascades into current application data.
do $$
declare
  dependency_record record;
begin
  for dependency_record in
    select conrelid::regclass::text as referencing_relation,
           confrelid::regclass::text as referenced_relation
    from pg_constraint c
    join (
      select to_regclass('public.taxflow_outbound_messages') as relation_id
      union all select to_regclass('public.taxflow_approved_artifacts')
      union all select to_regclass('public.taxflow_review_decisions')
      union all select to_regclass('public.taxflow_extraction_revisions')
      union all select to_regclass('public.taxflow_communication_schedules')
      union all select to_regclass('public.taxflow_documents')
      union all select to_regclass('public.taxflow_intake_events')
      union all select to_regclass('public.taxflow_audit_events')
      union all select to_regclass('public.taxflow_integration_accounts')
    ) target on target.relation_id = c.confrelid
    where c.contype = 'f'
      and c.conrelid not in (
        select relation_id
        from (
          select to_regclass('public.taxflow_outbound_messages') as relation_id
          union all select to_regclass('public.taxflow_approved_artifacts')
          union all select to_regclass('public.taxflow_review_decisions')
          union all select to_regclass('public.taxflow_extraction_revisions')
          union all select to_regclass('public.taxflow_communication_schedules')
          union all select to_regclass('public.taxflow_documents')
          union all select to_regclass('public.taxflow_intake_events')
          union all select to_regclass('public.taxflow_audit_events')
          union all select to_regclass('public.taxflow_integration_accounts')
        ) all_targets
        where relation_id is not null
      )
  loop
    raise exception 'Firm migration refused: unrelated foreign key % depends on %',
      dependency_record.referencing_relation,
      dependency_record.referenced_relation;
  end loop;
end;
$$;

-- Remove policies explicitly so this migration does not rely on broad
-- cascades for authorization objects.
do $$
declare
  relation_name text;
  policy_record record;
begin
  for relation_name in
    select unnest(array[
      'taxflow_outbound_messages',
      'taxflow_approved_artifacts',
      'taxflow_review_decisions',
      'taxflow_extraction_revisions',
      'taxflow_communication_schedules',
      'taxflow_documents',
      'taxflow_intake_events',
      'taxflow_audit_events',
      'taxflow_integration_accounts'
    ])
  loop
    if to_regclass('public.' || relation_name) is not null then
      for policy_record in
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = relation_name
      loop
        execute format('drop policy if exists %I on public.%I', policy_record.policyname, relation_name);
      end loop;
    end if;
  end loop;
end;
$$;

-- Drop only the retired firm-specific relations, from dependants to parents.
drop table if exists public.taxflow_outbound_messages;
drop table if exists public.taxflow_approved_artifacts;
drop table if exists public.taxflow_review_decisions;
drop table if exists public.taxflow_extraction_revisions;
drop table if exists public.taxflow_communication_schedules;
drop table if exists public.taxflow_documents;
drop table if exists public.taxflow_intake_events;
drop table if exists public.taxflow_audit_events;
drop table if exists public.taxflow_integration_accounts;

commit;
