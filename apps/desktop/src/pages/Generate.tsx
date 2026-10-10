import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { calc } from '../lib/domain';
import { sum } from '../lib/format';
import { fetchFilingTypes, FilingType } from '../lib/api';

interface Output { type: string; state: 'run' | 'done'; content: string }

interface GeneratorType {
  id: string;
  name: string;
  file: string;
  desc: string;
  ext: string;
  filing: FilingType;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function generatorTypeFromFiling(filing: FilingType): GeneratorType {
  const primaryFormat = filing.output_format.toLowerCase().replace(/[^a-z0-9]/g, '') || 'file';
  return {
    id: normalize(filing.code),
    name: filing.name || filing.code,
    file: filing.code.replace(/[^a-z0-9]+/gi, '_'),
    desc: filing.description || `${filing.name || filing.code} filing output`,
    ext: primaryFormat,
    filing,
  };
}

export function GeneratePage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const c = s.clients.find((x) => x.id === s.ui.gen.client) || s.clients[0];
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [filingTypes, setFilingTypes] = useState<FilingType[]>([]);
  const [filingTypesLoading, setFilingTypesLoading] = useState(true);
  const [filingTypesError, setFilingTypesError] = useState('');
  const [filingTypesRetry, setFilingTypesRetry] = useState(0);

  useEffect(() => {
    if (!c?.countryId) {
      setFilingTypes([]);
      setFilingTypesLoading(false);
      setFilingTypesError('This client has no country configured.');
      return;
    }

    const controller = new AbortController();
    let alive = true;
    setFilingTypesLoading(true);
    setFilingTypesError('');

    fetchFilingTypes(c.countryId, controller.signal)
      .then(types => {
        if (!alive) return;
        setFilingTypes(types);
        if (!types.length) setFilingTypesError('No file types are configured for this country yet.');
      })
      .catch(error => {
        if (alive && error?.name !== 'AbortError') setFilingTypesError(error?.message || 'Could not load file types.');
      })
      .finally(() => { if (alive) setFilingTypesLoading(false); });

    return () => { alive = false; controller.abort(); };
  }, [c?.countryId, filingTypesRetry]);

  if (!c) {
    return (
      <>
        <div className="ph"><div><h1>File generator</h1><p>Pick a client and the files you need.</p></div></div>
        <div className="card"><div className="card-b empty"><b>No clients yet</b>Add a client before generating filing files.</div></div>
      </>
    );
  }

  const ds = s.docs.filter((d) => d.client === c.id && d.status !== 'queued');
  const generatorTypes = filingTypes.map(generatorTypeFromFiling);
  const availableTypeIds = new Set(generatorTypes.map(type => type.id));
  const selectedTypeIds = new Set(Array.from(s.ui.gen.types).filter(type => availableTypeIds.has(type)));
  const clientServices = c.svc.map(normalize);

  function isRecommended(type: GeneratorType) {
    const filing = type.filing;
    const values = [filing.code, filing.name, filing.filing_category || ''].map(normalize).filter(Boolean);
    return values.some(value => clientServices.includes(value));
  }

  function content(type: string) {
    const t = generatorTypes.find((g) => g.id === type);
    if (!t) return 'This filing type is no longer available for the selected client country.';
    const sales = ds.filter((d) => d.kind === 'Sales');
    const pur = ds.filter((d) => d.kind !== 'Sales');
    const normalizedType = normalize(t.filing.code);
    if (normalizedType === 'gstr1') {
      return 'Date\tType\tInvoice\tParty\tTaxable\tTax\tTotal\n' + ds.map((d) => {
        const k = calc(d, c);
        return [d.date.toDateString(), d.kind, d.no, d.party, d.taxable, k.tax, k.total].join('\t');
      }).join('\n');
    }
    if (normalizedType === 'gstr3b') {
      const tx = sum(sales, (d) => d.taxable);
      const tax = sum(sales, (d) => calc(d, c).tax);
      return JSON.stringify({ filing_type: t.filing.code, gstin: c.gstin, period: s.ui.gen.period, outward_taxable_value: tx, output_tax: tax, invoices: sales.length }, null, 2);
    }
    if (normalizedType.includes('gstr2b')) {
      return 'Supplier\tGSTIN\tInvoice\tTaxable\tStatus\n' + (pur.map((d) => [d.party, d.gstin, d.no, d.taxable, d.status === 'review' ? 'Mismatch – check' : 'Matched'].join('\t')).join('\n') || 'No purchase invoices');
    }
    return `${t.name} (${t.filing.code}) for ${c.name} — ${s.ui.gen.period}\nOutput format: ${t.filing.output_format}\nInvoices used: ${ds.length}`;
  }

