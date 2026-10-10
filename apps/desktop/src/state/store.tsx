import React, { createContext, useContext, useReducer, useCallback, useRef } from 'react';
import type {
  Client, InvoiceDoc, VaultFile, ChatMsg, Reminder, FilingTask, Bill, CheckItem, LogEntry, Page,
} from '../types';
import {
  CLIENTS, DOCS, FILES, TPL, REMINDERS, TASKS, BILLS, CHECKS, seedThreads, INITIAL_LOG,
} from '../data/seed';
import { vnow, ago } from '../lib/format';
import { nextTaskFor, pendingBill, missing } from '../lib/domain';
import { apiGetMe, fetchClients, fetchDocuments, fetchWhatsAppMessages, fetchComplianceTasks, AuthUser } from '../lib/api';

export interface Settings {
  autoExtract: boolean;
  autoRemind: boolean;
  approve: boolean;
  dupes: boolean;
}

export interface AppState {
  page: Page;
  theme: 'dark' | 'light';
  chatOpen: boolean;
  sidebarCollapsed: boolean;
  currentUser: AuthUser | null;
  clients: Client[];
  docs: InvoiceDoc[];
  files: VaultFile[];
  threads: Record<string, ChatMsg[]>;
  reminders: Reminder[];
  tasks: FilingTask[];
  bills: Bill[];
  checks: Record<string, CheckItem[]>;
  log: LogEntry[];
  settings: Settings;
  ui: {
    wa: { client: string; tab: 'chats' | 'reminders' | 'templates' };
    ex: { sel: string; filter: string };
    fs: { open: Set<string>; sel: string | null; q: string };
    dl: { open: Set<string> };
    gen: { client: string; period: string; types: Set<string> };
  };
}

function getSavedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem('taxflow_session');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.user || null;
  } catch (e) {
    return null;
  }
}

function getSavedSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem('taxflow_sidebar_collapsed') === 'true';
  } catch (e) {
    return false;
  }
}

type Action =
  | { type: 'GO'; page: Page }
  | { type: 'TOGGLE_THEME' }
  | { type: 'TOGGLE_CHAT' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'LOGIN'; user: AuthUser; token: string; refreshToken?: string }
  | { type: 'LOGOUT' }
  | { type: 'COMPLETE_ONBOARDING' }
  | { type: 'ADD_CLIENT'; client: Client }
  | { type: 'UPDATE_CLIENT'; client: Client }
  | { type: 'DELETE_CLIENT'; id: string }
  | { type: 'WA_CLIENT'; id: string }
  | { type: 'WA_TAB'; tab: 'chats' | 'reminders' | 'templates' }
  | { type: 'WA_SEND'; client: string; text: string }
  | { type: 'WA_APPEND'; client: string; msg: ChatMsg }
  | { type: 'REM_SCHEDULE'; reminder: Reminder }
  | { type: 'REM_SEND_NOW'; id: string }
  | { type: 'REM_CANCEL'; id: string }
  | { type: 'REM_APPROVE'; id: string }
  | { type: 'EX_SELECT'; id: string }
  | { type: 'EX_FILTER'; filter: string }
  | { type: 'EX_RUN_START'; id: string }
  | { type: 'EX_RUN_DONE'; id: string }
  | { type: 'EX_APPROVE'; id: string }
  | { type: 'EX_EDIT_FIELD'; id: string; field: string; value: string | number }
  | { type: 'FS_TOGGLE'; key: string }
  | { type: 'FS_SELECT'; id: string | null }
  | { type: 'FS_QUERY'; q: string }
  | { type: 'DL_TOGGLE'; client: string }
  | { type: 'STEP_TOGGLE'; taskId: string; index: number }
  | { type: 'GEN_CLIENT'; client: string }
  | { type: 'GEN_PERIOD'; period: string }
  | { type: 'GEN_TOGGLE_TYPE'; id: string }
  | { type: 'BILL_PAID'; no: string }
  | { type: 'SETTING_TOGGLE'; key: keyof Settings }
  | { type: 'LOG'; entry: LogEntry }
  | { type: 'API_DATA_LOADED'; payload: any };

function getSavedTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem('taxflow_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark';
  } catch (e) {
    return 'dark';
  }
}

const initialState: AppState = {
  page: 'dashboard',
  theme: getSavedTheme(),
  chatOpen: true,
  sidebarCollapsed: getSavedSidebarCollapsed(),
  currentUser: getSavedUser(),
  clients: CLIENTS,
  docs: DOCS,
  files: FILES,
  threads: seedThreads(),
  reminders: REMINDERS,
  tasks: TASKS,
  bills: BILLS,
  checks: CHECKS,
  log: INITIAL_LOG,
  settings: { autoExtract: true, autoRemind: true, approve: true, dupes: true },
  ui: {
    wa: { client: '', tab: 'chats' },
    ex: { sel: '', filter: 'all' },
    fs: { open: new Set(), sel: null, q: '' },
    dl: { open: new Set() },
    gen: { client: '', period: '2026-08', types: new Set(['gstr3b', 'recon', 'reg']) },
  },
};

