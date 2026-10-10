import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { useAppState } from '../state/store';
import { processDocumentExtraction, uploadToLocalVault, verifyDocumentExtraction } from '../lib/api';

type RunStep = 'idle' | 'uploading' | 'extracting' | 'saving' | 'done' | 'error';
const CATEGORIES = [['GST', 'GST invoice'], ['Form16', 'Form 16'], ['IncomeTax', 'Income tax'], ['BankStatement', 'Bank statement'], ['Notice', 'Tax notice'], ['General', 'Other document']];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The selected file could not be read. Please try again.'));
    reader.readAsDataURL(file);
  });
}

function prettyKey(key: string) { return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export function ExtractPage() {
  const s = useAppState();
  const inputRef = useRef<HTMLInputElement>(null);
  const [clientId, setClientId] = useState(s.clients[0]?.id || '');
  const [category, setCategory] = useState('GST');
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<RunStep>('idle');
  const [message, setMessage] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [extracted, setExtracted] = useState<Record<string, unknown> | null>(null);
  const [approved, setApproved] = useState(false);
  const client = useMemo(() => s.clients.find((item) => item.id === clientId), [clientId, s.clients]);
  const isBusy = step === 'uploading' || step === 'extracting' || step === 'saving';
  const resultEntries = extracted ? Object.entries(extracted).filter(([, value]) => value !== null && value !== '') : [];

  useEffect(() => { if (!clientId && s.clients[0]) setClientId(s.clients[0].id); }, [clientId, s.clients]);

  function chooseFile(nextFile?: File) {
    const selected = nextFile || inputRef.current?.files?.[0];
    if (!selected) return;
    if (selected.size > 25 * 1024 * 1024) { setMessage('Files must be smaller than 25 MB.'); setStep('error'); return; }
    setFile(selected); setMessage(''); setStep('idle'); setExtracted(null); setApproved(false);
  }

  async function startExtraction() {
    if (!client || !file || isBusy) return;
    setMessage(''); setExtracted(null); setApproved(false);
    try {
      setStep('uploading');
      const upload = await uploadToLocalVault({ clientId: client.id, clientName: client.name, fileName: file.name, fileType: file.type.split('/')[1]?.toUpperCase() || file.name.split('.').pop()?.toUpperCase() || 'PDF', category, fileBase64: await fileToBase64(file), source: 'Upload' });
      const id = upload.data?.id;
      if (!id) throw new Error('The file was saved, but no document ID was returned for extraction.');
      setDocumentId(id); setStep('extracting');
      const result = await processDocumentExtraction(id, category);
      setStep('saving');
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      setExtracted(result.data?.extracted_data || { summary: result.message || 'Extraction completed.' });
      setMessage(upload.warning || 'Structured data saved to the client Extracted folder. Review the highlighted fields before approval.');
      setStep('done');
    } catch (error) { setStep('error'); setMessage(error instanceof Error ? error.message : 'Something went wrong while processing this file.'); }
  }

  async function approveExtraction() {
    if (!documentId || approved) return;
    const response = await verifyDocumentExtraction(documentId, s.currentUser?.name || 'CA Admin');
    if (!response?.success) { setMessage('Approval could not be saved. Please retry while keeping this review open.'); return; }
    setApproved(true);
    setMessage('Approved extraction saved to the client record.');
  }

  return <div className="extract-workspace">
    <div className="ph extract-header"><div><div className="eyebrow"><span className="eyebrow-dot" />AI DOCUMENT WORKSPACE</div><h1>Extract with confidence</h1><p>Upload a document, choose its client, and let the secure server-side AI pipeline structure the data for you.</p></div><div className="extract-header-status"><span className="status-pulse" />Vault &amp; AI ready</div></div>
    <div className="extract-layout">
      <section className="card extract-setup"><div className="card-h"><div><span className="section-kicker">01 / SOURCE</span><h2>Set up extraction</h2></div><span className="chip cyan"><Icon name="spark" size={12} />AI assisted</span></div><div className="card-b">
        <label className="extract-label">Client</label><div className="extract-select-wrap"><Icon name="users" size={15} /><select className="sel" value={clientId} onChange={(event) => setClientId(event.target.value)} disabled={isBusy}><option value="">Select a client</option>{s.clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <label className="extract-label">Document type</label><div className="category-grid">{CATEGORIES.map(([value, label]) => <button key={value} className={'category-choice' + (category === value ? ' selected' : '')} onClick={() => setCategory(value)} disabled={isBusy}><span>{label}</span><small>{value === 'GST' ? 'Invoice fields' : 'Structured fields'}</small>{category === value && <Icon name="check" size={13} />}</button>)}</div>
        <div className="upload-dropzone" onClick={() => !isBusy && inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]); }}><input ref={inputRef} className="vault-file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.doc,.docx" onChange={() => chooseFile()} /><div className="upload-icon"><Icon name="upload" size={20} /></div>{file ? <><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(2)} MB · Ready to upload</small></> : <><b>Drop a file here</b><small>or click to open file explorer · PDF, image, or document</small></>}</div>
        <div className="extract-security"><Icon name="check" size={14} /><span>Files stay in the selected client’s private <b>Raw</b> vault until processing is complete.</span></div><button className="btn pri extract-cta" disabled={!client || !file || isBusy} onClick={() => void startExtraction()}><Icon name={isBusy ? 'refresh' : 'spark'} size={15} className={isBusy ? 'ic spin' : 'ic'} />{isBusy ? 'Processing securely…' : 'Upload &amp; extract'}</button>{message && <div className={'extract-message ' + (step === 'error' ? 'error' : step === 'done' ? 'success' : 'warning')}><Icon name={step === 'error' ? 'x' : step === 'done' ? 'check' : 'clock'} size={14} /><span>{message}</span></div>}
      </div></section>
      <section className="card extract-progress-card"><div className="card-h"><div><span className="section-kicker">02 / PIPELINE</span><h2>Processing timeline</h2></div><span className="mono extract-doc-id">{documentId ? documentId.slice(0, 14) : 'WAITING'}</span></div><div className="card-b"><div className="pipeline-intro"><div className="pipeline-orb"><Icon name="spark" size={22} /></div><div><b>{step === 'done' ? 'Extraction complete' : step === 'error' ? 'Needs attention' : isBusy ? 'Your document is being prepared' : 'Ready when you are'}</b><small>{step === 'done' ? 'Your structured result is open on the right.' : 'Every step is handled by the secure backend.'}</small></div></div><div className="pipeline-steps">{[['uploading', 'Save to Raw vault', 'Original file secured'], ['extracting', 'AI extraction', 'Server-side vision model'], ['saving', 'Save structured result', 'Written to Extracted folder']].map(([id, title, sub], index) => { const active = step === id; const complete = step === 'done' || (step === 'saving' && index < 2) || (step === 'extracting' && index === 0); return <div className={'pipeline-step ' + (active ? 'active' : '') + (complete ? 'complete' : '')} key={id}><div className="pipeline-marker">{complete ? <Icon name="check" size={13} /> : <span>{index + 1}</span>}</div><div><b>{title}</b><small>{sub}</small></div>{active && <i className="spin" />}</div>; })}</div><div className="pipeline-note"><Icon name="bolt" size={14} /><span>Short, structured instructions are applied automatically for consistent tax data.</span></div></div></section>
      <section className="card extract-result-card"><div className="card-h"><div><span className="section-kicker">03 / REVIEW</span><h2>Extracted data</h2></div><span className={'chip ' + (approved ? 'green' : 'amber')}>{approved ? <><Icon name="check" size={12} />Approved</> : <><span className="warning-dot" />Review required</>}</span></div><div className="card-b">{!extracted ? <div className="result-empty"><div className="result-empty-icon"><Icon name="table" size={22} /></div><b>Your structured result will appear here</b><span>Review the AI fields before you approve and use them in a filing.</span></div> : <><div className="result-file-bar"><div className="file-mark"><Icon name="file" size={15} /></div><div><b>{file?.name}</b><small>{client?.name} · {category} · AI extracted</small></div><span className={'chip ' + (approved ? 'green' : 'amber')}>{approved ? 'Approved' : 'Review required'}</span></div><div className="extracted-fields">{resultEntries.map(([key, value]) => <div className="extracted-field" key={key}><small>{prettyKey(key)}</small><strong>{Array.isArray(value) ? `${value.length} items` : typeof value === 'object' ? JSON.stringify(value) : String(value)}</strong><span className="confidence-line"><i /><em>AI field</em></span></div>)}</div><div className="result-actions"><button className="btn gh" onClick={() => setExtracted(null)}>Discard</button><button className="btn pri" disabled={approved} onClick={() => void approveExtraction()}><Icon name="check" size={14} />{approved ? 'Approved & saved' : 'Review & approve'}</button></div></>}</div></section>
    </div>
  </div>;
}
