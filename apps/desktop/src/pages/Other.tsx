import React from 'react';
import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { allTasks, missing } from '../lib/domain';
import { money, sum } from '../lib/format';
import { createClient, deleteClient, fetchClientPortalAccess, inviteClientToPortal, revokeClientPortalAccess, updateClient } from '../lib/api';
import { FilingTypePicker } from '../components/FilingTypePicker';

export function ClientsPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const [showAdd, setShowAdd] = React.useState(false);
  const [selectedClient, setSelectedClient] = React.useState<(typeof s.clients)[number] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [portalNotice, setPortalNotice] = React.useState('');
  const [editingClient, setEditingClient] = React.useState(false);
  const [editSaving, setEditSaving] = React.useState(false);
  const [editError, setEditError] = React.useState('');
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [deleteSaving, setDeleteSaving] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState('');
  const [portalAccessEnabled, setPortalAccessEnabled] = React.useState(false);
  const [portalAccessLoading, setPortalAccessLoading] = React.useState(false);
  const [portalActionLoading, setPortalActionLoading] = React.useState(false);
  const [portalMessage, setPortalMessage] = React.useState('');
  const [portalError, setPortalError] = React.useState('');
  const [editForm, setEditForm] = React.useState({ name: '', entityType: 'Individual', pan: '', gstin: '', phone: '', email: '', countryId: '', filingTypes: [] as string[] });
  const [form, setForm] = React.useState({ name: '', entityType: 'Individual', pan: '', gstin: '', phone: '', email: '', countryId: '', filingTypes: [] as string[] });
  const update = (key: string, value: any) => setForm(prev => ({ ...prev, [key]: value }));
  React.useEffect(() => {
    let disposed = false;
    if (!selectedClient) return undefined;
    setPortalAccessLoading(true);
    setPortalMessage('');
    setPortalError('');
    fetchClientPortalAccess(selectedClient.id)
      .then(access => {
        if (!disposed) setPortalAccessEnabled(access.enabled);
      })
      .catch(err => {
        if (!disposed) setPortalError(err instanceof Error ? err.message : 'Could not load portal access.');
      })
      .finally(() => {
        if (!disposed) setPortalAccessLoading(false);
      });
    return () => { disposed = true; };
  }, [selectedClient?.id]);

  async function inviteSelectedClientToPortal() {
    if (!selectedClient || portalActionLoading) return;
    setPortalActionLoading(true);
    setPortalMessage('');
    setPortalError('');
    try {
      const result = await inviteClientToPortal(selectedClient.id);
      setPortalAccessEnabled(true);
      setPortalMessage(`A secure sign-in invitation was emailed to ${result.email}.`);
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Could not send the portal invitation.');
    } finally {
      setPortalActionLoading(false);
    }
  }

  async function revokeSelectedClientPortalAccess() {
    if (!selectedClient || portalActionLoading) return;
    if (!window.confirm(`Revoke client portal access for ${selectedClient.name}?`)) return;
    setPortalActionLoading(true);
    setPortalMessage('');
    setPortalError('');
    try {
      await revokeClientPortalAccess(selectedClient.id);
      setPortalAccessEnabled(false);
      setPortalMessage('Portal access has been revoked.');
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Could not revoke portal access.');
    } finally {
      setPortalActionLoading(false);
    }
  }
  async function save() {
    if (!form.name.trim()) { setError('Client name is required.'); return; }
    if (!form.countryId) { setError('Please select a supported country.'); return; }
    setSaving(true); setError('');
    try {
      const saved: any = await createClient(form as any);
      if (!saved) throw new Error('Could not save client.');
      setPortalNotice(saved.portalAccessWarning || '');
      dispatch({ type: 'ADD_CLIENT', client: { id: saved.id, name: saved.name, entityType: saved.entity_type || form.entityType, short: saved.name.slice(0, 3).toUpperCase(), city: 'Local', country: saved.country_name || 'Selected country', countryId: saved.country_id || form.countryId, cur: saved.currency_code || 'INR', gstin: saved.gstin || '', pan: saved.pan || '', svc: saved.filing_types || form.filingTypes, filingTypes: saved.filing_types || form.filingTypes, contact: saved.email || '', phone: saved.phone || '', fee: 0, tone: 'blue', alias: [] } });
      setShowAdd(false); setForm({ name: '', entityType: 'Individual', pan: '', gstin: '', phone: '', email: '', countryId: '', filingTypes: [] });
    } catch (err: any) { setError(err.message || 'Could not save client.'); }
    finally { setSaving(false); }
  }
  function startEditing() {
    if (!selectedClient) return;
    setEditForm({ name: selectedClient.name, entityType: selectedClient.entityType || 'Individual', pan: selectedClient.pan, gstin: selectedClient.gstin, phone: selectedClient.phone, email: selectedClient.contact, countryId: selectedClient.countryId || '', filingTypes: selectedClient.filingTypes?.length ? [...selectedClient.filingTypes] : [...selectedClient.svc] });
    setEditError('');
    setDeleteConfirm(false);
    setDeleteError('');
    setEditingClient(true);
  }

  async function permanentlyDeleteClient() {
    if (!selectedClient || deleteSaving) return;
    setDeleteSaving(true);
    setDeleteError('');
    try {
      const deleted = await deleteClient(selectedClient.id);
      dispatch({ type: 'DELETE_CLIENT', id: selectedClient.id });
      setDeleteConfirm(false);
      setEditingClient(false);
      setSelectedClient(null);
      if (deleted.vaultWarning) console.warn(deleted.vaultWarning);
    } catch (err: any) {
      setDeleteError(err.message || 'Could not delete this client. Nothing was removed.');
    } finally {
      setDeleteSaving(false);
    }
  }
  async function saveEdit() {
    if (!selectedClient || !editForm.name.trim()) { setEditError('Client name is required.'); return; }
    if (!editForm.countryId) { setEditError('Please select a supported country.'); return; }
    setEditSaving(true); setEditError('');
    try {
      const saved: any = await updateClient(selectedClient.id, editForm as any);
      const updated = { ...selectedClient, name: saved.name || editForm.name.trim(), entityType: saved.entity_type || editForm.entityType, countryId: saved.country_id || editForm.countryId, country: saved.country_name || selectedClient.country, short: (saved.name || editForm.name).slice(0, 3).toUpperCase(), gstin: saved.gstin || '', pan: saved.pan || '', svc: Array.isArray(saved.filing_types) ? saved.filing_types : editForm.filingTypes, filingTypes: Array.isArray(saved.filing_types) ? saved.filing_types : editForm.filingTypes, contact: saved.email || '', phone: saved.phone || '' };
      dispatch({ type: 'UPDATE_CLIENT', client: updated });
      setSelectedClient(updated);
      setPortalError(saved.portalAccessWarning || '');
      setEditingClient(false);
    } catch (err: any) { setEditError(err.message || 'Could not update client.'); }
    finally { setEditSaving(false); }
  }
  return (
    <>
      <div className="ph"><div><h1>Clients</h1><p>Everyone you file for, with their services and current workload.</p></div><button className="btn pri" onClick={() => setShowAdd(true)}>+ Add client</button></div>
      {portalNotice && <div className="ob-error" role="status">{portalNotice}</div>}
      {!s.clients.length ? <section className="card client-empty-state" aria-labelledby="clients-empty-title">
        <div className="client-empty-visual"><div className="client-empty-orb"><Icon name="users" size={28} /></div><span className="client-empty-spark client-empty-spark-one"><Icon name="check" size={11} /></span><span className="client-empty-spark client-empty-spark-two"><Icon name="file" size={11} /></span></div>
        <div className="client-empty-copy"><span className="eyebrow"><span className="eyebrow-dot" />CLIENT WORKSPACE</span><h2 id="clients-empty-title">Your client list starts here</h2><p>Add your first client to organize filings, secure documents, deadlines, and extraction work in one place.</p><button className="btn pri" onClick={() => setShowAdd(true)}><Icon name="users" size={14} />Add your first client</button></div>
        <div className="client-empty-steps" aria-label="What you can do with a client workspace"><div><span><Icon name="folder" size={14} /></span><b>Keep records together</b><small>Profile, tax IDs, and selected filings</small></div><div><span><Icon name="spark" size={14} /></span><b>Extract with confidence</b><small>Review documents against the right client</small></div><div><span><Icon name="check" size={14} /></span><b>Stay ahead of work</b><small>Deadlines and missing documents in view</small></div></div>
      </section> : <div className="grid g3">
        {s.clients.map((c) => {
          const mine = allTasks(s.tasks).filter((x) => x.t.client === c.id);
          const pct = mine.length ? Math.round((sum(mine, (x) => x.done) / sum(mine, (x) => x.total)) * 100) : 0;
          const m = missing(s.checks, c.id).length;
          return (
            <div key={c.id} className="card ccard">
              <div className="row">
                <span className="av lg" style={{ ['--t' as any]: c.tone }}>{c.short.slice(0, 2).toUpperCase()}</span>
                <div style={{ minWidth: 0 }}><b>{c.name}</b><div className="mut" style={{ fontSize: 12 }}>{c.city}, {c.country}</div></div>
              </div>
              <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 6 }}>{c.svc.map((sv) => <span key={sv} className="chip blue">{sv}</span>)}</div>
              <div className="kvs" style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '4px 8px', margin: '12px 0', fontSize: 12.5 }}>
                <span className="mut">Tax ID</span><b className="mono">{c.gstin}</b>
                <span className="mut">Contact</span><b>{c.contact}</b>
                <span className="mut">Fee</span><b>{money(c.fee, c.cur)} / mo</b>
              </div>
              <div className="row" style={{ marginBottom: 5 }}><span className="mut2">Work completed</span><span className="sp" /><b>{pct}%</b></div>
              <div className="bar"><i style={{ width: pct + '%' }} /></div>
              <div className="row" style={{ margin: '12px 0', flexWrap: 'wrap', gap: 6 }}>
                {m ? <span className="chip amber">{m} documents missing</span> : <span className="chip green">All documents received</span>}
              </div>
              <div className="row"><button className="btn sm" onClick={() => setSelectedClient(c)}>View details</button><button className="btn sm" onClick={() => { dispatch({ type: 'WA_CLIENT', id: c.id }); dispatch({ type: 'GO', page: 'whatsapp' }); }}><Icon name="chat" size={13} />Chat</button></div>
            </div>
          );
        })}
      </div>}
      {selectedClient && <div className="modal client-details-modal" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedClient(null); }}>
        <div className="card client-details-card">
          <div className="card-h client-details-header"><div><span className="eyebrow">{editingClient ? 'Edit client' : 'Client profile'}</span><h2>{editingClient ? 'Update client details' : selectedClient.name}</h2></div><div className="client-details-actions">{!editingClient && <button className="icon-btn edit-client-btn" onClick={startEditing} title="Edit client" aria-label="Edit client"><Icon name="pencil" size={16} /></button>}<button className="btn" onClick={() => { setEditingClient(false); setSelectedClient(null); }}>Close</button></div></div>
          <div className={'card-b' + (editingClient ? ' client-edit-body' : '')}>
            {editingClient ? <>
              <div className="client-edit-intro"><span className="av lg" style={{ ['--t' as any]: selectedClient.tone }}>{selectedClient.short.slice(0, 2).toUpperCase()}</span><div><b>Edit {selectedClient.name}</b><div className="mut">Keep the client profile accurate for filings and communication.</div></div></div>
              <div className="client-edit-grid">
                <label className="f">Client / firm name *<input className="modal-input" value={editForm.name} onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))} /></label>
                <label className="f">Entity type<select className="modal-input" value={editForm.entityType} onChange={e => setEditForm(prev => ({ ...prev, entityType: e.target.value }))}><option>Individual</option><option>Partnership</option><option>Pvt Ltd</option><option>LLP</option><option>Trust</option><option>HUF</option><option>OPC</option></select></label>
                <label className="f">PAN<input className="modal-input" maxLength={10} value={editForm.pan} onChange={e => setEditForm(prev => ({ ...prev, pan: e.target.value.toUpperCase() }))} /></label>
                <label className="f">GSTIN<input className="modal-input" maxLength={15} value={editForm.gstin} onChange={e => setEditForm(prev => ({ ...prev, gstin: e.target.value.toUpperCase() }))} /></label>
                <label className="f">Phone<input className="modal-input" value={editForm.phone} onChange={e => setEditForm(prev => ({ ...prev, phone: e.target.value }))} /></label>
                <label className="f">Email<input className="modal-input" type="email" value={editForm.email} onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))} /></label>
              </div>
              <FilingTypePicker countryId={editForm.countryId} selectedTypes={editForm.filingTypes} onCountryChange={value => setEditForm(prev => ({ ...prev, countryId: value, filingTypes: [] }))} onTypesChange={value => setEditForm(prev => ({ ...prev, filingTypes: value }))} />
              {editError && <div className="ob-error">{editError}</div>}
              <div className="client-edit-footer"><button className="btn danger" onClick={() => { setDeleteError(''); setDeleteConfirm(true); }}>Delete client</button><span className="sp" /><button className="btn gh" onClick={() => setEditingClient(false)}>Cancel</button><button className="btn pri" disabled={editSaving || deleteSaving} onClick={saveEdit}>{editSaving ? <><i className="spin" />Saving</> : <><Icon name="check" size={14} />Save changes</>}</button></div>
            </> : <>
            <div className="client-details-identity"><span className="av lg" style={{ ['--t' as any]: selectedClient.tone }}>{selectedClient.short.slice(0, 2).toUpperCase()}</span><div><b>{selectedClient.name}</b><div className="mut">{selectedClient.city}, {selectedClient.country}</div></div></div>
            <div className="client-details-grid">
              <div><span>Entity type</span><b>{selectedClient.entityType || 'Not specified'}</b></div>
              <div><span>PAN</span><b className="mono">{selectedClient.pan || 'Not provided'}</b></div>
              <div><span>GSTIN</span><b className="mono">{selectedClient.gstin || 'Not provided'}</b></div>
              <div><span>Phone</span><b>{selectedClient.phone || 'Not provided'}</b></div>
              <div className="full"><span>Email</span><b>{selectedClient.contact || 'Not provided'}</b></div>
            </div>
            <div className="client-details-section"><span className="eyebrow">Selected filings</span><div className="client-details-filings">{(selectedClient.filingTypes?.length ? selectedClient.filingTypes : selectedClient.svc).map(type => <span key={type} className="chip blue">{type}</span>)}</div></div>
            <div className="client-details-section client-portal-access">
              <span className="eyebrow">Secure client portal</span>
              <p>Clients upload documents here. Files are stored privately and delivered to your desktop app’s local vault.</p>
              {portalError && <div className="ob-error" role="alert">{portalError}</div>}
              {portalMessage && <div className="portal-success-message" role="status">{portalMessage}</div>}
              <div className="row">
                <span className={`chip ${portalAccessEnabled ? 'green' : 'amber'}`}>
                  {portalAccessLoading ? 'Checking access…' : portalAccessEnabled ? 'Portal enabled' : 'Portal not enabled'}
                </span>
                <span className="sp" />
                {portalAccessEnabled
                  ? <button className="btn sm danger" disabled={portalActionLoading || portalAccessLoading} onClick={() => void revokeSelectedClientPortalAccess()}>{portalActionLoading ? 'Please wait…' : 'Revoke access'}</button>
                  : <button className="btn sm pri" disabled={portalActionLoading || portalAccessLoading || !selectedClient.contact.trim()} onClick={() => void inviteSelectedClientToPortal()} title={!selectedClient.contact.trim() ? 'Add an email address to this client first' : undefined}>{portalActionLoading ? 'Sending invitation…' : 'Email portal invitation'}</button>}
              </div>
            </div>
            </>}
          </div>
        </div>
      </div>}
      {deleteConfirm && selectedClient && <div className="modal delete-confirm-modal" onMouseDown={e => { if (e.target === e.currentTarget && !deleteSaving) setDeleteConfirm(false); }}>
        <div className="card delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-client-title">
          <div className="delete-confirm-icon"><Icon name="trash" size={22} /></div>
          <span className="eyebrow">Permanent deletion</span>
          <h2 id="delete-client-title">Delete {selectedClient.name}?</h2>
          <p>This permanently removes the client, filing selections, documents, deadlines, messages, AI records, and local vault folder. This action cannot be undone.</p>
          {deleteError && <div className="ob-error">{deleteError}</div>}
          <div className="delete-confirm-actions"><button className="btn gh" disabled={deleteSaving} onClick={() => setDeleteConfirm(false)}>Cancel</button><button className="btn danger" disabled={deleteSaving} onClick={permanentlyDeleteClient}>{deleteSaving ? <><i className="spin" />Deleting</> : 'Permanently delete'}</button></div>
        </div>
      </div>}
      {showAdd && <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) setShowAdd(false); }}>
        <div className="card" style={{ width: 'min(680px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
          <div className="card-h"><h2>Add new client</h2><button className="btn gh" onClick={() => setShowAdd(false)}>Close</button></div>
          <div className="card-b">
            <div className="fields-grid-2">
              <label className="f">Client / firm name *<input className="modal-input" value={form.name} onChange={e => update('name', e.target.value)} /></label>
              <label className="f">Entity type<select className="modal-input" value={form.entityType} onChange={e => update('entityType', e.target.value)}><option>Individual</option><option>Partnership</option><option>Pvt Ltd</option><option>LLP</option><option>Trust</option><option>HUF</option><option>OPC</option></select></label>
              <label className="f">PAN<input className="modal-input" maxLength={10} value={form.pan} onChange={e => update('pan', e.target.value.toUpperCase())} /></label>
              <label className="f">GSTIN<input className="modal-input" maxLength={15} value={form.gstin} onChange={e => update('gstin', e.target.value.toUpperCase())} /></label>
              <label className="f">Phone<input className="modal-input" value={form.phone} onChange={e => update('phone', e.target.value)} /></label>
              <label className="f">Email<input className="modal-input" type="email" value={form.email} onChange={e => update('email', e.target.value)} /></label>
            </div>
            <FilingTypePicker countryId={form.countryId} selectedTypes={form.filingTypes} onCountryChange={value => setForm(prev => ({ ...prev, countryId: value, filingTypes: [] }))} onTypesChange={value => update('filingTypes', value)} />
            {error && <div className="ob-error" style={{ marginTop: 14 }}>{error}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20, gap: 8 }}><button className="btn gh" onClick={() => setShowAdd(false)}>Cancel</button><button className="btn pri" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save client'}</button></div>
          </div>
        </div>
      </div>}
    </>
  );
}

export function SettingsPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const row = (title: string, desc: string, key: keyof typeof s.settings) => (
    <div className="setrow" key={key}>
      <div className="tx"><b>{title}</b><small>{desc}</small></div>
      <button className={'tg' + (s.settings[key] ? ' on' : '')} role="switch" aria-checked={s.settings[key]} onClick={() => dispatch({ type: 'SETTING_TOGGLE', key })} />
    </div>
  );

  return (
    <>
      <div className="ph"><div><h1>Settings</h1><p>Connections, automation rules and security.</p></div></div>
      <div className="card">
        <div className="card-b">
          {row('Extract new bills automatically', 'Read every bill as soon as it reaches a client folder', 'autoExtract')}
          {row('Remind clients before deadlines', 'Schedule a document request before each due date', 'autoRemind')}
          {row('Ask me before anything is sent', 'Reminders wait for your approval unless turned off', 'approve')}
          {row('Block duplicate invoices', 'Flag an invoice number that already exists for the same party', 'dupes')}
        </div>
      </div>
    </>
  );
}