let MID = 1000;

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'TOGGLE_SIDEBAR': {
      const nextCollapsed = !state.sidebarCollapsed;
      try {
        localStorage.setItem('taxflow_sidebar_collapsed', String(nextCollapsed));
      } catch (e) {}
      return { ...state, sidebarCollapsed: nextCollapsed };
    }
    case 'LOGIN': {
      try {
        localStorage.setItem('taxflow_session', JSON.stringify({ user: action.user, token: action.token, refreshToken: action.refreshToken }));
      } catch (e) {}
      return {
        ...state,
        currentUser: action.user,
        log: [{ at: vnow(), ic: 'user', t: `Signed in as ${action.user.name} (${action.user.firmName})` }, ...state.log]
      };
    }
    case 'COMPLETE_ONBOARDING': {
      if (!state.currentUser) return state;
      const updatedUser = { ...state.currentUser, onboardingComplete: true, vaultConfigured: true };
      try {
        const raw = localStorage.getItem('taxflow_session');
        const session = raw ? JSON.parse(raw) : {};
        localStorage.setItem('taxflow_session', JSON.stringify({ ...session, user: updatedUser }));
      } catch (e) {}
      return { ...state, currentUser: updatedUser };
    }
    case 'ADD_CLIENT':
      return { ...state, clients: [action.client, ...state.clients] };
    case 'UPDATE_CLIENT':
      return { ...state, clients: state.clients.map((client) => client.id === action.client.id ? action.client : client) };
    case 'DELETE_CLIENT': {
      const checks = { ...state.checks };
      delete checks[action.id];
      const threads = { ...state.threads };
      delete threads[action.id];
      return {
        ...state,
        clients: state.clients.filter(client => client.id !== action.id),
        docs: state.docs.filter(doc => doc.client !== action.id),
        files: state.files.filter(file => file.client !== action.id),
        tasks: state.tasks.filter(task => task.client !== action.id),
        reminders: state.reminders.filter(reminder => reminder.client !== action.id),
        bills: state.bills.filter(bill => bill.client !== action.id),
        checks,
        threads,
      };
    }
    case 'LOGOUT': {
      try {
        localStorage.removeItem('taxflow_session');
      } catch (e) {}
      return {
        ...state,
        currentUser: null,
        clients: [],
        docs: [],
        files: [],
        threads: {},
        reminders: [],
        tasks: [],
        bills: [],
        checks: {},
        log: [{ at: vnow(), ic: 'power', t: 'Signed out of practice workspace' }, ...state.log]
      };
    }
    case 'GO':
      return { ...state, page: action.page };
    case 'TOGGLE_THEME': {
      const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('taxflow_theme', nextTheme);
      } catch (e) {}
      return { ...state, theme: nextTheme };
    }
    case 'TOGGLE_CHAT':
      return { ...state, chatOpen: !state.chatOpen };
    case 'WA_CLIENT':
      return { ...state, ui: { ...state.ui, wa: { ...state.ui.wa, client: action.id } } };
    case 'WA_TAB':
      return { ...state, ui: { ...state.ui, wa: { ...state.ui.wa, tab: action.tab } } };
    case 'WA_APPEND': {
      const thread = state.threads[action.client] || [];
      return { ...state, threads: { ...state.threads, [action.client]: [...thread, action.msg] } };
    }
    case 'REM_SCHEDULE':
      return {
        ...state,
        reminders: [...state.reminders, action.reminder],
        log: [{ at: vnow(), ic: 'bell', t: `Scheduled a reminder for ${action.reminder.client}` }, ...state.log],
      };
    case 'REM_SEND_NOW': {
      const r = state.reminders.find((x) => x.id === action.id);
      if (!r) return state;
      const thread = state.threads[r.client] || [];
      const msg: ChatMsg = { id: MID++, f: 'me', t: r.text, at: vnow(), st: 'delivered', auto: true };
      return {
        ...state,
        reminders: state.reminders.map((x) => (x.id === action.id ? { ...x, status: 'sent' } : x)),
        threads: { ...state.threads, [r.client]: [...thread, msg] },
        log: [{ at: vnow(), ic: 'send', t: `Sent a reminder to ${r.client}` }, ...state.log],
      };
    }
    case 'REM_CANCEL':
      return { ...state, reminders: state.reminders.map((x) => (x.id === action.id ? { ...x, status: 'cancelled' } : x)) };
    case 'REM_APPROVE':
      return { ...state, reminders: state.reminders.map((x) => (x.id === action.id ? { ...x, approve: false } : x)) };
    case 'EX_SELECT':
      return { ...state, ui: { ...state.ui, ex: { ...state.ui.ex, sel: action.id } } };
    case 'EX_FILTER':
      return { ...state, ui: { ...state.ui, ex: { ...state.ui.ex, filter: action.filter } } };
    case 'EX_RUN_START':
      return { ...state, docs: state.docs.map((d) => (d.id === action.id ? { ...d, running: true } : d)) };
    case 'EX_RUN_DONE':
      return {
        ...state,
        docs: state.docs.map((d) => (d.id === action.id ? { ...d, running: false, status: d.low ? 'review' : 'extracted' } : d)),
        log: [{ at: vnow(), ic: 'scan', t: `Extracted invoice ${action.id}` }, ...state.log],
      };
    case 'EX_APPROVE':
      return {
        ...state,
        docs: state.docs.map((d) =>
          d.id === action.id
            ? { ...d, status: 'approved', conf: Object.fromEntries(Object.entries(d.conf).map(([k, v]) => [k, v < 0.8 ? 1 : v])) }
            : d
        ),
        log: [{ at: vnow(), ic: 'check', t: `Approved invoice ${action.id}` }, ...state.log],
      };
    case 'EX_EDIT_FIELD':
      return {
        ...state,
        docs: state.docs.map((d) => {
          if (d.id !== action.id) return d;
          const next: any = { ...d, conf: { ...d.conf, [action.field]: 1 } };
          if (action.field === 'taxable' || action.field === 'rate') next[action.field] = Number(action.value);
          else next[action.field] = action.value;
          if (next.status === 'approved') next.status = 'extracted';
          return next;
        }),
      };
    case 'FS_TOGGLE': {
      const open = new Set(state.ui.fs.open);
      open.has(action.key) ? open.delete(action.key) : open.add(action.key);
      return { ...state, ui: { ...state.ui, fs: { ...state.ui.fs, open } } };
    }
    case 'FS_SELECT':
      return { ...state, ui: { ...state.ui, fs: { ...state.ui.fs, sel: action.id } } };
    case 'FS_QUERY':
      return { ...state, ui: { ...state.ui, fs: { ...state.ui.fs, q: action.q } } };
    case 'DL_TOGGLE': {
      const open = new Set(state.ui.dl.open);
      open.has(action.client) ? open.delete(action.client) : open.add(action.client);
      return { ...state, ui: { ...state.ui, dl: { open } } };
    }
    case 'STEP_TOGGLE':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.taskId ? { ...t, steps: t.steps.map((s, i) => (i === action.index ? !s : s)) } : t
        ),
      };
    case 'GEN_CLIENT':
      return { ...state, ui: { ...state.ui, gen: { ...state.ui.gen, client: action.client } } };
    case 'GEN_PERIOD':
      return { ...state, ui: { ...state.ui, gen: { ...state.ui.gen, period: action.period } } };
    case 'GEN_TOGGLE_TYPE': {
      const types = new Set(state.ui.gen.types);
      types.has(action.id) ? types.delete(action.id) : types.add(action.id);
      return { ...state, ui: { ...state.ui, gen: { ...state.ui.gen, types } } };
    }
    case 'BILL_PAID':
      return { ...state, bills: state.bills.map((b) => (b.no === action.no ? { ...b, status: 'paid' } : b)) };
    case 'SETTING_TOGGLE':
      return { ...state, settings: { ...state.settings, [action.key]: !state.settings[action.key] } };
    case 'LOG':
      return { ...state, log: [action.entry, ...state.log] };
    case 'API_DATA_LOADED': {
      const { apiClients, apiDocs, apiMsgs, apiTasks } = action.payload;
      
      // Map API Clients
      const mappedClients = Array.isArray(apiClients) ? apiClients.map((c: any) => ({
        id: c.id,
        name: c.name || '',
        entityType: c.entity_type || '',
        short: (c.name || 'CLI').substring(0, 3).toUpperCase(),
        city: 'Local',
        country: c.country_name || 'India',
        countryId: c.country_id || undefined,
        cur: (c.currency_code || 'INR') as any,
        gstin: c.gstin || '',
        pan: c.pan || '',
        svc: Array.isArray(c.filing_types) && c.filing_types.length ? c.filing_types : ['GST', 'Income Tax'],
        filingTypes: Array.isArray(c.filing_types) ? c.filing_types : [],
        contact: c.email || '',
        phone: c.phone || '',
        fee: 5000,
        tone: 'Professional',
        alias: []
      })) : state.clients;

      // Map Tasks
      const mappedTasks = apiTasks && apiTasks.length > 0 ? apiTasks.map((t: any) => ({
        id: t.id,
        client: t.clientId || mappedClients.find((c: any) => c.name === t.clientName)?.id || mappedClients[0]?.id,
        name: t.formType,
        cat: 'Compliance',
        due: new Date(t.dueDate || Date.now()),
        steps: [true, false, false, false]
      })) : state.tasks;

      // Map WhatsApp Messages
      const mappedThreads = { ...state.threads };
      if (apiMsgs && apiMsgs.length > 0) {
        apiMsgs.forEach((msg: any) => {
          if (!msg.clientId) return;
          const th = mappedThreads[msg.clientId] || [];
          th.push({
            id: typeof msg.id === 'number' ? msg.id : Math.floor(Math.random() * 100000),
            f: msg.direction === 'inbound' ? 'cl' : 'me',
            t: msg.body || (msg.messageType === 'document' ? '📄 Document' : ''),
            at: new Date(msg.timestamp || msg.created_at || Date.now()),
            st: 'delivered'
          });
          mappedThreads[msg.clientId] = th;
        });
      }

      // Map Documents to Vault Files
      const mappedFiles = Array.isArray(apiDocs) ? [] : [...state.files];
      if (Array.isArray(apiDocs)) {
        apiDocs.forEach((d: any) => {
          if (!d.clientId) return;
          mappedFiles.push({
            id: d.id,
            client: d.clientId,
            year: new Date(d.uploadDate || d.created_at || Date.now()).getFullYear(),
            mo: new Date(d.uploadDate || d.created_at || Date.now()).getMonth(),
            bucket: d.status === 'Extracted' ? 'Extracted' : 'Raw',
            name: d.fileName || 'document.pdf',
            size: d.fileSize || d.file_size_kb || 100,
            at: new Date(d.uploadDate || d.created_at || Date.now()),
            src: d.source || 'Manual',
            docId: d.id
          });
        });
      }

      const newUi = { ...state.ui };
      if (mappedClients.length > 0) {
        const firstId = mappedClients[0].id;
        const fallbackId = (id: string) => mappedClients.find((c: any) => c.id === id) ? id : firstId;
        
        if (!mappedClients.find((c: any) => c.id === newUi.wa.client)) newUi.wa.client = firstId;
        if (!mappedClients.find((c: any) => c.id === newUi.gen.client)) newUi.gen.client = firstId;

        // Fix broken references in mock data so the UI doesn't crash!
        const mappedDocs = state.docs.map(d => ({ ...d, client: fallbackId(d.client) }));
        const mappedReminders = state.reminders.map(r => ({ ...r, client: fallbackId(r.client) }));
        const mappedBills = state.bills.map(b => ({ ...b, client: fallbackId(b.client) }));
        const mappedChecks = Object.fromEntries(Object.entries(state.checks).map(([k, v]) => [fallbackId(k), v]));

        return {
          ...state,
          clients: mappedClients,
          tasks: mappedTasks,
          threads: mappedThreads,
          files: mappedFiles,
          docs: mappedDocs,
          reminders: mappedReminders,
          bills: mappedBills,
          checks: mappedChecks,
          ui: newUi
        };
      }

      return {
        ...state,
        clients: mappedClients,
        docs: [],
        tasks: [],
        reminders: [],
        bills: [],
        checks: {},
        threads: {},
        files: [],
        ui: newUi
      };
    }
    default:
      return state;
  }
}

