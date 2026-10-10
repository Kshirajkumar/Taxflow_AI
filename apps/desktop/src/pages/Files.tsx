import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Icon } from '../components/Icon';
import { useAppState } from '../state/store';
import { deleteVaultFile, fetchVaultTree, uploadToLocalVault, type VaultTreeEntry } from '../lib/api';
import { fDT } from '../lib/format';

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function extension(name: string) { return name.split('.').pop()?.toLowerCase() || 'file'; }
function fileClass(name: string) { return `vault-file-icon ext-${extension(name)}`; }
function folderPaths(entries: VaultTreeEntry[], prefix = ''): string[] {
  return entries.flatMap(entry => {
    const path = `${prefix}/${entry.name}`;
    return entry.type === 'folder' ? [path, ...folderPaths(entry.children || [], path)] : [];
  });
}

function findEntryAtPath(entries: VaultTreeEntry[], target: string, prefix = ''): VaultTreeEntry | null {
  for (const entry of entries) {
    const path = `${prefix}/${entry.name}`;
    if (path === target) return entry;
    if (entry.type === 'folder') {
      const match = findEntryAtPath(entry.children || [], target, path);
      if (match) return match;
    }
  }
  return null;
}

function addFileToFolder(entries: VaultTreeEntry[], target: string, file: VaultTreeEntry, prefix = ''): VaultTreeEntry[] {
  return entries.map(entry => {
    const path = `${prefix}/${entry.name}`;
    if (path === target && entry.type === 'folder') {
      return { ...entry, children: [...(entry.children || []), file] };
    }
    return entry.type === 'folder'
      ? { ...entry, children: addFileToFolder(entry.children || [], target, file, path) }
      : entry;
  });
}

function fileTypeLabel(name: string) {
  const ext = extension(name).toUpperCase();
  return ext === 'XLSX' || ext === 'CSV' ? 'Spreadsheet' : `${ext} document`;
}

function countChildren(entry: VaultTreeEntry) {
  const children = entry.children || [];
  return {
    folders: children.filter(child => child.type === 'folder').length,
    files: children.filter(child => child.type === 'file').length,
  };
}

function FileCard({ item, onOpen, onDelete }: { item: VaultTreeEntry; onOpen: () => void; onDelete: () => void }) {
  return <div className="vault-file-card">
    <button className="vault-file-card-main" onClick={onOpen} title={`Open ${item.name}`}>
      <span className={fileClass(item.name) + ' vault-file-card-icon'}><Icon name={extension(item.name) === 'xlsx' || extension(item.name) === 'csv' ? 'table' : 'file'} size={22} /></span>
      <span className="vault-file-card-body"><b>{item.name}</b><small>{fileTypeLabel(item.name)}</small></span>
      <span className="vault-file-card-meta"><span>{formatBytes(item.size)}</span><span>{fDT(new Date(item.modifiedAt))}</span></span>
    </button>
    <button className="vault-file-delete" onClick={onDelete} title={`Delete ${item.name}`} aria-label={`Delete ${item.name}`}><Icon name="trash" size={15} /></button>
  </div>;
}

