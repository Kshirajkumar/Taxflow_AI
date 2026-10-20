import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { open } from '@tauri-apps/plugin-dialog';
import { AppProvider, useAppState } from './state/store';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { Icon } from './components/Icon';
import { AuthPage } from './pages/AuthPage';
import { apiGetMeWithToken } from './lib/api';
import { useDispatch } from './state/store';
import { OnboardingFlow } from './pages/OnboardingFlow';
import { Dashboard } from './pages/Dashboard';
import { ExtractPage } from './pages/Extract';
import { ExtractionReviewPage } from './pages/ExtractionReview';
import { WhatsAppPage } from './pages/WhatsApp';
import { FilesPage } from './pages/Files';
import { DeadlinesPage } from './pages/Deadlines';
import { GeneratePage } from './pages/Generate';
import { ClientsPage, SettingsPage } from './pages/Other';
import { ProfilePage } from './pages/Profile';
import { SubscriptionsPage } from './pages/Subscriptions';
import {
  acknowledgeLocalDocumentSync,
  downloadDocumentForLocalVault,
  fetchPendingLocalDocuments,
} from './lib/api';
import {
  configureLocalVault,
  getLocalVaultStatus,
  isDesktopApp,
  saveSyncedDocument,
} from './lib/localVault';

function Shell() {
  const s = useAppState();
  const dispatch = useDispatch();
  const [vaultSyncNotice, setVaultSyncNotice] = useState<{
    id: number;
    message: string;
    kind: 'info' | 'success' | 'warning' | 'error';
  } | null>(null);
  const [configuringVault, setConfiguringVault] = useState(false);
  const syncNowRef = useRef<(() => void) | null>(null);
  const vaultNoticeSequenceRef = useRef(0);

  function showVaultSyncNotice(message: string, kind: 'info' | 'success' | 'warning' | 'error') {
    setVaultSyncNotice({ id: ++vaultNoticeSequenceRef.current, message, kind });
  }

  useEffect(() => {
    if (!vaultSyncNotice) return undefined;
    const timer = window.setTimeout(() => setVaultSyncNotice(null), 20_000);
    return () => window.clearTimeout(timer);
  }, [vaultSyncNotice]);

  // Apply the theme before the browser paints the next frame. Using a normal
  // effect here briefly rendered the new page background with the previous
  // text/card variables, which produced the washed-out mixed-theme state.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', s.theme);
  }, [s.theme]);

  useEffect(() => {
    document.body.classList.toggle('chat-hidden', !s.chatOpen);
    document.body.classList.toggle('chat-open', s.chatOpen);
    return () => {
      document.body.classList.remove('chat-hidden', 'chat-open');
    };
  }, [s.chatOpen]);

  useEffect(() => {
    if (s.page === 'extraction-review' && s.chatOpen) dispatch({ type: 'TOGGLE_CHAT' });
  }, [s.page, s.chatOpen, dispatch]);

  useEffect(() => {
    document.body.classList.toggle('sidebar-collapsed', !!s.sidebarCollapsed);
  }, [s.sidebarCollapsed]);

  useEffect(() => {
    if (!s.currentUser?.onboardingComplete || !isDesktopApp()) return;

    let disposed = false;
    let syncing = false;
    const syncDocuments = async () => {
      if (syncing || disposed) return;
      syncing = true;
      try {
        const vault = await getLocalVaultStatus();
        if (disposed) return;
        if (!vault) {
          showVaultSyncNotice('Choose a local vault folder to securely receive client files on this device.', 'warning');
          return;
        }
        const pending = await fetchPendingLocalDocuments(vault.deviceId);
        let syncedCount = 0;
        for (const document of pending) {
          if (disposed) return;
          const content = await downloadDocumentForLocalVault(document.id);
          if (disposed) return;
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', content));
          const actualHash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
          if (actualHash !== document.sha256.toLowerCase()) {
            throw new Error(`Checksum mismatch for ${document.fileName}.`);
          }
          await saveSyncedDocument(document, content);
          if (disposed) return;
          await acknowledgeLocalDocumentSync(vault.deviceId, document.id, actualHash);
          syncedCount += 1;
        }
        if (!disposed) {
          if (syncedCount) {
            showVaultSyncNotice(`${syncedCount} secure file${syncedCount === 1 ? '' : 's'} synced to the local vault.`, 'success');
          } else {
            setVaultSyncNotice(null);
          }
        }
      } catch (error) {
        console.error('[Vault Sync] Incoming client document sync failed:', error);
        if (!disposed) {
          const detail = error instanceof Error ? error.message : 'An unexpected sync error occurred.';
          const message = /failed to fetch|networkerror|network request failed/i.test(detail)
            ? 'Could not reach the TaxFlow server. Check your internet connection and backend availability.'
            : /401|unauthori[sz]ed|session.*expir/i.test(detail)
              ? 'Your session may have expired. Sign in again, then retry the file sync.'
              : `Could not sync incoming client files. ${detail}`;
          showVaultSyncNotice(message, 'error');
        }
      } finally {
        syncing = false;
      }
    };

    syncNowRef.current = () => { void syncDocuments(); };
    void syncDocuments();
    const timer = window.setInterval(() => { void syncDocuments(); }, 60_000);
    return () => {
      disposed = true;
      syncNowRef.current = null;
      window.clearInterval(timer);
    };
  }, [s.currentUser?.id, s.currentUser?.onboardingComplete]);

  async function handleConfigureLocalVault() {
    setConfiguringVault(true);
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Select Your TaxFlow Local Vault Folder' });
      if (typeof selected !== 'string') return;
      await configureLocalVault(selected);
      showVaultSyncNotice('Local vault configured. Checking for incoming client files…', 'info');
      syncNowRef.current?.();
    } catch (error) {
      console.error('[Vault Sync] Local vault configuration failed:', error);
      const detail = error instanceof Error ? error.message : 'Choose a writable folder and try again.';
      showVaultSyncNotice(`Could not configure the local vault. ${detail}`, 'error');
    } finally {
      setConfiguringVault(false);
    }
  }

  // Not authenticated → show login / signup page
  if (!s.currentUser) {
    return <AuthPage />;
  }

  // Authenticated but onboarding not complete → show onboarding flow
  if (!s.currentUser.onboardingComplete) {
    return <OnboardingFlow />;
  }

  const Page = {
    dashboard: Dashboard,
    extract: ExtractPage,
    'extraction-review': ExtractionReviewPage,
    whatsapp: WhatsAppPage,
    files: FilesPage,
    deadlines: DeadlinesPage,
    generate: GeneratePage,
    clients: ClientsPage,
    subscriptions: SubscriptionsPage,
    profile: ProfilePage,
    settings: SettingsPage,
  }[s.page] || Dashboard;

  return (
    <div className={`app${vaultSyncNotice ? ' has-vault-sync-status' : ''}`}>
      <Titlebar />
      {vaultSyncNotice && (
        <div
          key={vaultSyncNotice.id}
          className={`vault-sync-toast ${vaultSyncNotice.kind}`}
          role={vaultSyncNotice.kind === 'error' ? 'alert' : 'status'}
          aria-live={vaultSyncNotice.kind === 'error' ? 'assertive' : 'polite'}
        >
          <span className="vault-sync-toast-icon">
            <Icon name={vaultSyncNotice.kind === 'success' ? 'check' : vaultSyncNotice.kind === 'warning' ? 'folder' : vaultSyncNotice.kind === 'error' ? 'info' : 'refresh'} size={15} />
          </span>
          <span className="vault-sync-toast-copy">
            <b>{vaultSyncNotice.kind === 'error' ? 'Secure file sync needs attention' : vaultSyncNotice.kind === 'warning' ? 'Local vault setup required' : vaultSyncNotice.kind === 'success' ? 'File sync complete' : 'Secure file sync'}</b>
            <span>{vaultSyncNotice.message}</span>
          </span>
          {vaultSyncNotice.kind === 'error' && (
            <button type="button" className="vault-sync-toast-action" onClick={() => { showVaultSyncNotice('Retrying the secure client-file sync…', 'info'); syncNowRef.current?.(); }}>
              Retry now
            </button>
          )}
          {vaultSyncNotice.kind === 'warning' && (
            <button type="button" className="vault-sync-toast-action" onClick={handleConfigureLocalVault} disabled={configuringVault}>
              {configuringVault ? 'Opening…' : 'Choose folder'}
            </button>
          )}
          <button type="button" className="vault-sync-toast-close" onClick={() => setVaultSyncNotice(null)} aria-label="Dismiss notification">
            <Icon name="x" size={13} />
          </button>
          <span className="vault-sync-toast-timer" aria-hidden="true"><i key={vaultSyncNotice.id} /></span>
        </div>
      )}
      <div className="shell">
        <Sidebar />
        <main className={`main${s.page === 'whatsapp' ? ' main-inbox' : ''}`}><Page /></main>
        <Chat />
      </div>
    </div>
  );
}

