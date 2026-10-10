import { useEffect } from 'react';
import { AppProvider, useAppState } from './state/store';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { AuthPage } from './pages/AuthPage';
import { OnboardingFlow } from './pages/OnboardingFlow';
import { Dashboard } from './pages/Dashboard';
import { ExtractPage } from './pages/Extract';
import { WhatsAppPage } from './pages/WhatsApp';
import { FilesPage } from './pages/Files';
import { DeadlinesPage } from './pages/Deadlines';
import { GeneratePage } from './pages/Generate';
import { ClientsPage, BillingPage, SettingsPage } from './pages/Other';

function Shell() {
  const s = useAppState();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', s.theme);
  }, [s.theme]);

  useEffect(() => {
    document.body.classList.toggle('chat-hidden', !s.chatOpen);
  }, [s.chatOpen]);

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
    whatsapp: WhatsAppPage,
    files: FilesPage,
    deadlines: DeadlinesPage,
    generate: GeneratePage,
    clients: ClientsPage,
    billing: BillingPage,
    settings: SettingsPage,
  }[s.page];

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

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
