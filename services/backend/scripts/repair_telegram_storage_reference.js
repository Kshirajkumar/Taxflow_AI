const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');
const { getMetadataStorageObjectKey, normalizeMimeType } = require('../lib/documentStorage');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function repairTelegramStorageReference(documentId) {
  if (!UUID_PATTERN.test(documentId || '')) {
    throw new Error('Usage: npm run repair:telegram-storage-reference -- <document-uuid>');
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const bucket = String(process.env.SUPABASE_STORAGE_BUCKET || '').trim();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !bucket) {
    throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET must be configured in the backend environment.');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const { data: document, error: documentError } = await supabase
    .from('documents_metadata')
    .select('id,client_id,source,created_at,file_name,storage_bucket,storage_object_path,file_sha256,mime_type')
    .eq('id', documentId)
    .single();
  if (documentError) throw new Error(`Could not load document metadata: ${documentError.message}`);
  if (document.source !== 'Telegram' || document.storage_bucket !== bucket) {
    throw new Error('The document is not a Telegram file in the configured private storage bucket.');
  }
  if (!/^[0-9a-f]{64}$/i.test(document.file_sha256 || '')) {
    throw new Error('The document has no valid SHA-256 checksum; refusing to move unverified file data.');
  }

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id,user_id')
    .eq('id', document.client_id)
    .single();
  if (clientError) throw new Error(`Could not verify document ownership: ${clientError.message}`);
  if (!UUID_PATTERN.test(client.user_id || '')) {
    throw new Error('The linked client has no valid owner UUID; repair client ownership before moving this file.');
  }

  const canonicalKey = getMetadataStorageObjectKey({
    userId: client.user_id,
    clientId: client.id,
    createdAt: document.created_at,
    fileName: document.file_name
  });
  const legacyKey = `undefined/${canonicalKey.split('/').slice(1).join('/')}`;
  if (document.storage_object_path !== legacyKey) {
    if (document.storage_object_path === canonicalKey) {
      console.log(`Document ${documentId} already has a valid canonical Storage reference.`);
      return;
    }
    throw new Error('The stored object path is not the known undefined-owner legacy format; no changes were made.');
  }

  const { data: sourceBlob, error: downloadError } = await supabase.storage
    .from(bucket)
    .download(legacyKey);
  if (downloadError) throw new Error(`Could not download the legacy object: ${downloadError.message}`);
  const bytes = Buffer.from(await sourceBlob.arrayBuffer());
  if (checksum(bytes) !== document.file_sha256.toLowerCase()) {
    throw new Error('The legacy object checksum does not match its document metadata; no changes were made.');
  }

  const { error: uploadError } = await supabase.storage.from(bucket).upload(canonicalKey, bytes, {
    contentType: normalizeMimeType(document.mime_type),
    upsert: true
  });
  if (uploadError) throw new Error(`Could not create the canonical private Storage object: ${uploadError.message}`);

  const { data: canonicalBlob, error: verifyError } = await supabase.storage.from(bucket).download(canonicalKey);
  if (verifyError) throw new Error(`Could not verify the canonical object after upload: ${verifyError.message}`);
  if (checksum(Buffer.from(await canonicalBlob.arrayBuffer())) !== document.file_sha256.toLowerCase()) {
    throw new Error('The canonical object checksum did not verify; the document metadata was not changed.');
  }

  const { data: updated, error: updateError } = await supabase
    .from('documents_metadata')
    .update({
      storage_object_path: canonicalKey,
      vault_path: `supabase://${bucket}/${canonicalKey}`
    })
    .eq('id', documentId)
    .eq('storage_object_path', legacyKey)
    .select('id')
    .maybeSingle();

  if (updateError || !updated) {
    throw new Error(updateError
      ? `Could not update the document reference: ${updateError.message}. The verified canonical copy was retained at ${canonicalKey}.`
      : `The document reference changed during repair; no database update was made. The verified canonical copy was retained at ${canonicalKey}.`);
  }

  console.log(`Repaired document ${documentId}; its verified private Storage reference now uses the client owner's UUID.`);
  console.log(`The legacy object was retained as a recovery copy: ${legacyKey}`);
}

repairTelegramStorageReference(process.argv[2]).catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
