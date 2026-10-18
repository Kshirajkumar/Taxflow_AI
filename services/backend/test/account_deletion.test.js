const test = require('node:test');
const assert = require('node:assert/strict');
const { deleteAccountStorage } = require('../lib/accountDeletion');

const userId = '11752602-62fa-4252-ae1d-23c4fb3b7312';
const clientId = '20314145-9020-45f0-85a0-68bc63eb359e';
const secretId = '49815d77-b97f-4abf-ae4b-65cd91af0160';

function createSupabase({ documents = [], integrations = [], storageEntries = {}, listError = null, rpcResult = 0 } = {}) {
  const removed = [];
  const rpcCalls = [];
  const tables = {
    clients: [{ id: clientId, user_id: userId }],
    documents_metadata: documents,
    integration_secrets: integrations
  };

  return {
    removed,
    rpcCalls,
    from(table) {
      const filters = [];
      return {
        select() { return this; },
        eq(field, value) { filters.push((row) => row[field] === value); return this; },
        in(field, values) { filters.push((row) => values.includes(row[field])); return this; },
        not(field, _operator, value) { filters.push((row) => row[field] !== value); return this; },
        order() { return this; },
        async range(start, end) {
          const data = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
          return { data: data.slice(start, end + 1), error: null };
        }
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: rpcResult, error: null };
    },
    storage: {
      from(bucket) {
        return {
          async list(folder) {
            if (listError) return { data: null, error: listError };
            return { data: storageEntries[`${bucket}/${folder}`] || [], error: null };
          },
          async remove(paths) {
            removed.push({ bucket, paths });
            return { data: paths, error: null };
          }
        };
      }
    }
  };
}

test('account cleanup removes only linked objects and recursively enumerates account-prefixed files', async () => {
  const supabase = createSupabase({
    documents: [
      { client_id: clientId, storage_bucket: 'legacy-bucket', storage_object_path: `${userId}/client/document.pdf` },
      { client_id: clientId, storage_bucket: 'legacy-bucket', storage_object_path: 'undefined/legacy-photo.jpg' }
    ],
    storageEntries: {
      [`taxflow-intake/${userId}`]: [
        { name: 'client', id: null },
        { name: 'root-file.pdf', id: 'file-id' }
      ],
      [`taxflow-intake/${userId}/client`]: [
        { name: 'nested-photo.jpg', id: 'nested-file-id' }
      ]
    }
  });

  const result = await deleteAccountStorage(supabase, userId, 'taxflow-intake');

  assert.deepEqual(result, { deletedObjectCount: 4 });
  assert.deepEqual(supabase.removed, [
    {
      bucket: 'legacy-bucket',
      paths: [`${userId}/client/document.pdf`, 'undefined/legacy-photo.jpg']
    },
    {
      bucket: 'taxflow-intake',
      paths: [`${userId}/client/nested-photo.jpg`, `${userId}/root-file.pdf`]
    }
  ]);
});

test('account cleanup stops before deleting when metadata points outside allowed namespaces', async () => {
  const supabase = createSupabase({
    documents: [
      { client_id: clientId, storage_bucket: 'legacy-bucket', storage_object_path: 'another-account/private.pdf' }
    ]
  });

  await assert.rejects(
    deleteAccountStorage(supabase, userId, 'taxflow-intake'),
    /outside the account storage namespace/
  );
  assert.deepEqual(supabase.removed, []);
});

test('account cleanup reports Storage enumeration failures instead of continuing', async () => {
  const supabase = createSupabase({ listError: new Error('Storage unavailable') });

  await assert.rejects(
    deleteAccountStorage(supabase, userId, 'taxflow-intake'),
    /Could not enumerate private storage.*Storage unavailable/
  );
  assert.deepEqual(supabase.removed, []);
});

test('account cleanup removes owned Vault secrets through the restricted database RPC', async () => {
  const { deleteAccountVaultSecrets } = require('../lib/accountDeletion');
  const supabase = createSupabase({
    integrations: [
      { id: 'integration-1', owner_user_id: userId, vault_secret_id: secretId },
      { id: 'integration-2', owner_user_id: userId, vault_secret_id: secretId }
    ],
    rpcResult: 1
  });

  const result = await deleteAccountVaultSecrets(supabase, userId);

  assert.deepEqual(result, { deletedSecretCount: 1 });
  assert.deepEqual(supabase.rpcCalls, [{
    name: 'delete_account_vault_secrets',
    args: { p_owner_user_id: userId, p_secret_ids: [secretId] }
  }]);
});

test('account cleanup does not hide a Vault RPC failure', async () => {
  const { deleteAccountVaultSecrets } = require('../lib/accountDeletion');
  const supabase = createSupabase({
    integrations: [{ id: 'integration-1', owner_user_id: userId, vault_secret_id: secretId }]
  });
  supabase.rpc = async () => ({ data: null, error: new Error('Vault function is unavailable') });

  await assert.rejects(
    deleteAccountVaultSecrets(supabase, userId),
    /Could not remove account-owned integration secrets.*Vault function is unavailable/
  );
});