function TreeNode({ entry, depth, path, expanded, selectedPath, toggle, select }: {
  entry: VaultTreeEntry; depth: number; path: string; expanded: Set<string>; selectedPath: string;
  toggle: (path: string) => void; select: (entry: VaultTreeEntry, path: string) => void;
}) {
  const folder = entry.type === 'folder';
  const open = expanded.has(path);
  const counts = folder ? countChildren(entry) : null;
  return <div className="vault-node-wrap">
    <button className={`vault-node ${selectedPath === path ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => { select(entry, path); if (folder) toggle(path); }} title={entry.name}>
      <span className={`vault-caret ${open ? 'open' : ''}`}>{folder && <Icon name="chev" size={11} />}</span>
      <span className={folder ? 'vault-folder-icon' : fileClass(entry.name)}><Icon name={folder ? 'folder' : 'file'} size={14} /></span>
      <span className="vault-node-name">{entry.name}</span>
      {folder && <span className="vault-node-count" aria-label={`${counts?.folders || 0} folders, ${counts?.files || 0} files`}>
        <span className="vault-count-folder"><Icon name="folder" size={11} />{counts?.folders || 0}</span>
        <span className="vault-count-file"><Icon name="file" size={11} />{counts?.files || 0}</span>
      </span>}
    </button>
    {folder && open && (entry.children || []).map(child => <TreeNode key={`${path}/${child.name}`} entry={child} depth={depth + 1} path={`${path}/${child.name}`} expanded={expanded} selectedPath={selectedPath} toggle={toggle} select={select} />)}
  </div>;
}

export function FilesPage() {
  const s = useAppState();
  const [clientId, setClientId] = useState(s.clients[0]?.id || '');
  const [entries, setEntries] = useState<VaultTreeEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ entry: VaultTreeEntry; path: string } | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fallback, setFallback] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadMessageKind, setUploadMessageKind] = useState<'success' | 'warning' | 'error' | ''>('');
  const [pendingDelete, setPendingDelete] = useState<{ entry: VaultTreeEntry; path: string } | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const client = s.clients.find(item => item.id === clientId) || s.clients[0];

  const fallbackTree = useMemo<VaultTreeEntry[]>(() => {
    if (!client) return [];
    const years = new Map<string, VaultTreeEntry>();
    const now = new Date();
    const currentYear = String(now.getFullYear());
    const currentMonth = `${String(now.getMonth() + 1).padStart(2, '0')} - ${new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now)}`;
    const currentYearNode: VaultTreeEntry = { name: currentYear, type: 'folder', modifiedAt: now.toISOString(), children: [] };
    const currentMonthNode: VaultTreeEntry = { name: currentMonth, type: 'folder', modifiedAt: now.toISOString(), children: [
      { name: 'Raw', type: 'folder', modifiedAt: now.toISOString(), children: [] },
      { name: 'Extracted', type: 'folder', modifiedAt: now.toISOString(), children: [] },
    ] };
    currentYearNode.children?.push(currentMonthNode);
    years.set(currentYear, currentYearNode);
    s.files.filter(file => file.client === client.id).forEach(file => {
      const yearName = String(file.year);
      const monthName = `${String(file.mo + 1).padStart(2, '0')} - ${new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(2020, file.mo, 1))}`;
      const year = years.get(yearName) || { name: yearName, type: 'folder', modifiedAt: new Date().toISOString(), children: [] };
      const month = (year.children || []).find(item => item.name === monthName) || { name: monthName, type: 'folder', modifiedAt: new Date().toISOString(), children: [] };
      if (!year.children?.includes(month)) year.children?.push(month);
      const bucketName = file.bucket === 'Extracted' || file.bucket === 'Generated' ? 'Extracted' : 'Raw';
      const bucket = (month.children || []).find(item => item.name === bucketName) || { name: bucketName, type: 'folder', modifiedAt: new Date().toISOString(), children: [] };
      if (!month.children?.includes(bucket)) month.children?.push(bucket);
      bucket.children?.push({ name: file.name, type: 'file', size: file.size * 1024, modifiedAt: file.at.toISOString() });
      years.set(yearName, year);
    });
    return Array.from(years.values());
  }, [client, s.files]);

  function addRoot(items: VaultTreeEntry[]) { return client ? [{ name: client.name, type: 'folder' as const, modifiedAt: new Date().toISOString(), children: items }] : items; }

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true); setError('');
    fetchVaultTree(clientId).then(result => {
      if (cancelled) return;
      const tree = addRoot(result.entries || []);
      setEntries(tree); setFallback(false); setExpanded(new Set(folderPaths(tree)));
      if (selected?.path) {
        const refreshedSelection = findEntryAtPath(tree, selected.path);
        setSelected(refreshedSelection ? { entry: refreshedSelection, path: selected.path } : null);
      }
    }).catch(err => {
      if (cancelled) return;
      const tree = addRoot(fallbackTree);
      setEntries(tree); setFallback(true); setExpanded(new Set(folderPaths(tree)));
      if (selected?.path) {
        const refreshedSelection = findEntryAtPath(tree, selected.path);
        setSelected(refreshedSelection ? { entry: refreshedSelection, path: selected.path } : null);
      }
      setError(err.message || 'The local vault could not be read. Showing indexed document data.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (fallback && !loading) { const tree = addRoot(fallbackTree); setEntries(tree); setExpanded(new Set(folderPaths(tree))); } }, [fallbackTree, fallback, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleEntries = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return entries;
    const filter = (items: VaultTreeEntry[]): VaultTreeEntry[] => items.flatMap(item => {
      if (item.type === 'file') return item.name.toLowerCase().includes(term) ? [item] : [];
      const children = filter(item.children || []);
      return item.name.toLowerCase().includes(term) || children.length ? [{ ...item, children }] : [];
    });
    return filter(entries);
  }, [entries, query]);

  const currentSelectedEntry = selected ? findEntryAtPath(entries, selected.path) : null;
  const selectedFolderEntry = currentSelectedEntry?.type === 'folder'
    ? currentSelectedEntry
    : selected?.entry.type === 'folder' ? selected.entry : null;
  const selectedChildren = selectedFolderEntry?.children || [];
  const folderCount = selectedChildren.filter(item => item.type === 'folder').length;
  const fileCount = selectedChildren.filter(item => item.type === 'file').length;
  const pathLabel = selected?.path || `/${client?.name || 'Client folder'}`;
  const selectedFolderName = selected?.entry.type === 'folder' ? selected.entry.name : '';
  const uploadCategory = selectedFolderName === 'Extracted' ? 'Extracted' : selectedFolderName === 'Raw' ? 'General' : '';
  const canUpload = Boolean(client && uploadCategory && !uploading);

  function toggle(path: string) { setExpanded(previous => { const next = new Set(previous); next.has(path) ? next.delete(path) : next.add(path); return next; }); }

  function removeFileAtPath(items: VaultTreeEntry[], target: string, prefix = ''): VaultTreeEntry[] {
    return items.flatMap(item => {
      const path = `${prefix}/${item.name}`;
      if (path === target) return [];
      return item.type === 'folder' ? [{ ...item, children: removeFileAtPath(item.children || [], target, path) }] : [item];
    });
  }

  function toBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('The selected file could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadSelectedFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !client || !uploadCategory) return;

    const extensionName = extension(file.name).toUpperCase();
    const supportedTypes = new Set(['PDF', 'PNG', 'JPG', 'JPEG', 'XLSX', 'CSV']);
    if (!supportedTypes.has(extensionName)) {
      setUploadMessageKind('error');
      setUploadMessage(`Unsupported file type: .${extension(file.name)}. Use PDF, image, XLSX, or CSV.`);
      return;
    }

    setUploading(true);
    setUploadMessage('');
    setUploadMessageKind('');
    try {
      const result = await uploadToLocalVault({
        clientId: client.id,
        clientName: client.name,
        fileName: file.name,
        fileType: extensionName,
        category: uploadCategory,
        fileBase64: await toBase64(file),
        source: 'Manual',
      });
      const savedName = result.data?.fileName || (result.data as any)?.file_name || file.name;
      const savedSize = Number(result.data?.fileSize || (result.data as any)?.file_size_kb || file.size);
      const savedAt = (result.data as any)?.created_at || new Date().toISOString();
      const uploadedEntry: VaultTreeEntry = { name: savedName, type: 'file', size: savedSize * (savedSize < 1024 ? 1024 : 1), modifiedAt: savedAt };
      const selectedPath = selected?.path;
      if (selectedPath) {
        setEntries(previous => addFileToFolder(previous, selectedPath, uploadedEntry));
        setSelected(previous => previous && previous.path === selectedPath
          ? { ...previous, entry: { ...previous.entry, children: [...(previous.entry.children || []), uploadedEntry] } }
          : previous);
      }
      setUploadMessageKind(result.warning ? 'warning' : 'success');
      setUploadMessage(result.warning || `${file.name} uploaded successfully.`);
      setRefresh(value => value + 1);
    } catch (err) {
      setUploadMessageKind('error');
      setUploadMessage(err instanceof Error ? err.message : 'The file could not be uploaded.');
    } finally {
      setUploading(false);
    }
  }

  async function permanentlyDeleteFile() {
    if (!client || !pendingDelete) return;
    const rootPrefix = `/${client.name}/`;
    const relativePath = pendingDelete.path.startsWith(rootPrefix) ? pendingDelete.path.slice(rootPrefix.length) : '';
    if (!relativePath) {
      setDeleteError('This file path could not be verified. Nothing was deleted.');
      return;
    }

    setDeletingFile(true);
    setDeleteError('');
    try {
      await deleteVaultFile(client.id, relativePath);
      setEntries(previous => removeFileAtPath(previous, pendingDelete.path));
      if (selected?.path === pendingDelete.path) setSelected(null);
      setPendingDelete(null);
      setUploadMessageKind('success');
      setUploadMessage(`${pendingDelete.entry.name} was permanently deleted from the local vault.`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'The file could not be deleted.');
    } finally {
      setDeletingFile(false);
    }
  }

  return <div className="vault-page">
    <div className="ph vault-page-head"><div><div className="eyebrow">LOCAL VAULT</div><h1>Client folders</h1><p>Browse the selected client folder and inspect its local documents.</p></div><div className="vault-health"><span className={`health-dot ${error ? 'warn' : 'ok'}`} /><span>{error ? 'Limited access' : 'Vault ready'}</span></div></div>
    <div className="vault-toolbar"><div className={`vault-client-select ${clientMenuOpen ? 'menu-open' : ''}`} title="Select client" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setClientMenuOpen(false); }}><button className="vault-client-name" onClick={() => s.clients.length && setClientMenuOpen(value => !value)} disabled={!s.clients.length} aria-haspopup="listbox" aria-expanded={clientMenuOpen}>{client?.name || 'No clients'}</button><span className="vault-client-arrow" aria-hidden="true" />{clientMenuOpen && s.clients.length > 0 && <div className="vault-client-menu" role="listbox">{s.clients.map(item => <button key={item.id} className={`vault-client-option ${item.id === client?.id ? 'active' : ''}`} role="option" aria-selected={item.id === client?.id} onClick={() => { setClientId(item.id); setSelected(null); setUploadMessage(''); setClientMenuOpen(false); }}>{item.name}{item.id === client?.id && <Icon name="check" size={13} />}</button>)}</div>}</div><div className="vault-path-label"><Icon name="folder" size={15} /><span>{pathLabel}</span></div><label className="vault-search"><Icon name="search" size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search this vault" aria-label="Search this vault" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><Icon name="x" size={13} /></button>}</label></div>
    <div className="vault-two-pane">
      <section className="vault-tree-panel card"><div className="vault-panel-head"><div><span className="eyebrow">FOLDER TREE</span><h2>{client?.name || 'No client selected'}</h2></div><button className="btn ghost" onClick={() => setRefresh(value => value + 1)} disabled={loading || !clientId}><Icon name="refresh" size={14} />Refresh</button></div>{error && <div className="vault-notice"><Icon name="bell" size={15} /><span>{error}</span></div>}<div className="vault-tree-scroll">{loading ? <div className="vault-loading"><span className="spin" /><span>Reading vault…</span></div> : visibleEntries.length ? visibleEntries.map(entry => <TreeNode key={entry.name} entry={entry} depth={0} path={`/${entry.name}`} expanded={expanded} selectedPath={selected?.path || ''} toggle={toggle} select={(entry, path) => setSelected({ entry, path })} />) : <div className="vault-empty"><span className="vault-empty-icon"><Icon name="folder" size={22} /></span><b>{query ? 'No matching items' : 'This vault is empty'}</b><span>{query ? 'Try a different search.' : 'Files will appear here when added.'}</span></div>}</div></section>
      <section className="vault-contents-panel card"><div className="vault-panel-head"><div><span className="eyebrow">SELECTED FOLDER</span><h2>{selected?.entry.name || client?.name || 'Folder contents'}</h2><small>{selected?.entry.type === 'folder' ? `${folderCount} folder${folderCount === 1 ? '' : 's'} · ${fileCount} file${fileCount === 1 ? '' : 's'}` : 'Select a folder in the tree'}</small></div><div className="vault-upload-action"><input ref={fileInputRef} type="file" className="vault-file-input" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv" onChange={uploadSelectedFile} /><button className="btn pri" onClick={() => fileInputRef.current?.click()} disabled={!canUpload} title={uploadCategory ? `Upload to ${selectedFolderName}` : 'Select the Raw or Extracted folder first'}><Icon name="upload" size={14} />{uploading ? 'Uploading…' : 'Upload file'}</button></div></div>{uploading && <div className="vault-uploading-state"><span className="vault-upload-orbit"><Icon name="upload" size={17} /></span><div><b>Uploading securely to {selectedFolderName}</b><small>Saving the file to the Local Vault and refreshing this folder…</small></div></div>}{uploadMessage && <div className={`vault-upload-message ${uploadMessageKind}`}><Icon name={uploadMessageKind === 'success' ? 'check' : uploadMessageKind === 'error' ? 'x' : 'bell'} size={14} /><span>{uploadMessage}</span></div>}{selected?.entry.type === 'file' ? <div className="vault-file-preview"><div className={fileClass(selected.entry.name)}><Icon name="file" size={28} /></div><h3>{selected.entry.name}</h3><div className="vault-detail-path">{selected.path}</div><div className="kv"><span>Type</span><b>{extension(selected.entry.name).toUpperCase()} file</b><span>Size</span><b>{formatBytes(selected.entry.size)}</b><span>Modified</span><b>{fDT(new Date(selected.entry.modifiedAt))}</b></div></div> : selected ? <div className="vault-contents"><div className="vault-current-path"><Icon name="folder" size={15} /><span>{selected.path}</span></div>{selectedChildren.length ? <div className="vault-file-grid">{selectedChildren.map(item => item.type === 'folder' ? <button className="vault-folder-card" key={item.name} onClick={() => setSelected({ entry: item, path: `${selected.path}/${item.name}` })}><span className="vault-folder-card-icon"><Icon name="folder" size={22} /></span><span><b>{item.name}</b><small>{item.children?.length || 0} items</small></span><Icon name="chev" size={14} /></button> : <FileCard key={item.name} item={item} onOpen={() => setSelected({ entry: item, path: `${selected.path}/${item.name}` })} onDelete={() => { setDeleteError(''); setPendingDelete({ entry: item, path: `${selected.path}/${item.name}` }); }} />)}</div> : <div className="vault-empty"><span className="vault-empty-icon"><Icon name="folder" size={22} /></span><b>This folder is empty</b><span>Files added to this folder will appear here.</span></div>}</div> : <div className="vault-overview"><div className="vault-overview-icon"><Icon name="folder" size={28}></Icon></div><b>Select a folder</b><span>Choose a folder from the tree to view everything inside it.</span></div>}</section>
    </div>
    {pendingDelete && <div className="modal delete-confirm-modal vault-delete-modal" onMouseDown={event => { if (event.target === event.currentTarget && !deletingFile) setPendingDelete(null); }}><div className="card delete-confirm-card vault-delete-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-vault-file-title"><div className="delete-confirm-icon"><Icon name="trash" size={22} /></div><span className="eyebrow">Permanent deletion</span><h2 id="delete-vault-file-title">Delete this file?</h2><p><strong>{pendingDelete.entry.name}</strong> will be permanently removed from your local vault folder. This cannot be undone.</p>{deleteError && <div className="ob-error">{deleteError}</div>}<div className="delete-confirm-actions"><button className="btn gh" disabled={deletingFile} onClick={() => setPendingDelete(null)}>Keep file</button><button className="btn danger" disabled={deletingFile} onClick={permanentlyDeleteFile}>{deletingFile ? <><i className="spin" />Deleting</> : <><Icon name="trash" size={14} />Delete permanently</>}</button></div></div></div>}
  </div>;
}
