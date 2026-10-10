import { useEffect, useLayoutEffect } from 'react';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { AppProvider, useAppState } from './state/store';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
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
import { ClientsPage, BillingPage, SettingsPage } from './pages/Other';

function Shell() {
  const s = useAppState();
  const dispatch = useDispatch();

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
    billing: BillingPage,
    settings: SettingsPage,
  }[s.page] || Dashboard;

  return (
    <div className="app">
      <Titlebar />
      <div className="shell">
        <Sidebar />
        <main className="main"><Page /></main>
        <Chat />
      </div>
      <footer className="statusbar">
        <span><i className="sdot" /><b>WhatsApp API connected</b></span>
        <span>Vault <b>D:\Taxflow\Clients</b></span>
        <span className="sp" />
      </footer>
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
