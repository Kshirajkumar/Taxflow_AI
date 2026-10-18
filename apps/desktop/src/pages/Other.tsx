import React from 'react';
import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { allTasks, missing } from '../lib/domain';
import { money, sum } from '../lib/format';
import { apiConfirmAccountDeletion, apiVerifyAccountDeletionPassword, createClient, deleteClient, updateClient } from '../lib/api';
import { FilingTypePicker } from '../components/FilingTypePicker';

export function ClientsPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const [showAdd, setShowAdd] = React.useState(false);
  const [selectedClient, setSelectedClient] = React.useState<(typeof s.clients)[number] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [editingClient, setEditingClient] = React.useState(false);
  const [editSaving, setEditSaving] = React.useState(false);
  const [editError, setEditError] = React.useState('');
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [deleteSaving, setDeleteSaving] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState('');
  const [editForm, setEditForm] = React.useState({ name: '', entityType: 'Individual', pan: '', gstin: '', phone: '', email: '', countryId: '', filingTypes: [] as string[] });
  const [form, setForm] = React.useState({ name: '', entityType: 'Individual', pan: '', gstin: '', phone: '', email: '', countryId: '', filingTypes: [] as string[] });
  const update = (key: string, value: any) => setForm(prev => ({ ...prev, [key]: value }));
  async function save() {
    if (!form.name.trim()) { setError('Client name is required.'); return; }
    if (!form.countryId) { setError('Please select a supported country.'); return; }
    setSaving(true); setError('');
    try {
      const saved: any = await createClient(form as any);
      if (!saved) throw new Error('Could not save client.');
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
      setEditingClient(false);
    } catch (err: any) { setEditError(err.message || 'Could not update client.'); }
    finally { setEditSaving(false); }
  }
  return (
    <>
      <div className="ph"><div><h1>Clients</h1><p>Everyone you file for, with their services and current workload.</p></div><button className="btn pri" onClick={() => setShowAdd(true)}>+ Add client</button></div>
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
  const [deleteAccountOpen, setDeleteAccountOpen] = React.useState(false);
  const [deleteAccountStep, setDeleteAccountStep] = React.useState<'password' | 'confirm'>('password');
  const [deleteAccountPassword, setDeleteAccountPassword] = React.useState('');
  const [deleteAccountChallenge, setDeleteAccountChallenge] = React.useState('');
  const [deleteAccountPhrase, setDeleteAccountPhrase] = React.useState('');
  const [deleteAccountBusy, setDeleteAccountBusy] = React.useState(false);
  const [deleteAccountError, setDeleteAccountError] = React.useState('');
  React.useEffect(() => {
    if (!deleteAccountOpen) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleteAccountBusy) closeDeleteAccount();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [deleteAccountOpen, deleteAccountBusy]);
  const row = (title: string, desc: string, key: keyof typeof s.settings) => (
    <div className="setrow" key={key}>
      <div className="tx"><b>{title}</b><small>{desc}</small></div>
      <button className={'tg' + (s.settings[key] ? ' on' : '')} role="switch" aria-checked={s.settings[key]} onClick={() => dispatch({ type: 'SETTING_TOGGLE', key })} />
    </div>
  );

  function closeDeleteAccount() {
    if (deleteAccountBusy) return;
    setDeleteAccountOpen(false);
    setDeleteAccountStep('password');
    setDeleteAccountPassword('');
    setDeleteAccountChallenge('');
    setDeleteAccountPhrase('');
    setDeleteAccountError('');
  }

  async function verifyDeleteAccountPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteAccountPassword) {
      setDeleteAccountError('Enter your current password to continue.');
      return;
    }
    setDeleteAccountBusy(true);
    setDeleteAccountError('');
    try {
      const result = await apiVerifyAccountDeletionPassword(deleteAccountPassword);
      if (!result.success || !result.challenge) {
        throw new Error(result.message || 'Your password could not be verified.');
      }
      setDeleteAccountChallenge(result.challenge);
      setDeleteAccountPassword('');
      setDeleteAccountStep('confirm');
    } catch (error) {
      setDeleteAccountError(error instanceof Error ? error.message : 'Your password could not be verified.');
    } finally {
      setDeleteAccountBusy(false);
    }
  }

  async function confirmDeleteAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleteAccountPhrase !== 'DELETE MY ACCOUNT') {
      setDeleteAccountError('Type DELETE MY ACCOUNT exactly to permanently delete your account.');
      return;
    }
    setDeleteAccountBusy(true);
    setDeleteAccountError('');
    try {
      const result = await apiConfirmAccountDeletion(deleteAccountChallenge, deleteAccountPhrase);
      if (!result.success) throw new Error(result.message || 'Account deletion could not be completed.');
      dispatch({ type: 'LOGOUT' });
    } catch (error) {
      setDeleteAccountError(error instanceof Error ? error.message : 'Account deletion could not be completed.');
    } finally {
      setDeleteAccountBusy(false);
    }
  }

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
      <section className="card account-danger-zone">
        <div className="card-h"><div><span className="eyebrow">PERMANENT ACTION</span><h2>Delete account</h2></div><span className="account-danger-icon"><Icon name="trash" size={16} /></span></div>
        <div className="card-b">
          <p>Permanently remove your TaxFlow sign-in, profile, owned database records, and private cloud files. This cannot be undone.</p>
          <div className="account-danger-retention"><Icon name="info" size={14} /><span>Your local vault files on this device are kept. Copies on other devices and external services are not deleted.</span></div>
          <button className="btn danger" onClick={() => { setDeleteAccountOpen(true); setDeleteAccountError(''); }}>
            <Icon name="trash" size={14} />Delete account
          </button>
        </div>
      </section>
      {deleteAccountOpen && (
        <div
          className="account-delete-overlay"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeDeleteAccount(); }}
        >
          <section className="account-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="account-delete-title">
            <header className="account-delete-header">
              <span className="account-danger-icon"><Icon name="trash" size={17} /></span>
              <div><span className="eyebrow">PERMANENT ACCOUNT DELETION</span><h2 id="account-delete-title">Delete your account?</h2></div>
              <button type="button" className="modal-close-btn" onClick={closeDeleteAccount} disabled={deleteAccountBusy} aria-label="Close account deletion dialog"><Icon name="x" size={16} /></button>
            </header>
            <div className="account-delete-content">
              <div className="account-delete-step"><span className={deleteAccountStep === 'password' ? 'active' : 'complete'}>1</span><i /><span className={deleteAccountStep === 'confirm' ? 'active' : ''}>2</span></div>
              {deleteAccountStep === 'password' ? (
                <form onSubmit={event => void verifyDeleteAccountPassword(event)}>
                  <p>First, verify your identity with your current account password. Your password is sent only to the TaxFlow backend for Supabase reauthentication.</p>
                  <label className="f">Current password<input className="modal-input" type="password" autoComplete="current-password" value={deleteAccountPassword} onChange={event => setDeleteAccountPassword(event.target.value)} autoFocus disabled={deleteAccountBusy} /></label>
                  {deleteAccountError && <div className="ob-error account-delete-error" role="alert"><Icon name="x" size={14} />{deleteAccountError}</div>}
                  <div className="account-delete-actions"><button type="button" className="btn gh" onClick={closeDeleteAccount} disabled={deleteAccountBusy}>Cancel</button><button type="submit" className="btn danger" disabled={deleteAccountBusy || !deleteAccountPassword}>{deleteAccountBusy ? <><i className="spin" />Verifying…</> : 'Verify password'}</button></div>
                </form>
              ) : (
                <form onSubmit={event => void confirmDeleteAccount(event)}>
                  <div className="account-delete-warning">
                    <b>This permanently deletes:</b>
                    <ul><li>Your TaxFlow account and profile</li><li>Your owned clients, documents, messages, tasks, notifications, and integration records</li><li>Private cloud files associated with your account</li></ul>
                    <b>Your local vault on this device will be kept.</b>
                  </div>
                  <label className="f">Type <code>DELETE MY ACCOUNT</code> to confirm<input className="modal-input account-delete-phrase" value={deleteAccountPhrase} onChange={event => setDeleteAccountPhrase(event.target.value)} autoComplete="off" autoFocus disabled={deleteAccountBusy} /></label>
                  {deleteAccountError && <div className="ob-error account-delete-error" role="alert"><Icon name="x" size={14} />{deleteAccountError}{/expired|verify your password/i.test(deleteAccountError) && <button type="button" className="btn gh sm" onClick={() => { setDeleteAccountStep('password'); setDeleteAccountChallenge(''); setDeleteAccountPhrase(''); setDeleteAccountError(''); }}>Verify again</button>}</div>}
                  <div className="account-delete-actions"><button type="button" className="btn gh" onClick={closeDeleteAccount} disabled={deleteAccountBusy}>Cancel</button><button type="submit" className="btn danger" disabled={deleteAccountBusy || deleteAccountPhrase !== 'DELETE MY ACCOUNT'}>{deleteAccountBusy ? <><i className="spin" />Deleting data…</> : 'Permanently delete account'}</button></div>
                </form>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
