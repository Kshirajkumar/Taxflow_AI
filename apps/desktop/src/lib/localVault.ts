import { invoke, isTauri } from '@tauri-apps/api/core';

export interface LocalVaultStatus {
  vaultPath: string;
  deviceId: string;
}

export interface PendingLocalDocument {
  id: string;
  clientName: string;
  fileName: string;
  sha256: string;
  year: string;
  month: string;
}

export function isDesktopApp(): boolean {
  return isTauri();
}

export async function getLocalVaultStatus(): Promise<LocalVaultStatus | null> {
  return invoke<LocalVaultStatus | null>('get_local_vault_status');
}

export async function configureLocalVault(vaultPath: string): Promise<LocalVaultStatus> {
  return invoke<LocalVaultStatus>('configure_local_vault', { vaultPath });
}

export async function saveSyncedDocument(
  document: PendingLocalDocument,
  content: ArrayBuffer,
): Promise<void> {
  const chunkSize = 512 * 1024;
  for (let offset = 0; offset < content.byteLength; offset += chunkSize) {
    const length = Math.min(chunkSize, content.byteLength - offset);
    const chunk = Array.from(new Uint8Array(content, offset, length));
    await invoke<string | null>('save_synced_document_chunk', {
      documentId: document.id,
      clientName: document.clientName,
      year: document.year,
      month: document.month,
      fileName: document.fileName,
      offset,
      totalSize: content.byteLength,
      bytes: chunk,
      expectedSha256: document.sha256,
    });
  }
}
