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
 *           ├── GST/2026-27/
 *           ├── IncomeTax/2026-27/
 *           ├── BankStatement/2026-27/
 *           ├── Form16/2026-27/
 *           ├── Notice/2026-27/
 *           └── General/2026-27/
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

function updateVaultBaseDir(newPath) {
  if (!fs.existsSync(newPath)) {
    fs.mkdirSync(newPath, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ vaultPath: newPath }));
  console.log(`[Vault] 🔄 Vault path updated to: ${newPath}`);
}

const ALLOWED_CATEGORIES = ['GST', 'IncomeTax', 'Form16', 'BankStatement', 'Notice', 'TDS', 'Audit', 'General', 'Generated'];
const CURRENT_AY = '2026-27';

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
 * Get or create the vault path for a client's category folder
 * Returns the absolute directory path
 */
function getClientVaultDir(clientId, category = 'General', ay = CURRENT_AY) {
  const safeId = sanitizeName(clientId);
  const safeCat = ALLOWED_CATEGORIES.includes(category) ? category : 'General';
  const safeAY = sanitizeName(ay);
  const dirPath = path.join(getVaultBaseDir(), 'clients', safeId, safeCat, safeAY);

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
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

module.exports = {
  initVault,
  getClientVaultDir,
  saveFileToVault,
  saveTextFileToVault,
  vaultFileExists,
  listClientVaultFiles,
  deleteVaultFile,
  getVaultBaseDir,
  updateVaultBaseDir,
  CURRENT_AY
};
