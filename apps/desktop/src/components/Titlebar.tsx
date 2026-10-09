import { useState, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { ThemeToggle } from './ThemeToggle';
import { useAppState, useDispatch } from '../state/store';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function Titlebar() {
  const s = useAppState();
  const dispatch = useDispatch();
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    async function initWindow() {
      try {
        const appWin = getCurrentWindow();
        setIsMaximized(await appWin.isMaximized());
        unlisten = await appWin.onResized(async () => {
          try { setIsMaximized(await appWin.isMaximized()); } catch {}
        });
      } catch {}
    }
    initWindow();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Close search dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node) &&
          searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleMinimize = async () => {
    try { await getCurrentWindow().minimize(); } catch (e) {
      console.warn('Minimize failed:', e);
    }
  };
  const handleMaximize = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
      setIsMaximized(await getCurrentWindow().isMaximized());
    } catch (e) { console.warn('Maximize failed:', e); }
  };
  const handleClose = async () => {
    try { await getCurrentWindow().close(); } catch (e) {
      console.warn('Close failed:', e);
    }
  };

  const results = q.trim()
    ? s.clients
        .filter(
          (c) =>
            c.name.toLowerCase().includes(q.toLowerCase()) ||
            c.gstin.toLowerCase().includes(q.toLowerCase())
        )
        .slice(0, 6)
    : [];

  return (
    <header className="titlebar" data-tauri-drag-region>
      {/* Brand */}
      <div className="brand" data-tauri-drag-region>
        <span className="logo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
          </svg>
        </span>
        <span className="brand-name">Taxflow<span className="brand-dot">.</span>AI</span>
        <small className="brand-badge">CA Suite</small>
      </div>

      {/* Search Bar */}
      <div className={`gsearch${focused || results.length > 0 ? ' focused' : ''}`}>
        <span className="gi">
          <Icon name="search" size={14} />
        </span>
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="Search clients, invoices, files…"
          autoComplete="off"
          aria-label="Search workspace"
          aria-expanded={results.length > 0}
          aria-haspopup="listbox"
        />
        {q && (
          <button
            className="gsearch-clear"
            onClick={() => { setQ(''); searchRef.current?.focus(); }}
            aria-label="Clear search"
          >
            <svg width="11" height="11" viewBox="0 0 12 12">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {results.length > 0 && (
          <div className="gres" ref={dropRef} role="listbox">
            {results.map((c) => (
              <button
                key={c.id}
                role="option"
                onClick={() => {
                  dispatch({ type: 'WA_CLIENT', id: c.id });
                  dispatch({ type: 'GO', page: 'whatsapp' });
                  setQ('');
                  setFocused(false);
                }}
              >
                <span className="gres-av" style={{ background: 'var(--accent-alpha)' }}>
                  {c.short}
                </span>
                <span className="gres-info">
                  <b>{c.name}</b>
                  <small>{c.city} · {c.gstin || 'No GSTIN'}</small>
                </span>
                <span className="gres-arrow">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Drag space */}
      <div data-tauri-drag-region className="titlebar-drag-space" />

      {/* Right Controls */}
      <div className="wc">
        {/* Notifications */}
        <button className="wc-action-btn wc-notif" title="Notifications" aria-label="Notifications">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span className="notif-dot" />
        </button>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* AI Chat Toggle */}
        <button
          className={`wc-action-btn wc-chat-btn${s.chatOpen ? ' active' : ''}`}
          onClick={() => dispatch({ type: 'TOGGLE_CHAT' })}
          title={s.chatOpen ? 'Hide AI assistant' : 'Show AI assistant'}
          aria-label="Toggle AI assistant"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          {s.chatOpen && <span className="wc-chat-active-dot" />}
        </button>

        {/* Divider */}
        <div className="wc-divider" />

        {/* Window Controls */}
        <button className="wc-btn wc-min" onClick={handleMinimize} title="Minimize" aria-label="Minimize">
          <svg width="11" height="11" viewBox="0 0 12 12">
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="wc-btn wc-max"
          onClick={handleMaximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="1.5" width="7" height="7" rx="1.2" />
              <path d="M1.5 4.5v5a1.2 1.2 0 0 0 1.2 1.2h5" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="8" height="8" rx="1.5" />
            </svg>
          )}
        </button>
        <button className="wc-btn wc-close" onClick={handleClose} title="Close" aria-label="Close">
          <svg width="11" height="11" viewBox="0 0 12 12">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