const StateCtx = createContext<AppState>(initialState);
const DispatchCtx = createContext<React.Dispatch<Action>>(() => {});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  React.useEffect(() => {
    async function loadData() {
      try {
        const rawSession = localStorage.getItem('taxflow_session');
        const savedSession = rawSession ? JSON.parse(rawSession) : null;
        if (!state.currentUser || !savedSession?.token) return;
        if (savedSession?.token) {
          const sessionCheck = await apiGetMe();
          if (!sessionCheck.success || !sessionCheck.user) {
            dispatch({ type: 'LOGOUT' });
            return;
          }
          dispatch({ type: 'LOGIN', user: sessionCheck.user, token: savedSession.token, refreshToken: savedSession.refreshToken });
        }

        const [apiClients, apiDocs, apiMsgs, apiTasks] = await Promise.all([
          fetchClients(),
          fetchDocuments(),
          fetchWhatsAppMessages(),
          fetchComplianceTasks()
        ]);
        
        dispatch({
          type: 'API_DATA_LOADED',
          payload: { apiClients, apiDocs, apiMsgs, apiTasks }
        });
      } catch (err) {
        console.error("Failed to load API data", err);
      }
    }
    loadData();
  }, [state.currentUser?.id]);

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export const useAppState = () => useContext(StateCtx);
export const useDispatch = () => useContext(DispatchCtx);

// Convenience selectors
export function useClient(id: string) {
  const s = useAppState();
  return s.clients.find((c) => c.id === id)!;
}
