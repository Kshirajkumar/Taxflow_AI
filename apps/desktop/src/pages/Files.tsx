import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { MONTH_FULL } from '../data/seed';
import { fDT } from '../lib/format';
import type { VaultFile } from '../types';

function pad(n: number) { return String(n).padStart(2, '0'); }

export function FilesPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const { open, sel, q } = s.ui.fs;
  const query = q.trim().toLowerCase();
  const force = !!query;

  const selFile = s.files.find((f) => f.id === sel);
  const winPath = (f: VaultFile) => {
    const c = s.clients.find((x) => x.id === f.client)!;
    return `D:\\Taxflow\\Clients\\${c.name}\\${f.year}\\${pad(f.mo + 1)} - ${MONTH_FULL[f.mo]}\\${f.bucket}\\${f.name}`;
  };

  const rows: JSX.Element[] = [];
  s.clients.forEach((c) => {
    const fl = s.files.filter((f) => f.client === c.id && (!query || f.name.toLowerCase().includes(query) || c.name.toLowerCase().includes(query)));
    if (!fl.length) return;
    const ck = 'c:' + c.id;
    const co = force || open.has(ck);
    rows.push(
      <div key={ck} className="tr" style={{ ['--l' as any]: 0 }} onClick={() => dispatch({ type: 'FS_TOGGLE', key: ck })}>
        <span className={'caret' + (co ? ' o' : '')}><Icon name="chev" size={12} /></span>
        <span className="fold-c"><Icon name="folder" size={16} /></span>
        <span className="tl2">{c.name}</span><span className="cnt">{fl.length}</span>
      </div>
    );
    if (!co) return;
    const years = Array.from(new Set(fl.map((f) => f.year))).sort((a, b) => b - a);
    years.forEach((y) => {
      const fy = fl.filter((f) => f.year === y);
      const yk = `y:${c.id}:${y}`;
      const yo = force || open.has(yk);
      rows.push(
        <div key={yk} className="tr" style={{ ['--l' as any]: 1 }} onClick={() => dispatch({ type: 'FS_TOGGLE', key: yk })}>
          <span className={'caret' + (yo ? ' o' : '')}><Icon name="chev" size={12} /></span>
          <span className="fold-y"><Icon name="folder" size={16} /></span>
          <span className="tl2">{y}</span><span className="cnt">{fy.length}</span>
        </div>
      );
      if (!yo) return;
      const months = Array.from(new Set(fy.map((f) => f.mo))).sort((a, b) => b - a);
      months.forEach((m) => {
        const fm = fy.filter((f) => f.mo === m);
        const mk = `m:${c.id}:${y}:${m}`;
        const mo2 = force || open.has(mk);
        rows.push(
          <div key={mk} className="tr" style={{ ['--l' as any]: 2 }} onClick={() => dispatch({ type: 'FS_TOGGLE', key: mk })}>
            <span className={'caret' + (mo2 ? ' o' : '')}><Icon name="chev" size={12} /></span>
            <span className="fold-y"><Icon name="folder" size={16} /></span>
            <span className="tl2">{pad(m + 1)} - {MONTH_FULL[m]}</span><span className="cnt">{fm.length}</span>
          </div>
        );
        if (!mo2) return;
        (['Raw', 'Extracted', 'Generated'] as const).forEach((b) => {
          const fb = fm.filter((f) => f.bucket === b);
          if (!fb.length) return;
          const bk = `b:${c.id}:${y}:${m}:${b}`;
          const bo = force || open.has(bk);
          rows.push(
            <div key={bk} className="tr" style={{ ['--l' as any]: 3 }} onClick={() => dispatch({ type: 'FS_TOGGLE', key: bk })}>
              <span className={'caret' + (bo ? ' o' : '')}><Icon name="chev" size={12} /></span>
              <span className={b === 'Raw' ? 'fold-raw' : b === 'Extracted' ? 'fold-ext' : 'fold-gen'}><Icon name="folder" size={16} /></span>
              <span className="tl2">{b}</span><span className="cnt">{fb.length}</span>
            </div>
          );
          if (!bo) return;
          fb.slice().sort((a, b2) => b2.at.getTime() - a.at.getTime()).forEach((f) => {
            const ext = f.name.split('.').pop()!;
            rows.push(
              <div key={f.id} className={'tr file' + (sel === f.id ? ' sel' : '')} style={{ ['--l' as any]: 4 }} onClick={() => dispatch({ type: 'FS_SELECT', id: f.id })}>
                <span className="caret" />
                <span className={`ext-${ext}`}><Icon name={ext === 'xlsx' || ext === 'csv' ? 'table' : 'file'} size={15} /></span>
                <span className="tl2">{f.name}</span>
                <span className="cnt">{f.size >= 1000 ? (f.size / 1000).toFixed(1) + ' MB' : f.size + ' KB'}</span>
              </div>
            );
          });
        });
      });
    });
  });

  return (
    <>
      <div className="ph"><div><h1>Client folders</h1><p>Every client has its own folder, sorted by year and month, with originals kept separate from extracted data.</p></div></div>
      <div className="fgrid">
        <div className="card">
          <div className="card-h" style={{ paddingBottom: 10 }}>
            <div className="pathbar" style={{ flex: 1 }}>D:\Taxflow\Clients</div>
            <div style={{ position: 'relative', width: 220 }}>
              <input className="inp" placeholder="Search files" value={q} onChange={(e) => dispatch({ type: 'FS_QUERY', q: e.target.value })} style={{ paddingLeft: 30 }} />
              <span style={{ position: 'absolute', left: 9, top: 9, color: 'var(--tx3)' }}><Icon name="search" size={15} /></span>
            </div>
          </div>
          <div className="tree">{rows.length ? rows : <div className="empty"><b>No files found</b>Try a different search.</div>}</div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Details</h2></div>
          <div className="card-b">
            {!selFile ? <div className="empty"><b>Select a file</b>Its location and source appear here.</div> : (
              <>
                <div className="kv">
                  <span>Folder</span><b>{selFile.bucket}</b>
                  <span>Size</span><b>{selFile.size >= 1000 ? (selFile.size / 1000).toFixed(1) + ' MB' : selFile.size + ' KB'}</b>
                  <span>Modified</span><b>{fDT(selFile.at)}</b>
                  <span>Source</span><b>{selFile.src}</b>
                </div>
                <div className="pathbar">{winPath(selFile)}</div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
