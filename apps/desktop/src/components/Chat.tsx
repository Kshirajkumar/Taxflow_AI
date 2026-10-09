import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useAppState, useDispatch } from '../state/store';
import { allTasks, missing } from '../lib/domain';
import { fDate } from '../lib/format';
import type { Page } from '../types';

interface Msg { id: number; who: 'me' | 'ai'; html: string; ts: Date }
let MID = 1;

const SUGG = [
  { label: 'Due this week', icon: 'cal' },
  { label: 'Missing documents', icon: 'folder' },
  { label: 'Queued invoices', icon: 'scan' },
  { label: 'Outstanding fees', icon: 'rupee' },
  { label: 'Client overview', icon: 'users' },
];

export function Chat() {
  const s = useAppState();
  const dispatch = useDispatch();
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      id: MID++,
      who: 'ai',
      html: 'Hello! I\'m your <b>Taxflow AI Assistant</b>. Ask me about deadlines, missing documents, invoices, client folders or fees — I\'ll navigate you there instantly.',
      ts: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (boxRef.current) {
      boxRef.current.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [msgs.length, isTyping]);

  function go(page: Page, label: string) {
    dispatch({ type: 'GO', page });
    return `<div class="chat-action-link"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg> Opened <b>${label}</b></div>`;
  }

  function detectClient(q: string) {
    const t = q.toLowerCase();
    return s.clients.find(
      (c) => c.alias.some((a) => new RegExp(`\\b${a}\\b`).test(t)) || t.includes(c.name.toLowerCase())
    );
  }

  function answer(q: string): string {
    const t = q.toLowerCase();
    const c = detectClient(q);
    const ti = allTasks(s.tasks);

    if (/missing|not sent|pending doc/.test(t)) {
      const m = s.clients.filter((x) => missing(s.checks, x.id).length);
      const opened = go('whatsapp', 'WhatsApp');
      return `<b>${m.length} of ${s.clients.length} clients</b> still owe documents:<ul>${m.map((x) => `<li><b>${x.short}</b>: ${missing(s.checks, x.id).map((y) => y.n).join(', ')}</li>`).join('')}</ul>${opened}`;
    }
    if (/extract|invoice|bill\b|scan|queue/.test(t)) {
      const q1 = s.docs.filter((d) => d.status === 'queued');
      const opened = go('extract', 'Invoice Extraction');
      return `There ${q1.length === 1 ? 'is' : 'are'} <b>${q1.length}</b> invoice${q1.length === 1 ? '' : 's'} queued for extraction.${opened}`;
    }
    if (/folder|files|vault|storage/.test(t)) {
      const cc = c || s.clients[0];
      const opened = go('files', 'Client Folders');
      const fl = s.files.filter((f) => f.client === cc.id);
      return `<b>${cc.name}</b> has ${fl.length} files on record.${opened}`;
    }
    if (/whatsapp|chat|message/.test(t)) {
      if (c) dispatch({ type: 'WA_CLIENT', id: c.id });
      const opened = go('whatsapp', 'WhatsApp');
      return c ? `Here is the conversation with <b>${c.name}</b>.${opened}` : `Here are all your client chats.${opened}`;
    }
    if (/fee|billing|outstanding|payment/.test(t)) {
      const opened = go('billing', 'Billing & Fees');
      const ov = s.bills.filter((b) => b.status === 'overdue');
      return `<b>${ov.length}</b> fee invoices are overdue.${opened}`;
    }
    if (/deadline|due|overdue|progress|filing|week/.test(t)) {
      const opened = go('deadlines', 'Deadlines');
      const list = ti.filter((x) => x.st !== 'done' && x.days <= 7).sort((a, b) => a.days - b.days);
      return `<b>${list.length}</b> filings are due within 7 days or overdue.${opened}`;
    }
    if (/generate|gstr|itr|tds|vat|register/.test(t)) {
      const opened = go('generate', 'File Generator');
      return `Opening the file generator for you.${opened}`;
    }
    if (/client|clients|overview/.test(t)) {
      const opened = go('clients', 'Clients');
      return `You have <b>${s.clients.length}</b> active clients.${opened}`;
    }
    const over = ti.filter((x) => x.st === 'overdue').length;
    const week = ti.filter((x) => x.st !== 'done' && x.days >= 0 && x.days <= 7).length;
    const opened = go('dashboard', 'Dashboard');
    return `Today: <b>${over} overdue</b>, <b>${week}</b> filings due within 7 days.${opened}`;
  }

  function ask(q: string) {
    q = q.trim();
    if (!q) return;
    const userMsg: Msg = { id: MID++, who: 'me', html: q, ts: new Date() };
    setMsgs((m) => [...m, userMsg]);
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setMsgs((m) => [...m, { id: MID++, who: 'ai', html: answer(q), ts: new Date() }]);
    }, 700 + Math.random() * 400);
  }

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <aside className="chat" aria-label="AI Assistant">
      {/* Header */}
      <div className="ch-h">
        <div className="ch-h-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          <span className="ch-h-pulse" />
        </div>
        <div className="ch-h-text">
          <b>Taxflow Assistant</b>
          <small><span className="online-dot" />AI · Always available</small>
        </div>
        <button
          className="ch-close-btn"
          onClick={() => dispatch({ type: 'TOGGLE_CHAT' })}
          title="Close assistant"
          aria-label="Close assistant"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="ch-msgs" ref={boxRef} id="ai-msgs">
        {msgs.map((m) => (
          <div key={m.id} className={`cm-wrap ${m.who}`}>
            {m.who === 'ai' && (
              <div className="cm-avatar">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
            )}
            <div className="cm-bubble-group">
              <div
                className={'cm ' + (m.who === 'me' ? 'me' : 'ai')}
                dangerouslySetInnerHTML={{ __html: m.html }}
              />
              <span className="cm-time">{formatTime(m.ts)}</span>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isTyping && (
          <div className="cm-wrap ai">
            <div className="cm-avatar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
            <div className="cm-bubble-group">
              <div className="cm ai typing-indicator">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Suggestions */}
      <div className="sugg">
        <div className="sugg-label">Quick actions</div>
        <div className="sugg-list">
          {SUGG.map((q) => (
            <button key={q.label} onClick={() => { ask(q.label); }} className="sugg-btn">
              <Icon name={q.icon} size={12} />
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="ch-f">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(input);
              setInput('');
            }
          }}
          placeholder="Ask about clients, deadlines, fees…"
          aria-label="Chat input"
        />
        <button
          className="ch-send"
          onClick={() => { ask(input); setInput(''); }}
          aria-label="Send message"
          disabled={!input.trim()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