  function run() {
    const ids = Array.from(selectedTypeIds);
    if (!ids.length || running) return;
    setRunning(true);
    setPreview(null);
    const init = ids.map((id) => ({ type: id, state: 'run' as const, content: '' }));
    setOutputs(init);
    ids.forEach((id, i) => {
      setTimeout(() => {
        setOutputs((prev) => prev.map((o, j) => (j === i ? { ...o, state: 'done', content: content(id) } : o)));
        if (i === ids.length - 1) setRunning(false);
      }, 500 * (i + 1));
    });
  }

  return (
    <>
      <div className="ph"><div><h1>File generator</h1><p>Pick a client and the files you need. Built from approved invoice data with fixed calculation rules.</p></div></div>
      <div className="ggrid">
        <div className="card">
          <div className="card-h"><h2>What do you need?</h2></div>
          <div className="card-b">
            <div className="mgrid">
              <div className="mrow">
                <label className="f">Client</label>
                <select className="sel" value={s.ui.gen.client} onChange={(e) => { dispatch({ type: 'GEN_CLIENT', client: e.target.value }); setOutputs([]); }}>
                  {s.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                </select>
              </div>
              <div className="mrow">
                <label className="f">Period</label>
                <select className="sel" value={s.ui.gen.period} onChange={(e) => dispatch({ type: 'GEN_PERIOD', period: e.target.value })}>
                  <option value="2026-09">September 2026</option>
                  <option value="2026-08">August 2026</option>
                </select>
              </div>
            </div>
            <div className="row" style={{ margin: '10px 0' }}><b style={{ fontSize: 12.5 }}>File types</b></div>
            {filingTypesLoading ? <div className="filing-types-skeleton" aria-label="Loading file types" aria-busy="true">
              <span className="filing-skeleton-caption">Loading latest file types</span>
              <div className="filing-skeleton-pills"><i /><i /><i /><i /><i /><i /></div>
            </div> : filingTypesError ? <div className="ob-error">{filingTypesError}<button className="btn sm gh" style={{ marginLeft: 8 }} onClick={() => setFilingTypesRetry(value => value + 1)}>Retry</button></div> : (
              <div className="gt">
                {generatorTypes.map((g) => (
                  <button key={g.id} className={'gtype' + (selectedTypeIds.has(g.id) ? ' on' : '')} onClick={() => dispatch({ type: 'GEN_TOGGLE_TYPE', id: g.id })}>
                    <span className="bx"><Icon name="check" size={11} /></span>
                    <span><b>{g.name} {isRecommended(g) && <span className="chip cyan" style={{ padding: '0 6px', fontSize: 10.5 }}>suggested</span>}</b><small>{g.desc}</small></span>
                  </button>
                ))}
              </div>
            )}
            <div className="calc" style={{ marginTop: 14 }}><span className="mut">Data used</span><b>{ds.length} extracted invoices</b></div>
            <button className="btn pri" style={{ width: '100%', justifyContent: 'center', height: 38 }} disabled={running || !selectedTypeIds.size} onClick={run}>
              {running ? <><i className="spin" />Generating</> : <><Icon name="spark" size={15} />Generate {selectedTypeIds.size} file{selectedTypeIds.size === 1 ? '' : 's'}</>}
            </button>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Generated files</h2><small>{c.short}</small></div>
          <div className="card-b">
            {!outputs.length ? <div className="empty"><b>No files yet</b>Choose types and select Generate.</div> : outputs.map((o, i) => {
              const t = generatorTypes.find((g) => g.id === o.type);
              if (!t) return null;
              return (
                <div key={o.type} className="out">
                  <div className="row">
                    <span className={`ext-${t.ext}`}><Icon name={t.ext === 'xlsx' || t.ext === 'csv' ? 'table' : 'file'} size={20} /></span>
                    <div style={{ minWidth: 0, flex: 1 }}><b>{t.name}</b><div className="mono mut">{t.file}_{s.ui.gen.period}.{t.ext}</div></div>
                    {o.state === 'done' ? <span className="chip green">Ready</span> : <span className="chip blue"><i className="spin" />Working</span>}
                  </div>
                  {o.state === 'done' && (
                    <div className="row" style={{ marginTop: 9 }}>
                      <button className="btn sm" onClick={() => setPreview(preview === i ? null : i)}><Icon name="search" size={13} />Preview</button>
                    </div>
                  )}
                  {preview === i && <pre className="code" style={{ marginTop: 10 }}>{o.content}</pre>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
