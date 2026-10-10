import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { fetchDocumentPreview, verifyDocumentExtraction } from '../lib/api';

function labelFor(key: string) { return key.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
function printable(value: unknown) { return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? ''); }

export function ExtractionReviewPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const review = s.ui.review || { documentId: '', clientId: '', fileName: '', category: '', extractedData: {} };
  const [fields, setFields] = useState<Record<string, unknown>>(review.extractedData || {});
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewType, setPreviewType] = useState('');
  const [loadingFile, setLoadingFile] = useState(true);
  const [fileError, setFileError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [approved, setApproved] = useState(false);
  const client = s.clients.find(item => item.id === review.clientId);
  const entries = useMemo(() => Object.entries(fields), [fields]);

  useEffect(() => {
    setFields(review.extractedData || {});
    setApproved(false);
    setLoadingFile(true); setFileError('');
    if (!review.documentId) { setLoadingFile(false); setFileError('No extraction document was selected.'); return; }
    const controller = new AbortController();
    let objectUrl = '';
    fetchDocumentPreview(review.documentId, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setPreviewUrl(objectUrl); setPreviewType(blob.type || 'application/octet-stream');
    }).catch(error => { if (error?.name !== 'AbortError') setFileError(error?.message || 'The original file could not be opened.'); })
      .finally(() => { if (!controller.signal.aborted) setLoadingFile(false); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [review.documentId]);

  function updateField(key: string, value: string) { setFields(previous => ({ ...previous, [key]: value })); setApproved(false); }

  async function approve() {
    if (!review.documentId || saving || approved) return;
    setSaving(true); setMessage('');
    try {
      const response = await verifyDocumentExtraction(review.documentId, s.currentUser?.name || 'CA Admin', fields);
      if (!response?.success) throw new Error('The reviewed extraction could not be saved.');
      setApproved(true); setMessage('Approved data saved to the client record.');
      dispatch({ type: 'CLEAR_EXTRACTION_REVIEW' });
      dispatch({ type: 'GO', page: 'extract' });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Approval failed. Please try again.'); }
    finally { setSaving(false); }
  }

  if (!review.documentId) {
    return <div className="review-page"><div className="ph review-header"><div><div className="eyebrow review-eyebrow"><span className="review-orange-dot" />QUALITY CONTROL · AI EXTRACTION</div><h1>AI Data Extraction Review</h1><p>Open a completed extraction from the Extraction page to begin review.</p></div><button className="btn pri" onClick={() => { dispatch({ type: 'CLEAR_EXTRACTION_REVIEW' }); dispatch({ type: 'GO', page: 'extract' }); }}><Icon name="scan" size={14} />Open Extraction</button></div><div className="card review-empty review-empty-card"><Icon name="table" size={24} /><b>No extraction is waiting for review</b><span>Run AI extraction first, then choose Review &amp; approve to open its editable data beside the original file.</span></div></div>;
  }

  return <div className="review-page">
    <div className="ph review-header"><div><div className="eyebrow review-eyebrow"><span className="review-orange-dot" />QUALITY CONTROL · AI EXTRACTION</div><h1>AI Data Extraction Review</h1><p>Verify the structured fields against the original document before approving this extraction.</p></div><div className="review-header-actions"><span className={'chip ' + (approved ? 'green' : 'amber')}>{approved ? <><Icon name="check" size={12} />Approved</> : <><span className="warning-dot" />Review required</>}</span><button className="btn gh" onClick={() => { dispatch({ type: 'CLEAR_EXTRACTION_REVIEW' }); dispatch({ type: 'GO', page: 'extract' }); }}><Icon name="chev" size={14} className="review-back-icon" />Back to extraction</button></div></div>
    <div className="review-meta card"><div className="review-file-icon"><Icon name="file" size={20} /></div><div><b>{review.fileName || 'Extraction document'}</b><small>{client?.name || 'Selected client'} · {review.category || 'Document'} · Protected Local Vault source</small></div><span className="review-meta-id mono">{review.documentId || 'NO DOCUMENT ID'}</span></div>
    <div className="review-tabs"><button className="review-tab active"><Icon name="table" size={15} />AI extracted data <span>{entries.length} fields</span></button><button className="review-tab"><Icon name="file" size={15} />Original document</button></div>
    <div className="review-grid">
      <section className="card review-data-panel"><div className="card-h"><div><span className="section-kicker">EDITABLE FIELDS</span><h2>Review extracted values</h2></div><span className="review-confidence"><i />AI confidence review</span></div><div className="card-b">{entries.length ? <div className="review-fields">{entries.map(([key, value]) => <label className="review-field" key={key}><span>{labelFor(key)}</span><textarea value={printable(value)} onChange={event => updateField(key, event.target.value)} rows={String(value).length > 70 ? 3 : 1} /></label>)}</div> : <div className="review-empty"><Icon name="table" size={21} /><b>No extracted fields available</b><span>Return to extraction and run the AI pipeline again.</span></div>}<div className="review-footer"><div className="review-note"><Icon name="bell" size={14} /><span>Check names, dates, tax IDs, amounts, and totals against the source.</span></div><button className="btn pri" disabled={!entries.length || saving || approved} onClick={() => void approve()}><Icon name="check" size={14} />{saving ? 'Saving approval…' : approved ? 'Approved & saved' : 'Approve extraction'}</button></div>{message && <div className={'extract-message ' + (approved ? 'success' : 'error')}><Icon name={approved ? 'check' : 'x'} size={14} />{message}</div>}</div></section>
      <section className="card review-source-panel"><div className="card-h"><div><span className="section-kicker">SOURCE DOCUMENT</span><h2>Original file</h2></div><span className="chip blue">Read only</span></div><div className="review-source-body">{loadingFile ? <div className="review-file-loading"><i /><i /><i /><span>Opening protected file…</span></div> : fileError ? <div className="review-empty error"><Icon name="x" size={21} /><b>Could not open source file</b><span>{fileError}</span><button className="btn sm" onClick={() => { dispatch({ type: 'CLEAR_EXTRACTION_REVIEW' }); dispatch({ type: 'GO', page: 'files' }); }}>Open Client Folders</button></div> : previewType === 'application/pdf' ? <iframe title="Original extraction document" src={previewUrl} /> : previewType.startsWith('image/') ? <img src={previewUrl} alt="Original extraction document" /> : <div className="review-empty"><Icon name="file" size={21} /><b>Preview is not available</b><span>This file type is securely stored, but cannot be rendered inside the review panel.</span></div>}</div></section>
    </div>
  </div>;
}
