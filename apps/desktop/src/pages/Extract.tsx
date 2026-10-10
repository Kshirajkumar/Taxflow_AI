import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { calc } from '../lib/domain';
import { fDate, fdmy, money, num } from '../lib/format';
import type { InvoiceDoc } from '../types';

function docBase(d: InvoiceDoc) {
  return d.party.split(' ').slice(0, 2).join('_').replace(/[^A-Za-z0-9_]/g, '') + '_' + d.no.replace(/[^A-Za-z0-9]+/g, '-');
}

const FIELDS: Array<[keyof InvoiceDoc | 'date' | 'no' | 'party' | 'gstin' | 'taxable' | 'rate', string]> = [
  ['date', 'Invoice date'], ['no', 'Invoice number'], ['party', 'Party name'],
  ['gstin', 'GSTIN / Tax ID'], ['taxable', 'Taxable value'], ['rate', 'Tax rate %'],
];

export function ExtractPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const docStatus = (d: InvoiceDoc) => (d.running ? 'running' : d.status);
  const docs = s.docs.filter((d) => s.ui.ex.filter === 'all' || docStatus(d) === s.ui.ex.filter);
  const sel = s.docs.find((d) => d.id === s.ui.ex.sel) || s.docs[0];
  const cnt = (k: string) => s.docs.filter((d) => d.status === k).length;

  if (!sel) {
    return (
      <>
        <div className="ph"><div><h1>Invoice extraction</h1><p>Bills and invoices arrive from WhatsApp, email and uploads. Fields are read automatically, then checked by you.</p></div></div>
        <div className="card"><div className="card-b empty"><b>No invoices yet</b>Upload a document or receive one through WhatsApp to start extracting.</div></div>
      </>
    );
  }

  const c = s.clients.find((x) => x.id === sel.client);
  if (!c) {
    return (
      <>
        <div className="ph"><div><h1>Invoice extraction</h1><p>Bills and invoices arrive from WhatsApp, email and uploads.</p></div></div>
        <div className="card"><div className="card-b empty"><b>Client unavailable</b>This invoice is not linked to an available client.</div></div>
      </>
    );
  }

  function runExtract(id: string) {
    const d = s.docs.find((x) => x.id === id);
    if (!d || d.running || d.status !== 'queued') return;
    dispatch({ type: 'EX_RUN_START', id });
    setTimeout(() => dispatch({ type: 'EX_RUN_DONE', id }), 1300);
  }

  const k = calc(sel, c);
  const filt: Array<[string, string]> = [['all', 'All'], ['queued', 'Queued'], ['review', 'Needs review'], ['extracted', 'Extracted'], ['approved', 'Approved']];

  return (
    <>
      <div className="ph">
        <div><h1>Invoice extraction</h1><p>Bills and invoices arrive from WhatsApp, email and uploads. Fields are read automatically, then checked by you.</p></div>
        <div className="ph-a">
          <button className="btn" onClick={() => s.docs.filter((d) => d.status === 'queued').forEach((d) => runExtract(d.id))}>Extract all queued</button>
        </div>
      </div>

      <div className="grid g4">
        <div className="card kpi"><span>In queue</span><b>{cnt('queued')}</b><em>Waiting to be read</em></div>
        <div className="card kpi"><span>Needs review</span><b style={{ color: 'var(--amber)' }}>{cnt('review')}</b><em>Low-confidence fields</em></div>
        <div className="card kpi"><span>Approved</span><b style={{ color: 'var(--green)' }}>{cnt('approved')}</b><em>Saved to client folders</em></div>
        <div className="card kpi"><span>Total invoices</span><b>{s.docs.length}</b><em>This demo dataset</em></div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <h2>Invoice queue</h2>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {filt.map(([id, label]) => (
              <button key={id} className={'pill-btn' + (s.ui.ex.filter === id ? ' on' : '')} onClick={() => dispatch({ type: 'EX_FILTER', filter: id })}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 10 }}>
          <table>
            <thead><tr><th>Client</th><th>File</th><th>Type</th><th>Invoice date</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              {docs.map((d) => {
                const cl = s.clients.find((x) => x.id === d.client)!;
                const st = docStatus(d);
                return (
                  <tr key={d.id} className={'click' + (d.id === sel.id ? ' sel' : '')} onClick={() => dispatch({ type: 'EX_SELECT', id: d.id })}>
                    <td><div className="row"><span className="av" style={{ ['--t' as any]: cl.tone }}>{cl.short.slice(0, 2).toUpperCase()}</span>{cl.short}</div></td>
                    <td className="mono">{docBase(d)}</td>
                    <td><span className="chip">{d.kind}</span></td>
                    <td>{fDate(d.date)}</td>
                    <td>{money(calc(d, cl).total, cl.cur)}</td>
                    <td>
                      {st === 'running' ? <span className="chip blue"><i className="spin" />Extracting</span>
                        : st === 'queued' ? <span className="chip">Queued</span>
                        : st === 'review' ? <span className="chip amber">Needs review</span>
                        : st === 'extracted' ? <span className="chip cyan">Extracted</span>
                        : <span className="chip green">Approved</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="xgrid">
        <div className="card">
          <div className="card-h"><h2>Original bill</h2><small>{c.name}</small></div>
          <div className="card-b">
            <div className="paper">
              <div className="ph2"><b>{sel.party}</b><span>{c.cur === 'INR' ? 'GSTIN' : 'Tax ID'}: {sel.gstin}</span></div>
              <div className="tt">TAX INVOICE</div>
              <div className="meta"><span>Invoice No: {sel.no}</span><span>Date: {fdmy(sel.date)}</span></div>
              <div>Bill to: <b>{c.name}</b>, {c.city}</div>
              <table>
                <tbody>
                  <tr><td>Goods / services</td><td className="tot">1</td><td className="tot">{num(sel.taxable)}</td></tr>
                </tbody>
              </table>
              <div className="tot">Taxable value: {num(sel.taxable)}</div>
              <div className="tot">Rate: {sel.rate}%</div>
              <div className="tot" style={{ marginTop: 6, fontWeight: 700, borderTop: '2px solid #1B2437', paddingTop: 5 }}>Total: {num(k.total)}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Extracted data</h2><small>Confidence per field</small></div>
          <div className="card-b">
            {sel.status === 'queued' ? (
              <div className="empty">
                <b>Not extracted yet</b>Run extraction to read this bill.
                <div style={{ marginTop: 14 }}>
                  {sel.running ? <span className="chip blue"><i className="spin" />Extracting</span> : (
                    <button className="btn pri" onClick={() => runExtract(sel.id)}><Icon name="bolt" size={14} />Run extraction</button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {FIELDS.map(([f, label]) => {
                  const val = f === 'date' ? sel.date.toISOString().slice(0, 10) : (sel as any)[f];
                  const cf = sel.conf[f] ?? 1;
                  const low = cf < 0.8;
                  return (
                    <div key={f} className="fld">
                      <small>{label}</small>
                      <div>
                        <input
                          className="inp"
                          defaultValue={String(val)}
                          onBlur={(e) => dispatch({ type: 'EX_EDIT_FIELD', id: sel.id, field: f, value: e.target.value })}
                        />
                        <div className="conf">
                          <div className={'bar ' + (low ? 'warn' : 'ok')}><i style={{ width: cf * 100 + '%' }} /></div>
                          <span style={{ color: low ? 'var(--amber)' : 'var(--tx3)' }}>{Math.round(cf * 100)}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="calc">
                  <span className="mut">Taxable value</span><b>{money(sel.taxable, c.cur)}</b>
                  <span>Invoice total</span><b>{money(k.total, c.cur)}</b>
                </div>
                <div className="row">
                  {sel.status === 'approved' ? <span className="chip green">Approved and saved to the Extracted folder</span> : (
                    <button className="btn pri" onClick={() => dispatch({ type: 'EX_APPROVE', id: sel.id })}><Icon name="check" size={14} />Approve and save to folder</button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
