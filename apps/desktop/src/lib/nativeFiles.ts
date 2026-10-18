import { invoke, isTauri } from '@tauri-apps/api/core';

const MAX_NATIVE_OPEN_BYTES = 100 * 1024 * 1024;

export function supportsNativeFileOpen() {
  return isTauri();
}

export async function openWithDefaultApp(file: Blob, fileName: string): Promise<boolean> {
  if (!isTauri()) return false;
  if (!file.size) throw new Error('This file is empty and cannot be opened.');
  if (file.size > MAX_NATIVE_OPEN_BYTES) {
    throw new Error('Files larger than 100 MB cannot be opened through TaxFlow. Download the file and open it manually.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  await invoke('open_file_with_default_app', { fileName, bytes });
  return true;
}
