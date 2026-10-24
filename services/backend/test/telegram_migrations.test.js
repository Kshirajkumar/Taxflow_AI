const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationDirectory = path.join(__dirname, '..', 'db');

test('storage migration replaces the sync RPC with the portal-only result shape', () => {
  const sql = fs.readFileSync(path.join(migrationDirectory, 'create_taxflow_storage_bucket.sql'), 'utf8');
  const dropIndex = sql.indexOf('DROP FUNCTION IF EXISTS public.list_pending_document_sync(UUID, UUID, INTEGER);');
  const createIndex = sql.indexOf('CREATE FUNCTION public.list_pending_document_sync(', dropIndex);

  assert.notEqual(dropIndex, -1);
  assert.ok(createIndex > dropIndex);
  assert.match(sql.slice(createIndex), /created_at TIMESTAMPTZ,\s+source TEXT/);
  assert.match(sql.slice(createIndex), /d\.source = 'Portal'/);
  assert.doesNotMatch(sql.slice(createIndex), /d\.source\s*=\s*'Telegram'/);
  assert.doesNotMatch(sql, /ON storage\.objects/i);
});

test('document sync repair returns portal documents only', () => {
  const sql = fs.readFileSync(path.join(migrationDirectory, 'fix_telegram_document_sync_queue.sql'), 'utf8');
  const dropIndex = sql.indexOf('DROP FUNCTION IF EXISTS public.list_pending_document_sync(UUID, UUID, INTEGER);');
  const createIndex = sql.indexOf('CREATE FUNCTION public.list_pending_document_sync(', dropIndex);

  assert.notEqual(dropIndex, -1);
  assert.ok(createIndex > dropIndex);
  assert.match(sql.slice(createIndex), /created_at TIMESTAMPTZ,\s+source TEXT/);
  assert.match(sql.slice(createIndex), /d\.source = 'Portal'/);
  assert.doesNotMatch(sql.slice(createIndex), /d\.source\s*=\s*'Telegram'/);
});
