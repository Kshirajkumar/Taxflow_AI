const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 500;
const STORAGE_PAGE_SIZE = 100;
const STORAGE_REMOVE_BATCH_SIZE = 100;

async function fetchAllPages(makeQuery) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function collectStorageFiles(storage, bucket, folder, files, visited) {
  const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
  if (visited.has(normalizedFolder)) return;
  visited.add(normalizedFolder);

  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data, error } = await storage.from(bucket).list(normalizedFolder, {
      limit: STORAGE_PAGE_SIZE,
      offset
    });
    if (error) throw new Error(`Could not enumerate private storage for account deletion: ${error.message}`);
    const entries = data || [];
    for (const entry of entries) {
      if (!entry?.name || entry.name === '.' || entry.name === '..' || entry.name.includes('/')) continue;
      const objectPath = `${normalizedFolder}/${entry.name}`;
      if (entry.id === null) {
        await collectStorageFiles(storage, bucket, objectPath, files, visited);
      } else {
        files.add(objectPath);
      }
    }
    if (entries.length < STORAGE_PAGE_SIZE) return;
  }
}

async function deleteAccountStorage(supabase, userId, configuredBucket) {
  if (!UUID_PATTERN.test(userId || '')) throw new Error('A valid account ID is required for storage cleanup.');

  const clients = await fetchAllPages(() => supabase
    .from('clients')
    .select('id')
    .eq('user_id', userId)
    .order('id'));
  const clientIds = clients.map((client) => client.id).filter(Boolean);
  const docsByClient = [];
  for (let offset = 0; offset < clientIds.length; offset += 100) {
    const clientBatch = clientIds.slice(offset, offset + 100);
    const documents = await fetchAllPages(() => supabase
      .from('documents_metadata')
      .select('storage_bucket,storage_object_path')
      .in('client_id', clientBatch)
      .order('id')
      .not('storage_object_path', 'is', null));
    docsByClient.push(...documents);
  }

  const objectsByBucket = new Map();
  const addObject = (bucket, objectPath) => {
    if (!bucket || !objectPath) return;
    const safePath = String(objectPath).replace(/^\/+/, '');
    if (!safePath.startsWith(`${userId}/`) && !safePath.startsWith('undefined/')) {
      throw new Error('Account deletion stopped because a linked cloud file path is outside the account storage namespace.');
    }
    if (!objectsByBucket.has(bucket)) objectsByBucket.set(bucket, new Set());
    objectsByBucket.get(bucket).add(safePath);
  };

  for (const document of docsByClient) {
    addObject(document.storage_bucket, document.storage_object_path);
  }

  if (configuredBucket) {
    if (!objectsByBucket.has(configuredBucket)) objectsByBucket.set(configuredBucket, new Set());
    await collectStorageFiles(
      supabase.storage,
      configuredBucket,
      userId,
      objectsByBucket.get(configuredBucket),
      new Set()
    );
  }

  let deletedObjectCount = 0;
  for (const [bucket, objectPaths] of objectsByBucket) {
    const paths = Array.from(objectPaths);
    for (let offset = 0; offset < paths.length; offset += STORAGE_REMOVE_BATCH_SIZE) {
      const { error } = await supabase.storage.from(bucket).remove(paths.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE));
      if (error) throw new Error(`Could not remove private account files from bucket "${bucket}": ${error.message}`);
      deletedObjectCount += Math.min(STORAGE_REMOVE_BATCH_SIZE, paths.length - offset);
    }
  }

  return { deletedObjectCount };
}

async function deleteAccountVaultSecrets(supabase, userId) {
  const integrations = await fetchAllPages(() => supabase
    .from('integration_secrets')
    .select('id,vault_secret_id')
    .eq('owner_user_id', userId)
    .order('id'));
  const secretIds = Array.from(new Set(integrations.map((integration) => integration.vault_secret_id).filter(Boolean)));
  if (!secretIds.length) return { deletedSecretCount: 0 };

  let deletedSecretCount = 0;
  for (let offset = 0; offset < secretIds.length; offset += 100) {
    const { data, error } = await supabase.rpc('delete_account_vault_secrets', {
      p_owner_user_id: userId,
      p_secret_ids: secretIds.slice(offset, offset + 100)
    });
    if (error) {
      throw new Error(`Could not remove account-owned integration secrets from Supabase Vault: ${error.message}`);
    }
    if (!Number.isSafeInteger(data) || data < 0) {
      throw new Error('Supabase Vault returned an invalid result while deleting account integration secrets.');
    }
    deletedSecretCount += data;
  }

  return { deletedSecretCount };
}

module.exports = { deleteAccountStorage, deleteAccountVaultSecrets };
