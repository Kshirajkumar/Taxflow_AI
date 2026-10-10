/**
 * TaxFlow.AI — Local Vault Storage Manager
 *
 * PURPOSE: Handles all physical file operations on the local disk.
 *
 * What lives in the Vault:
 *   - Client PDFs (GST Invoices, Form 16, Bank Statements, IT Notices)
 *   - Images sent via WhatsApp (JPG/PNG of bills, receipts)
 *   - Generated documents (Notice responses, computation sheets)
 *
 * Vault folder structure:
 *   VAULT_PATH/
 *   └── clients/
 *       └── {client_id}/
 *           └── {client_name}/
 *               └── {calendar_year}/{month}/{Raw|Extracted}/
 *
 * SECURITY: The vault folder should NEVER be inside a cloud-synced folder
 * (e.g. OneDrive, Dropbox, Google Drive) to protect client data privacy.
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function getVaultBaseDir() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (config.vaultPath) return config.vaultPath;
    } catch (e) {
      console.error('[Vault] Error reading config.json:', e);
    }
  }
  return process.env.VAULT_PATH ? process.env.VAULT_PATH : path.join(__dirname, '..', '..', '..', 'vault');
}

function getVaultUsage() {
  const root = getVaultBaseDir();
  const capacityBytes = Number(process.env.VAULT_CAPACITY_GB || 500) * 1024 ** 3;
  let usedBytes = 0;
  let fileCount = 0;
  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) scan(fullPath);
        else { usedBytes += fs.statSync(fullPath).size; fileCount += 1; }
      } catch (error) {
        console.warn(`[Vault] Could not inspect ${fullPath}:`, error.message);
      }
    }
  }
  scan(root);
  return { usedBytes, capacityBytes, fileCount };
}

function updateVaultBaseDir(newPath) {
  if (!fs.existsSync(newPath)) {
    fs.mkdirSync(newPath, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ vaultPath: newPath }));
  console.log(`[Vault] 🔄 Vault path updated to: ${newPath}`);
}

const ALLOWED_CATEGORIES = ['GST', 'IncomeTax', 'Form16', 'BankStatement', 'Notice', 'TDS', 'Audit', 'General', 'Generated'];
const VAULT_BUCKETS = ['Raw', 'Extracted'];
const CURRENT_AY = '2026-27';

function getCurrentVaultPeriod(date = new Date()) {
  return {
    year: String(date.getFullYear()),
    month: new Intl.DateTimeFormat('en-US', { month: 'long' }).format(date)
  };
}

/**
 * Return the stable, human-readable root for a client. Names are sanitized
 * before they reach the filesystem; the caller must not pass raw input to
 * path.join directly.
 */
function getClientVaultRoot(clientName) {
  const safeName = sanitizeName(clientName);
  return path.join(getVaultBaseDir(), 'clients', safeName);
}

/**
 * Create the client/year/month structure immediately when a client is added.
 * mkdir with recursive=true makes this idempotent, so retries are safe.
 */
function ensureClientVaultStructure(clientName, date = new Date()) {
  if (!clientName || !String(clientName).trim()) {
    throw new Error('A client name is required to create the local vault folder.');
  }

  const { year, month } = getCurrentVaultPeriod(date);
  const clientRoot = getClientVaultRoot(clientName);
  ensureClientVaultBuckets(clientRoot, date);
  const periodDir = path.join(clientRoot, year, month);

  return { clientRoot, periodDir, year, month, buckets: VAULT_BUCKETS.slice() };
}

function ensureClientVaultBuckets(clientRoot, date = new Date()) {
  const safeRoot = path.resolve(clientRoot);
  const clientsRoot = path.resolve(getVaultBaseDir(), 'clients');
  if (!safeRoot.startsWith(`${clientsRoot}${path.sep}`)) {
    throw new Error('Refused to create folders outside the clients vault.');
  }
  const { year, month } = getCurrentVaultPeriod(date);
  const periodDir = path.join(safeRoot, year, month);
  fs.mkdirSync(periodDir, { recursive: true });
  // Materialize exactly two working folders at client creation time.
  for (const bucket of VAULT_BUCKETS) {
    fs.mkdirSync(path.join(periodDir, bucket), { recursive: true });
  }
}

/**
 * Initialize root vault directories on startup
 */
