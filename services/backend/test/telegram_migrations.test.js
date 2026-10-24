const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationDirectory = path.join(__dirname, '..', 'db');

test('Telegram storage migration replaces the sync RPC with the portal-compatible result shape', () => {
  const sql = fs.readFileSync(path.join(migrationDirectory, 'create_taxflow_storage_bucket.sql'), 'utf8');
  const dropIndex = sql.indexOf('DROP FUNCTION IF EXISTS public.list_pending_document_sync(UUID, UUID, INTEGER);');
  const createIndex = sql.indexOf('CREATE FUNCTION public.list_pending_document_sync(', dropIndex);

  assert.notEqual(dropIndex, -1);
  assert.ok(createIndex > dropIndex);
  assert.match(sql.slice(createIndex), /created_at TIMESTAMPTZ,\s+source TEXT/);
  assert.match(sql.slice(createIndex), /d\.source IN \('Telegram', 'Portal'\)/);
  assert.doesNotMatch(sql, /ON storage\.objects/i);
});

test('document sync repair preserves Telegram and portal source metadata', () => {
  const sql = fs.readFileSync(path.join(migrationDirectory, 'fix_telegram_document_sync_queue.sql'), 'utf8');
  const dropIndex = sql.indexOf('DROP FUNCTION IF EXISTS public.list_pending_document_sync(UUID, UUID, INTEGER);');
  const createIndex = sql.indexOf('CREATE FUNCTION public.list_pending_document_sync(', dropIndex);

  assert.notEqual(dropIndex, -1);
  assert.ok(createIndex > dropIndex);
  assert.match(sql.slice(createIndex), /created_at TIMESTAMPTZ,\s+source TEXT/);
  assert.match(sql.slice(createIndex), /d\.source IN \('Telegram', 'Portal'\)/);
});
