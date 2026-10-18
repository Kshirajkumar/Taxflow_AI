const crypto = require('node:crypto');
const { supabase } = require('../db/supabase');

function getStorageBucket() {
  return String(process.env.SUPABASE_STORAGE_BUCKET || '').trim();
}

function isCloudDocumentStorageEnabled() {
  return Boolean(supabase && getStorageBucket());
}

function getStorageObjectKey({ userId, clientId, year, month, documentId, fileName }) {
  const safeName = sanitizeStorageFileName(fileName);
  return `${userId}/${clientId}/${year}/${month}/${documentId}_${safeName}`;
}

function getMetadataStorageObjectKey({ userId, clientId, createdAt, fileName }) {
  const date = new Date(createdAt);
  if (!userId || !clientId || Number.isNaN(date.getTime())) {
    throw new Error('The cloud document ownership or date metadata is invalid.');
  }
  const year = String(date.getFullYear());
  const month = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(date);
  return `${userId}/${clientId}/${year}/${month}/${sanitizeStorageFileName(fileName)}`;
}

function isExpectedTelegramObject({ bucket, objectKey, userId, clientId, createdAt, fileName }) {
  try {
    return Boolean(
      getStorageBucket()
      && bucket === getStorageBucket()
      && objectKey === getMetadataStorageObjectKey({ userId, clientId, createdAt, fileName })
    );
  } catch {
    return false;
  }
}

function sanitizeStorageFileName(fileName) {
  return String(fileName || 'document').replace(/[\\/]/g, '_').replace(/[^\w.\- ]/g, '_');
}

function isCloudDocumentStorageRequired() {
  return process.env.NODE_ENV === 'production'
    || Boolean(process.env.PUBLIC_URL)
    || Boolean(process.env.RENDER_EXTERNAL_URL);
}

function normalizeMimeType(value) {
  const mimeType = String(value || '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)
    ? mimeType
    : 'application/octet-stream';
}

async function uploadDocument(objectKey, buffer, contentType) {
  const bucket = getStorageBucket();
  if (!supabase || !bucket) throw new Error('Supabase Storage is not configured.');

  const { error } = await supabase.storage.from(bucket).upload(objectKey, buffer, {
    contentType: normalizeMimeType(contentType),
    upsert: true
  });
  if (error) throw error;
  return { bucket, objectKey };
}

async function downloadDocument(bucket, objectKey) {
  if (!supabase) throw new Error('Supabase Storage is not configured.');
  const { data, error } = await supabase.storage.from(bucket).download(objectKey);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  downloadDocument,
  getStorageBucket,
  getMetadataStorageObjectKey,
  getStorageObjectKey,
  isCloudDocumentStorageEnabled,
  isCloudDocumentStorageRequired,
  isExpectedTelegramObject,
  normalizeMimeType,
  sha256,
  uploadDocument
};
