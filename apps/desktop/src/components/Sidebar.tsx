import { Icon } from './Icon';
import { useAppState, useDispatch } from '../state/store';
import type { Page } from '../types';
import { allTasks } from '../lib/domain';
import { dayDiff, vnow } from '../lib/format';

const NAV: Array<{ g: string; items: Array<[Page, string, string]> }> = [
  { g: 'Workspace', items: [['dashboard', 'Dashboard', 'grid']] },
  {
    g: 'Automation',
    items: [
      ['extract', 'Invoice Extraction', 'scan'],
      ['whatsapp', 'WhatsApp', 'chat'],
      ['files', 'Client Folders', 'folder'],
      ['deadlines', 'Deadlines', 'cal'],
      ['generate', 'File Generator', 'spark'],
    ],
  },
  {
    g: 'Practice',
    items: [
      ['clients', 'Clients', 'users'],
      ['billing', 'Billing & Fees', 'rupee'],
      ['settings', 'Settings', 'sliders'],
    ],
  },
];

export function Sidebar() {
  const s = useAppState();
  const dispatch = useDispatch();
  const collapsed = s.sidebarCollapsed;

  const badge = (id: Page): { n: number; hot?: boolean } | null => {
    if (id === 'extract') {
      const n = s.docs.filter((d) => d.status === 'queued' || d.status === 'review').length;
      return n ? { n } : null;
    }
    if (id === 'whatsapp') {
      const n = s.reminders.filter((r) => r.status === 'scheduled' && dayDiff(r.at, vnow()) === 0).length;
      return n ? { n } : null;
    }
    if (id === 'deadlines') {
      const n = allTasks(s.tasks).filter((x) => x.st === 'overdue').length;
      return n ? { n, hot: true } : null;
    }
    return null;
  };

  const initials = s.currentUser?.name
    ? s.currentUser.name.split(' ').filter(Boolean).map((n) => n[0]).join('').substring(0, 2).toUpperCase()
    : 'CA';

  return (
    <nav className={`side${collapsed ? ' collapsed' : ''}`} aria-label="Pages">
      {/* Collapse Toggle Button */}
      <button
        className="sidebar-toggle"
        onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <span className="sidebar-toggle-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {collapsed ? (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="15" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </span>
        {!collapsed && <span className="sidebar-toggle-label">Collapse</span>}
      </button>

      {/* Navigation Groups */}
      {NAV.map((g) => (
        <div key={g.g} className="nav-group">
          {!collapsed && <div className="gtitle">{g.g}</div>}
          {g.items.map(([id, label, icon]) => {
            const b = badge(id);
            const isActive = s.page === id;
            return (
              <button
                key={id}
                className={'nav' + (isActive ? ' on' : '')}
                onClick={() => dispatch({ type: 'GO', page: id })}
                title={collapsed ? `${label}${b ? ` (${b.n})` : ''}` : undefined}
                aria-label={label}
              >
                <span className="nav-icon">
                  <Icon name={icon} size={18} />
                </span>
                {!collapsed && <span className="lb">{label}</span>}
                {b && <span className={'bd' + (b.hot ? ' hot' : '')}>{b.n}</span>}
                {isActive && <span className="nav-active-bar" />}
              </button>
            );
          })}
        </div>
      ))}

      {/* Storage Vault */}
      <div className="vault">
        {collapsed ? (
          <div className="vault-icon-collapsed" title="Local Vault: 3.2 GB used of 500 GB">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
            <div className="vault-bar-mini">
              <i style={{ width: `${(3.2 + s.files.length / 1000) / 5 * 100}%` }} />
            </div>
          </div>
        ) : (
          <>
            <div className="vault-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
              <b>Local Vault</b>
            </div>
            <span className="vault-path">D:\Taxflow · {(3.2 + s.files.length / 1000).toFixed(1)} GB of 500 GB</span>
            <div className="bar" style={{ marginTop: 8 }}>
              <i style={{ width: `${(3.2 + s.files.length / 1000) / 5 * 100}%` }} />
            </div>
          </>
        )}
      </div>

      {/* User Profile */}
      <div className="me" title={collapsed ? (s.currentUser?.firmName || s.currentUser?.name || 'Demo Practice') : undefined}>
        <div className="me-avatar-wrap">
          <span className="av" style={{ ['--t' as any]: '#4C8DFF' }}>
            {initials}
          </span>
          <span className="me-status-dot" title="Online" />
        </div>
        {!collapsed && (
          <div className="me-info">
            <b className="me-name">
              {s.currentUser?.firmName || s.currentUser?.name || 'Demo Practice'}
            </b>
            <small className="me-role">
              {s.currentUser?.role || 'Managing Partner'}
            </small>
          </div>
        )}
        <button
          type="button"
          className="logout-btn"
          onClick={() => dispatch({ type: 'LOGOUT' })}
          title="Sign out"
          aria-label="Sign out"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </nav>
  );
}
