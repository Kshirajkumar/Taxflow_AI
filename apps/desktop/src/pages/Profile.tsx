import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { apiConfirmAccountDeletion, apiUpdateProfile, apiVerifyAccountDeletionPassword } from '../lib/api';

export function ProfilePage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const user = s.currentUser;
  const [name, setName] = useState(user?.name || '');
  const [practiceType, setPracticeType] = useState(user?.practiceType || 'Chartered Accountant (CA)');
  const [membershipNo, setMembershipNo] = useState(user?.membershipNo || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountStep, setDeleteAccountStep] = useState<'password' | 'confirm'>('password');
  const [deleteAccountPassword, setDeleteAccountPassword] = useState('');
  const [deleteAccountChallenge, setDeleteAccountChallenge] = useState('');
  const [deleteAccountPhrase, setDeleteAccountPhrase] = useState('');
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState('');

  useEffect(() => {
    setName(user?.name || '');
    setPracticeType(user?.practiceType || 'Chartered Accountant (CA)');
    setMembershipNo(user?.membershipNo || '');
  }, [user?.id, user?.name, user?.practiceType, user?.membershipNo]);

  useEffect(() => {
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

  if (!user) return null;

  const initials = user.name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'TF';
  const accountLabel = user.practiceType === 'Individual' ? 'Individual workspace' : 'CA practice workspace';

  async function save() {
    if (!name.trim()) { setError('Your name is required.'); return; }
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const response = await apiUpdateProfile({ name: name.trim(), practiceType, membershipNo: membershipNo.trim() || undefined });
      if (!response.success || !response.user) throw new Error(response.message || 'Your profile could not be updated.');
      dispatch({ type: 'UPDATE_USER', user: response.user });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2800);
    } catch (err: any) {
      setError(err?.message || 'Your profile could not be updated.');
    } finally {
      setSaving(false);
    }
  }

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
    } catch (deleteError) {
      setDeleteAccountError(deleteError instanceof Error ? deleteError.message : 'Your password could not be verified.');
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
    } catch (deleteError) {
      setDeleteAccountError(deleteError instanceof Error ? deleteError.message : 'Account deletion could not be completed.');
    } finally {
      setDeleteAccountBusy(false);
    }
  }

  return (
    <div className="profile-page">
      <div className="ph profile-page-head">
        <div><span className="eyebrow"><span className="eyebrow-dot" />ACCOUNT CENTRE</span><h1>Profile</h1><p>Manage your identity, practice details, and workspace access in one place.</p></div>
        <span className="profile-live-chip"><i />Account active</span>
      </div>

      <section className="card profile-hero">
        <div className="profile-hero-glow" />
        <div className="profile-avatar-xl">{initials}<span /></div>
        <div className="profile-hero-copy"><span className="eyebrow">PERSONAL PROFILE</span><h2>{user.name || 'Your profile'}</h2><p>{accountLabel} · Member since your TaxFlow account was created</p><div className="profile-hero-tags"><span><Icon name="check" size={12} />Verified workspace</span><span><Icon name="folder" size={12} />Local Vault enabled</span></div></div>
        <div className="profile-hero-mark"><Icon name="users" size={20} /><span>TaxFlow<br />workspace</span></div>
      </section>

      <div className="profile-layout">
        <section className="card profile-edit-card">
          <div className="card-h"><div><span className="eyebrow">EDIT DETAILS</span><h2>Profile information</h2></div><Icon name="pencil" size={16} /></div>
          <div className="card-b">
            <div className="profile-form-grid">
              <label className="f profile-field-wide">Full name<input className="modal-input" value={name} onChange={event => setName(event.target.value)} autoComplete="name" /></label>
              <label className="f profile-field-wide">Email address <span className="profile-readonly">Read-only</span><input className="modal-input" value={user.email} readOnly disabled autoComplete="email" /></label>
              <label className="f">Account category<select className="modal-input" value={practiceType} onChange={event => setPracticeType(event.target.value)}><option>Chartered Accountant (CA)</option><option>Individual</option></select></label>
              <label className="f">Membership number <span className="profile-optional">Optional</span><input className="modal-input" value={membershipNo} onChange={event => setMembershipNo(event.target.value)} placeholder="Enter if applicable" /></label>
            </div>
            {error && <div className="ob-error profile-form-message"><Icon name="x" size={14} />{error}</div>}
            {saved && <div className="profile-success"><Icon name="check" size={14} />Profile details saved successfully.</div>}
            <div className="profile-form-footer"><span><Icon name="check" size={13} />Changes are saved securely to your account</span><button className="btn pri" disabled={saving} onClick={save}>{saving ? <><i className="spin" />Saving</> : <><Icon name="check" size={14} />Save changes</>}</button></div>
          </div>
        </section>

        <aside className="profile-side-column">
          <section className="card profile-status-card"><div className="card-h"><h2>Account status</h2><span className="profile-status-dot" /></div><div className="card-b"><div className="profile-status-row"><span>Workspace</span><b>Ready</b></div><div className="profile-status-row"><span>Onboarding</span><b>{user.onboardingComplete ? 'Complete' : 'In progress'}</b></div><div className="profile-status-row"><span>Local Vault</span><b>{user.vaultConfigured ? 'Connected' : 'Not configured'}</b></div></div></section>
          <section className="card profile-about-card"><div className="card-h"><h2>About TaxFlow</h2><Icon name="spark" size={15} /></div><div className="card-b"><p>TaxFlow keeps client records, documents, extraction review, deadlines, and practice workflows connected in one focused workspace.</p><div className="profile-about-line"><Icon name="check" size={14} /><span>Your profile belongs only to your signed-in account.</span></div></div></section>
        </aside>
      </div>

      <section className="profile-detail-strip"><div><span className="profile-detail-icon"><Icon name="users" size={16} /></span><div><b>Your account identity</b><small>This is the person responsible for the TaxFlow workspace.</small></div></div><div><span className="profile-detail-icon"><Icon name="folder" size={16} /></span><div><b>Your private workspace</b><small>Client files and local vault settings remain separate from your profile.</small></div></div><div><span className="profile-detail-icon"><Icon name="check" size={16} /></span><div><b>Safe profile updates</b><small>Only supported account details can be changed here.</small></div></div></section>

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
    </div>
  );
}