function AuthDeepLinkHandler() {
  const dispatch = useDispatch();

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const handledUrls = new Set<string>();

    const handleUrls = async (urls: string[]) => {
      const callbackUrl = urls.find((url) => url.startsWith('taxflow://auth/callback'));
      if (!callbackUrl || disposed || handledUrls.has(callbackUrl)) return;
      handledUrls.add(callbackUrl);

      try {
        const parsed = new URL(callbackUrl);
        const params = new URLSearchParams(parsed.hash.replace(/^#/, ''));
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token') || undefined;

        if (!accessToken) {
          console.error('[AUTH] Confirmation link did not contain an access token.');
          return;
        }

        const response = await apiGetMeWithToken(accessToken);
        if (!disposed && response.success && response.user) {
          dispatch({
            type: 'LOGIN',
            user: response.user,
            token: accessToken,
            refreshToken,
          });
        } else {
          console.error('[AUTH] Confirmation session could not be validated:', response.message);
        }
      } catch (error) {
        console.error('[AUTH] Failed to process confirmation link:', error);
      }
    };

    const start = async () => {
      try {
        unlisten = await onOpenUrl(handleUrls);
        const startUrls = await getCurrent();
        if (startUrls) await handleUrls(startUrls);
      } catch {
        // The browser build does not provide Tauri's deep-link API.
      }
    };

    void start();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [dispatch]);

  return null;
}

export default function App() {
  return (
    <AppProvider>
      <AuthDeepLinkHandler />
      <Shell />
    </AppProvider>
  );
}
