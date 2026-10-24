const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationDirectory = path.join(__dirname, '..', 'db');

test('Telegram migration adds the client status required for secure connection links', () => {
  const sql = fs.readFileSync(path.join(migrationDirectory, 'telegram.sql'), 'utf8');
  assert.match(sql, /alter table public\.clients add column if not exists status varchar\(20\) not null default 'Active'/i);
  assert.match(sql, /check \(status in \('Active', 'Inactive', 'Suspended'\)\) not valid/i);
});

test('portal invitation migration adds server-encrypted token storage for private media replies', () => {
  const sql = fs.readFileSync(path.join(migrationDirectory, 'client_portal_invites.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS token_ciphertext TEXT/i);
  assert.match(sql, /authenticated-encrypted invitation token/i);
});

test('portal migration enables existing active clients with email without reactivating prior access records', () => {
  const sql = fs.readFileSync(path.join(migrationDirectory, 'client_portal.sql'), 'utf8');
  assert.match(sql, /INSERT INTO public\.client_portal_access/i);
  assert.match(sql, /client\.status = 'Active'/i);
  assert.match(sql, /lower\(btrim\(client\.email\)\)/i);
  assert.match(sql, /ON CONFLICT \(client_id\) DO NOTHING/i);
});

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

test('Telegram file-transfer cleanup preserves message history while removing document links', () => {
  const sql = fs.readFileSync(path.join(migrationDirectory, 'decommission_telegram_file_transfer.sql'), 'utf8');
  assert.match(sql, /UPDATE public\.telegram_messages/);
  assert.match(sql, /DROP COLUMN IF EXISTS telegram_file_id/);
  assert.match(sql, /DROP COLUMN IF EXISTS attachment_download_status/);
  assert.match(sql, /DROP COLUMN IF EXISTS telegram_message_id/);
  assert.doesNotMatch(sql, /DELETE FROM public\.documents_metadata/i);
  assert.doesNotMatch(sql, /DELETE FROM storage\.objects/i);
});