function initVault() {
  const dir = getVaultBaseDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[Vault] ✅ Root vault initialized at: ${dir}`);
  } else {
    console.log(`[Vault] ✅ Local Vault Storage active at: ${dir}`);
  }
}

/**
 * Sanitize a string to be safe for use in file/folder names
 */
function sanitizeName(name) {
  return String(name || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 64);
}

/**
 * Get or create the vault path for a client's raw or extracted bucket.
 * Document categories remain metadata only; they never become filesystem folders.
 * Returns the absolute directory path
 */
function getClientVaultDir(clientName, category = 'General', ay = CURRENT_AY) {
  const bucket = category === 'Extracted' || category === 'Generated' ? 'Extracted' : 'Raw';
  const { periodDir } = ensureClientVaultStructure(clientName);
  const dirPath = path.join(periodDir, bucket);

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/** Delete the complete client vault, never anything outside VAULT_PATH/clients. */
function deleteClientVault(clientVaultRoot) {
  const clientsRoot = path.resolve(getVaultBaseDir(), 'clients');
  const suppliedPath = String(clientVaultRoot || '');
  const clientDir = path.isAbsolute(suppliedPath)
    ? path.resolve(suppliedPath)
    : path.resolve(clientsRoot, sanitizeName(suppliedPath));
  if (!clientDir.startsWith(`${clientsRoot}${path.sep}`)) {
    throw new Error('Refused to delete a vault path outside the clients vault.');
  }
  if (!fs.existsSync(clientDir)) return false;
  fs.rmSync(clientDir, { recursive: true, force: false });
  console.log(`[Vault] Deleted client folder: ${clientDir}`);
  return true;
}

/**
 * Save a base64-encoded file to the local vault
 * Returns an object with { vaultPath, fileName, fileSizeKb }
 */
function saveFileToVault(clientId, originalFileName, fileBase64, category, ay = CURRENT_AY) {
  const ext = path.extname(originalFileName) || '.pdf';
  const safeName = sanitizeName(path.basename(originalFileName, ext));
  const uniqueName = `${Date.now()}_${safeName}${ext}`;
  const dir = getClientVaultDir(clientId, category, ay);
  const fullPath = path.join(dir, uniqueName);

  const base64Data = fileBase64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(fullPath, buffer);

  const fileSizeKb = parseFloat((buffer.length / 1024).toFixed(2));
  console.log(`[Vault] 💾 Saved: ${fullPath} (${fileSizeKb} KB)`);

  return {
    vaultPath: fullPath,
    fileName: uniqueName,
    fileSizeKb
  };
}

/**
 * Save a text/generated document (e.g. notice response draft) to the vault
 */
function saveTextFileToVault(clientId, fileName, textContent, category = 'Generated', ay = CURRENT_AY) {
  const uniqueName = `${Date.now()}_${sanitizeName(fileName)}.txt`;
  const dir = getClientVaultDir(clientId, category, ay);
  const fullPath = path.join(dir, uniqueName);
  fs.writeFileSync(fullPath, textContent, 'utf8');
  console.log(`[Vault] 📄 Saved generated doc: ${fullPath}`);
  return { vaultPath: fullPath, fileName: uniqueName };
}

/**
 * Check if a vault file exists on disk
 */
function vaultFileExists(vaultPath) {
  return vaultPath && fs.existsSync(vaultPath);
}

/**
 * Get list of all files in a client's vault category folder
 */
function listClientVaultFiles(clientId, category, ay = CURRENT_AY) {
  const dir = getClientVaultDir(clientId, category, ay);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(f => ({
    fileName: f,
    fullPath: path.join(dir, f),
    sizeKb: parseFloat((fs.statSync(path.join(dir, f)).size / 1024).toFixed(2))
  }));
}

/**
 * Return a bounded, read-only tree for the client vault. Symlinks are ignored
 * so a vault cannot expose files outside the configured root.
 */
function listClientVaultTree(clientRoot, maxEntries = 5000) {
  const root = path.resolve(clientRoot);
  const vaultClientsRoot = path.resolve(getVaultBaseDir(), 'clients');
  if (!root.startsWith(`${vaultClientsRoot}${path.sep}`)) {
    throw new Error('Refused to inspect a vault path outside the clients vault.');
  }
  if (!fs.existsSync(root)) return [];

  let count = 0;
  function walk(dir, depth = 0) {
    if (depth > 8 || count >= maxEntries) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).flatMap(entry => {
      if (count >= maxEntries || entry.isSymbolicLink()) return [];
      const fullPath = path.join(dir, entry.name);
      const stat = fs.lstatSync(fullPath);
      count += 1;
      return [{
        name: entry.name,
        type: entry.isDirectory() ? 'folder' : 'file',
        size: entry.isDirectory() ? undefined : stat.size,
        modifiedAt: stat.mtime.toISOString(),
        children: entry.isDirectory() ? walk(fullPath, depth + 1) : undefined
      }];
    });
  }
  return walk(root);
}

/**
 * Delete a file from the vault (use with caution — irreversible)
 */
function deleteVaultFile(vaultPath) {
  if (fs.existsSync(vaultPath)) {
    fs.unlinkSync(vaultPath);
    console.log(`[Vault] 🗑️  Deleted: ${vaultPath}`);
    return true;
  }
  return false;
}

/**
 * Permanently delete one regular file from a specific client vault. The
 * relative path is validated here so routes cannot remove files outside the
 * client's configured local folder.
 */
function deleteClientVaultFile(clientRoot, relativePath) {
  const root = path.resolve(clientRoot);
  const vaultClientsRoot = path.resolve(getVaultBaseDir(), 'clients');
  const requestedPath = String(relativePath || '');
  if (!requestedPath || path.isAbsolute(requestedPath)) {
    throw new Error('A valid vault file path is required.');
  }

  const target = path.resolve(root, requestedPath);
  if (!root.startsWith(`${vaultClientsRoot}${path.sep}`) || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Refused to delete a file outside the client vault.');
  }
  if (!fs.existsSync(target)) return false;

  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Only files stored directly in the local vault can be deleted.');
  }

  fs.unlinkSync(target);
  console.log(`[Vault] Deleted client file: ${target}`);
  return true;
}

module.exports = {
  initVault,
  ensureClientVaultStructure,
  ensureClientVaultBuckets,
  getClientVaultRoot,
  getClientVaultDir,
  deleteClientVault,
  saveFileToVault,
  saveTextFileToVault,
  vaultFileExists,
  listClientVaultFiles,
  listClientVaultTree,
  deleteVaultFile,
  deleteClientVaultFile,
  getVaultBaseDir,
  getVaultUsage,
  updateVaultBaseDir,
  CURRENT_AY,
  sanitizeName,
  VAULT_BUCKETS
};
