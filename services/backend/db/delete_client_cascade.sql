/**
 * Client deletion policy
 *
 * Run once in Supabase SQL Editor. This is safe to run repeatedly.
 * Every foreign key in public that points to public.clients is rebuilt with
 * ON DELETE CASCADE, so deleting a client cannot leave client-owned rows.
 * Reference/master tables are not affected because they do not reference
 * clients.
 */
DO $$
DECLARE
  fk RECORD;
  child_columns TEXT;
  parent_columns TEXT;
BEGIN
  FOR fk IN
    SELECT
      c.oid AS constraint_oid,
      c.conname,
      child_ns.nspname AS child_schema,
      child.relname AS child_table,
      c.conrelid,
      c.conkey,
      c.confkey
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.clients'::regclass
      AND child_ns.nspname = 'public'
  LOOP
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY cols.ordinality)
      INTO child_columns
    FROM unnest(fk.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
    JOIN pg_attribute a
      ON a.attrelid = fk.conrelid AND a.attnum = cols.attnum;

    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY cols.ordinality)
      INTO parent_columns
    FROM unnest(fk.confkey) WITH ORDINALITY AS cols(attnum, ordinality)
    JOIN pg_attribute a
      ON a.attrelid = 'public.clients'::regclass AND a.attnum = cols.attnum;

    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      fk.child_schema, fk.child_table, fk.conname
    );

    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES public.clients (%s) ON DELETE CASCADE',
      fk.child_schema, fk.child_table, fk.conname, child_columns, parent_columns
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_client_id ON public.ai_usage_log(client_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_client_id ON public.whatsapp_messages(client_id);
