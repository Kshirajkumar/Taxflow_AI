import { useEffect, useRef, useState, useCallback } from 'react';
import { Icon } from '../components/Icon';
import {
  createTelegramLink,
  fetchTelegramMessages,
  fetchTelegramStatus,
  sendTelegramMessage,
  fetchTelegramUnread,
  fetchTelegramPreviews,
  markTelegramClientRead,
  fetchWhatsAppStatus,
  sendWhatsAppManualMessage,
  type TelegramMessage,
  type TelegramPreview,
} from '../lib/api';
import { useAppState, useDispatch } from '../state/store';
import { nextMsgId } from '../lib/messageIds';
import { TPL } from '../data/seed';
import { missing } from '../lib/domain';
import { fDate, fTime, fDT, until, agoT, dayDiff, vnow, toInput } from '../lib/format';
import type { ChatMsg, Reminder } from '../types';

function dayLabel(d: Date) {
  const n = dayDiff(vnow(), d);
  return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : fDate(d);
}

function fillTpl(body: string, name: string) {
  return body.replace(/\{(\w+)\}/g, (_, k) => (k === 'name' ? name : k === 'period' ? 'August 2026' : k === 'due' ? '20 Sep 2026' : k === 'filing' ? 'GSTR-3B' : k === 'doc' ? 'bank statement' : '—'));
}

export function WhatsAppPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const [channel, setChannel] = useState<'whatsapp' | 'telegram'>('telegram');
  const [input, setInput] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [telegramMessages, setTelegramMessages] = useState<TelegramMessage[]>([]);
  const [telegramReady, setTelegramReady] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramBot, setTelegramBot] = useState('');
  const [telegramError, setTelegramError] = useState('');
  const [telegramInfo, setTelegramInfo] = useState('');
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [telegramSending, setTelegramSending] = useState(false);
  const [telegramDraft, setTelegramDraft] = useState('');
  const [telegramRequestId, setTelegramRequestId] = useState('');
  const [telegramRetry, setTelegramRetry] = useState(0);
  /** Text staged inline in the thread waiting for approval — NOT yet sent */
  const [pendingTelegramMsg, setPendingTelegramMsg] = useState('');
  /** Whether the approval card is currently in inline-edit mode */
  const [isEditingPending, setIsEditingPending] = useState(false);
  /** Holds the in-progress edit text while editing mode is active */
  const [editText, setEditText] = useState('');
  /** Unread counts mapped by client_id */
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [telegramPreviews, setTelegramPreviews] = useState<Record<string, TelegramPreview>>({});
  /** Total unread messages across all clients */
  const [totalUnreadAcrossClients, setTotalUnreadAcrossClients] = useState(0);
  /** WhatsApp status state */
  const [whatsAppReady, setWhatsAppReady] = useState(false);
  const [whatsAppLoading, setWhatsAppLoading] = useState(false);
  const [whatsAppError, setWhatsAppError] = useState('');
  const [whatsAppSending, setWhatsAppSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const c = s.clients.find((x) => x.id === s.ui.wa.client) || s.clients[0];
  const thread = c ? (s.threads[c.id] || []).slice().sort((a, b) => a.at.getTime() - b.at.getTime()) : [];
  const clientIds = s.clients.map((client) => client.id).join(',');

  const loadUnreadCounts = useCallback(async () => {
    try {
      const summary = await fetchTelegramUnread();
      setUnreadCounts(summary.counts || {});
      setTotalUnreadAcrossClients(summary.total || 0);
    } catch (error) {
      console.warn('Failed to refresh unread Telegram counts', error);
    }
  }, []);

  useEffect(() => {
    void loadUnreadCounts();
    const timer = window.setInterval(() => void loadUnreadCounts(), 5000);
    return () => window.clearInterval(timer);
  }, [loadUnreadCounts]);

  useEffect(() => {
    if (channel === 'telegram' && c?.id && unreadCounts[c.id]) {
      void markTelegramClientRead(c.id).then(() => {
        setUnreadCounts((prev) => {
          if (!prev[c.id]) return prev;
          const next = { ...prev, [c.id]: 0 };
          const total = Object.values(next).reduce((a, b) => a + b, 0);
          setTotalUnreadAcrossClients(total);
          return next;
        });
        window.dispatchEvent(new CustomEvent('taxflow:unread-updated'));
      }).catch((error) => {
        console.warn('Failed to mark Telegram messages as read', error);
      });
    }
  }, [channel, c?.id, unreadCounts[c?.id || '']]);

  useEffect(() => {
    if (channel !== 'telegram') return undefined;
    let active = true;
    const load = async () => {
      try {
        const previews = await fetchTelegramPreviews();
        if (active) setTelegramPreviews(previews);
      } catch (error) {
        console.warn('Failed to refresh Telegram message previews', error);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [channel, clientIds]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [thread.length, telegramMessages.length, s.ui.wa.tab]);

  useEffect(() => {
    if (channel !== 'telegram' || !c) { setTelegramMessages([]); setTelegramLinked(false); return undefined; }
    let active = true;
    const load = async (showLoading = false) => {
      if (active && showLoading) setTelegramLoading(true);
      try { const [status, conversation] = await Promise.all([fetchTelegramStatus(), fetchTelegramMessages(c.id)]); if (active) { setTelegramReady(status.connected); setTelegramLinked(conversation.linked); setTelegramBot(status.bot?.username || ''); setTelegramMessages(conversation.messages); setTelegramError(''); } }
      catch (error) { if (active) { setTelegramReady(false); setTelegramLinked(false); setTelegramError(error instanceof Error ? error.message : 'Telegram is unavailable.'); } }
      finally { if (active) setTelegramLoading(false); }
    };
    void load(true); const timer = window.setInterval(() => void load(), 4000); return () => { active = false; window.clearInterval(timer); };
  }, [channel, c?.id, telegramRetry]);

  useEffect(() => {
    if (channel !== 'whatsapp') return;
    let active = true;
    setWhatsAppLoading(true);
    void fetchWhatsAppStatus().then((status) => {
      if (!active) return;
      setWhatsAppReady(status.connected);
      if (!status.connected) {
        setWhatsAppError(status.message || 'WhatsApp Cloud API is not configured on this server.');
      } else {
        setWhatsAppError('');
      }
      setWhatsAppLoading(false);
    });
    return () => { active = false; };
  }, [channel]);

  async function connectTelegram() {
    if (telegramConnecting) return;
    setTelegramConnecting(true);
    setTelegramError('');
    setTelegramInfo('');
    try {
      const result = await createTelegramLink(c.id);
      try { await navigator.clipboard?.writeText(result.link); } catch { /* Clipboard access is optional. */ }
      const opened = window.open(result.link, '_blank', 'noopener,noreferrer');
      setTelegramInfo(opened ? `Connection link opened. It expires at ${new Date(result.expiresAt).toLocaleTimeString()}.` : `Connection link copied. Open it in Telegram before ${new Date(result.expiresAt).toLocaleTimeString()}.`);
    } catch (error) {
      setTelegramError(error instanceof Error ? error.message : 'Unable to create Telegram connection link.');
    } finally {
      setTelegramConnecting(false);
    }
  }

  function requestTelegramSend() {
    const text = input.trim();
    if (!text || telegramSending || pendingTelegramMsg) return;
    if (!telegramReady || !telegramLinked) {
      setTelegramError('Telegram is not ready or this client is not linked. Please check the connection and try again.');
      return;
    }
    setTelegramError('');
    setTelegramInfo('');
    setTelegramRequestId(crypto.randomUUID());
    setTelegramDraft(text);
    setPendingTelegramMsg(text);
    setInput('');
  }

  async function confirmTelegramSend() {
    if (!telegramDraft || telegramSending) return;
    setTelegramSending(true);
    setTelegramError('');
    setTelegramInfo('Sending securely through Telegram…');
    try {
      await sendTelegramMessage(c.id, telegramDraft, telegramRequestId || crypto.randomUUID());
      setPendingTelegramMsg('');
      setTelegramDraft('');
      setTelegramRequestId('');
      setTelegramInfo('Message sent through Telegram.');
      setTelegramSending(false);

      try {
        const conversation = await fetchTelegramMessages(c.id);
        setTelegramLinked(conversation.linked);
        setTelegramMessages(conversation.messages);
        try {
          setTelegramPreviews(await fetchTelegramPreviews());
        } catch (error) {
          console.warn('Failed to refresh Telegram preview after sending', error);
        }
      } catch {
        setTelegramInfo('Message sent through Telegram. The conversation could not refresh; it will update automatically when the connection recovers.');
      }
    } catch (error) {
      setTelegramInfo('');
      setTelegramError(error instanceof Error ? error.message : 'Unable to send Telegram message. Please try again.');
    } finally {
      setTelegramSending(false);
    }
  }

  function cancelTelegramPending() {
    setPendingTelegramMsg('');
    setTelegramDraft('');
    setTelegramRequestId('');
    setTelegramError('');
    setTelegramInfo('');
    setIsEditingPending(false);
    setEditText('');
  }

  /** Enter inline-edit mode for the pending message */
  const startEditingPending = useCallback(() => {
    setEditText(pendingTelegramMsg);
    setIsEditingPending(true);
    // Focus the textarea on next paint
    requestAnimationFrame(() => editTextareaRef.current?.focus());
  }, [pendingTelegramMsg]);

  /** Commit the edited text — updates both the visible bubble and the draft to be sent */
  function commitEdit() {
    const trimmed = editText.trim();
    if (!trimmed) return; // guard: empty message not allowed
    setPendingTelegramMsg(trimmed);
    setTelegramDraft(trimmed);
    // Regenerate request ID so a re-edit can't collide with a previous idempotency key
    setTelegramRequestId(crypto.randomUUID());
    setIsEditingPending(false);
    setEditText('');
  }

  /** Abort inline-edit and return to the approval view without changing anything */
  function abortEdit() {
    setIsEditingPending(false);
    setEditText('');
  }

  if (!c) {
    return (
      <>
        <div className="ph"><div><h1>Client Inbox</h1><p>WhatsApp and Telegram client conversations in one place, with the reminders that will go out next.</p></div><div className="ph-a"><label className="f" htmlFor="inbox-channel-empty">Channel</label><select id="inbox-channel-empty" className="sel" style={{ width: 160 }} value={channel} onChange={(e) => setChannel(e.target.value as 'whatsapp' | 'telegram')}><option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option></select></div></div>
        <div className="card workspace-empty workspace-empty-inbox">
          <div className="workspace-empty-visual"><span className="workspace-empty-ring ring-one" /><span className="workspace-empty-ring ring-two" /><span className="workspace-empty-orb"><Icon name="chat" size={30} /></span><span className="workspace-empty-float float-one"><Icon name="send" size={14} /></span><span className="workspace-empty-float float-two"><Icon name="bell" size={14} /></span></div>
          <div className="workspace-empty-copy"><span className="eyebrow">A QUIET INBOX IS A CLEAN START</span><h2>Your client conversations will appear here</h2><p>Once a client is added, chats, reminders, and approved message templates will stay together in one focused workspace.</p><button className="btn pri" onClick={() => dispatch({ type: 'GO', page: 'clients' })}><Icon name="users" size={14} />Add your first client</button></div>
          <div className="workspace-empty-note"><Icon name="check" size={16} /><div><b>Ready for WhatsApp and Telegram</b><span>Choose a channel when your first client is ready.</span></div></div>
        </div>
      </>
    );
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    if (channel === 'telegram') {
      requestTelegramSend();
      return;
    }
    if (channel === 'whatsapp') {
      if (!whatsAppReady) {
        setWhatsAppError('WhatsApp Cloud API is not configured on this server. Please use Telegram or configure WhatsApp credentials in backend .env.');
        return;
      }
      setWhatsAppSending(true);
      setWhatsAppError('');
      try {
        await sendWhatsAppManualMessage(c.id, c.phone, text);
        const msg: ChatMsg = { id: nextMsgId(), f: 'me', t: text, at: vnow(), st: 'sent' };
        dispatch({ type: 'WA_APPEND', client: c.id, msg });
        setInput('');
      } catch (err) {
        setWhatsAppError(err instanceof Error ? err.message : 'Failed to send WhatsApp message.');
      } finally {
        setWhatsAppSending(false);
      }
    }
  }

  const scheduled = s.reminders.filter((r) => r.status === 'scheduled').sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <>
      <div className="ph">
        <div><h1>Client Inbox</h1><p>WhatsApp and Telegram client conversations in one place, with the reminders that will go out next.</p></div>
        <div className="ph-a"><button className="btn pri" onClick={() => setShowSchedule(true)}><Icon name="plus" size={14} />Schedule reminder</button></div>
      </div>

      <div className="card wa-top">
        <label className="f" htmlFor="inbox-channel">Channel</label>
        <select id="inbox-channel" className="sel" style={{ width: 160 }} value={channel} onChange={(e) => setChannel(e.target.value as 'whatsapp' | 'telegram')}>
          <option value="telegram">Telegram</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
        {channel === 'telegram' && (
          <>
            <span className={'chip ' + (telegramLoading ? 'amber' : telegramReady ? 'green' : 'amber')}>
              <i className="sdot" style={{ margin: '0 2px 0 0' }} />
              {telegramLoading ? 'Checking Telegram…' : telegramReady ? `Telegram @${telegramBot}` : 'Telegram unavailable'}
            </span>
            <span className={'chip ' + (telegramLinked ? 'green' : 'amber')}>
              {telegramLinked ? 'Client linked' : 'Client not linked'}
            </span>
            {totalUnreadAcrossClients > 0 && (
              <span className="chip wa-total-unread-pill" title={`${totalUnreadAcrossClients} unread message${totalUnreadAcrossClients > 1 ? 's' : ''} across all connected clients`}>
                <span className="wa-unread-glow-dot" />
                {totalUnreadAcrossClients} unread {totalUnreadAcrossClients === 1 ? 'message' : 'messages'}
              </span>
            )}
            <button className="btn sm" onClick={() => void connectTelegram()} disabled={telegramLoading || telegramConnecting || !telegramReady}>
              {telegramConnecting && <span className="spin" />}
              {telegramConnecting ? 'Connecting…' : telegramLinked ? 'Reconnect client' : 'Connect client'}
            </button>
          </>
        )}
        {channel === 'whatsapp' && (
          <>
            <span className={'chip ' + (whatsAppLoading ? 'amber' : whatsAppReady ? 'green' : 'amber')}>
              <i className="sdot" style={{ margin: '0 2px 0 0' }} />
              {whatsAppLoading ? 'Checking WhatsApp…' : whatsAppReady ? 'WhatsApp Cloud API Connected' : 'WhatsApp API Not Configured'}
            </span>
            {!whatsAppReady && (
              <span className="mut2" style={{ fontSize: 11.5 }}>
                Missing Meta Cloud API credentials in backend
              </span>
            )}
          </>
        )}
      </div>

      <div className="tabs">
        {(['chats', 'reminders', 'templates'] as const).map((t) => (
          <button key={t} className={s.ui.wa.tab === t ? 'on' : ''} onClick={() => dispatch({ type: 'WA_TAB', tab: t })}>
            {t === 'chats' ? 'Chats' : t === 'reminders' ? `Scheduled reminders (${scheduled.length})` : 'Templates'}
          </button>
        ))}
      </div>

      {s.ui.wa.tab === 'chats' && (
        <div className="card wa">
          <div className="wa-l">
            {s.clients.map((cl) => {
              const th = s.threads[cl.id] || [];
              const whatsappLast = th
                .filter((message) => message.f !== 'sys')
                .reduce<ChatMsg | undefined>((latest, message) => (
                  !latest || message.at > latest.at ? message : latest
                ), undefined);
              const telegramLast = telegramPreviews[cl.id];
              const previewText = channel === 'telegram'
                ? telegramLast?.body
                : whatsappLast?.file ? `Attachment: ${whatsappLast.file}` : whatsappLast?.t;
              const previewAt = channel === 'telegram'
                ? telegramLast?.created_at ? new Date(telegramLast.created_at) : undefined
                : whatsappLast?.at;
              const m = missing(s.checks, cl.id).length;
              const clUnread = unreadCounts[cl.id] || 0;
              const clientPreview = clUnread > 0
                ? `${clUnread} New Message${clUnread === 1 ? '' : 's'}`
                : previewText || 'No messages yet';
              const isSelected = s.ui.wa.client === cl.id;
              return (
                <div
                  key={cl.id}
                  className={'wa-c' + (isSelected ? ' on' : '') + (clUnread > 0 ? ' has-unread' : '')}
                  onClick={() => {
                    dispatch({ type: 'WA_CLIENT', id: cl.id });
                  }}
                >
                  <span className="av" style={{ ['--t' as any]: cl.tone }}>
                    {cl.short.slice(0, 2).toUpperCase()}
                    {clUnread > 0 && <span className="wa-c-unread-dot" />}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row">
                      <span className={'nm' + (clUnread > 0 ? ' unread-nm' : '')}>{cl.short}</span>
                      <span className="sp" />
                      <span className="tm">{previewAt ? agoT(previewAt) : ''}</span>
                    </div>
                    <div className="row">
                      <span className={'pv' + (clUnread > 0 ? ' unread-pv' : '')} title={clientPreview}>
                        {clientPreview}
                      </span>
                      {clUnread > 0 ? (
                        <span className="wa-unread-chip" title={`${clUnread} unread Telegram message${clUnread > 1 ? 's' : ''}`} aria-label={`${clUnread} unread Telegram message${clUnread > 1 ? 's' : ''}`}>
                          {clUnread}
                        </span>
                      ) : m ? (
                        <span className="chip amber" style={{ marginLeft: 'auto', padding: '0 7px' }}>{m}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="wa-r">
            <div className="wa-h">
              <div className="row">
                <span className="av lg" style={{ ['--t' as any]: c.tone }}>{c.short.slice(0, 2).toUpperCase()}</span>
                <div><b>{c.name}</b><div className="mut" style={{ fontSize: 12 }}>{c.contact} · {c.phone}</div></div>
                <span className="sp" />
              </div>
              <div className="ckl">
                {s.checks[c.id]?.map((x, i) => (
                  <span key={i} className={'chip ' + (x.ok ? 'green' : 'amber')}><Icon name={x.ok ? 'check' : 'clock'} size={12} />{x.n}</span>
                ))}
              </div>
            </div>
            <div id="wa-thread" ref={threadRef}>
              {channel === 'whatsapp' && (!whatsAppReady || whatsAppError) && (
                <div className="empty whatsapp-state error">
                  <b>WhatsApp API is not connected</b>
                  <span>{whatsAppError || 'WhatsApp Business API requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in the backend environment. Switch to Telegram to message clients with live two-way sync.'}</span>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button className="btn sm pri" onClick={() => setChannel('telegram')}>Switch to Telegram (Connected)</button>
                    {whatsAppError && <button className="btn sm" onClick={() => setWhatsAppError('')}>Dismiss</button>}
                  </div>
                </div>
              )}
              {channel === 'telegram' && telegramError && (
                <div className="empty telegram-state error">
                  <b>Telegram action needs attention</b>
                  <span>{telegramError}</span>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button className="btn sm" onClick={() => { setTelegramError(''); setTelegramRetry((value) => value + 1); }}>Retry connection</button>
                    {/session|expired|invalid|unauthorized|log in/i.test(telegramError) && (
                      <button className="btn sm pri" onClick={() => dispatch({ type: 'LOGOUT' })}>Log in again</button>
                    )}
                  </div>
                </div>
              )}
              {channel === 'telegram' && telegramInfo && <div className="telegram-notice">{telegramInfo}</div>}
              {channel === 'telegram' && telegramMessages.map((m) => <div key={m.id} className={'msg ' + (m.direction === 'outbound' ? 'me' : 'cl')}><div>{m.body}</div><span className="mt">{fTime(new Date(m.created_at))} · {m.delivery_status}</span></div>)}
              {channel === 'telegram' && pendingTelegramMsg && (
                <div className="tg-pending-group">

                  {/* ── Message bubble (muted while pending / editing) ── */}
                  <div className={`msg me tg-pending-bubble${isEditingPending ? ' tg-pending-bubble--editing' : ''}`}>
                    <div>{pendingTelegramMsg}</div>
                    <span className="mt">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display:'inline', verticalAlign:'middle', marginRight:3 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      {isEditingPending ? 'Editing…' : 'Pending approval'}
                    </span>
                  </div>

                  {/* ── Approval / Edit card ── */}
                  <div className={`tg-approval-card${isEditingPending ? ' tg-approval-card--editing' : ''}`}>

                    {isEditingPending ? (
                      /* ── EDIT MODE ── */
                      <>
                        <div className="tg-edit-header">
                          <span className="tg-approval-icon tg-approval-icon--edit">
                            {/* Pencil icon */}
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </span>
                          <div className="tg-approval-text">
                            <b>Edit your message</b>
                            <span>Press Enter or click Update to re-review. Shift + Enter adds a new line.</span>
                          </div>
                        </div>
                        <div className="tg-edit-body">
                          <textarea
                            ref={editTextareaRef}
                            className="tg-edit-textarea"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (editText.trim()) commitEdit();
                              } else if (e.key === 'Escape') {
                                abortEdit();
                              }
                            }}
                            rows={3}
                            maxLength={4096}
                            aria-label="Edit pending Telegram message"
                          />
                          {editText.trim() === '' && (
                            <p className="tg-edit-error">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                              Message cannot be empty.
                            </p>
                          )}
                        </div>
                        <div className="tg-approval-actions">
                          <button className="tg-cancel-btn" onClick={abortEdit}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                            Back
                          </button>
                          <button
                            className="tg-approve-btn tg-update-btn"
                            onClick={commitEdit}
                            disabled={!editText.trim()}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            Update
                          </button>
                        </div>
                      </>
                    ) : (
                      /* ── REVIEW MODE ── */
                      <>
                        <div className="tg-approval-header">
                          <span className="tg-approval-icon">
                            {/* Phone icon */}
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.65 3.47 2 2 0 0 1 3.62 1.27h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.72-.72a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                          </span>
                          <div className="tg-approval-text">
                            <b>Review before sending via Telegram</b>
                            <span>Message not delivered yet. Approve, edit, or discard.</span>
                          </div>
                        </div>
                        <div className="tg-approval-actions">
                          {/* Discard */}
                          <button className="tg-cancel-btn" onClick={cancelTelegramPending} disabled={telegramSending}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            Discard
                          </button>
                          {/* Edit */}
                          <button className="tg-edit-btn" onClick={startEditingPending} disabled={telegramSending}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            Edit
                          </button>
                          {/* Approve & Send */}
                          <button className="tg-approve-btn" onClick={() => void confirmTelegramSend()} disabled={telegramSending}>
                            {telegramSending
                              ? <><span className="tg-spin" />Sending…</>
                              : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Approve &amp; Send</>
                            }
                          </button>
                        </div>
                      </>
                    )}

                  </div>
                </div>
              )}

              {channel === 'whatsapp' && (() => {
                let last = '';
                return thread.map((m) => {
                  const dl = dayLabel(m.at);
                  const sep = dl !== last ? (last = dl, <div key={'sep' + m.id} className="dsep">{dl}</div>) : null;
                  return (
                    <>
                      {sep}
                      {m.f === 'sys' ? (
                        <div key={m.id} className="sys"><Icon name="bolt" size={12} />{m.t}</div>
                      ) : (
                        <div key={m.id} className={'msg ' + m.f}>
                          {m.file && (
                            <div className="att"><Icon name="file" size={18} /><div><div className="mono" style={{ fontSize: 11.5 }}>{m.file}</div><div style={{ fontSize: 10.5, opacity: 0.75 }}>Captured to client folder</div></div></div>
                          )}
                          {m.t}
                          <span className="mt">{fTime(m.at)}{m.auto ? ' · automated' : ''}</span>
                        </div>
                      )}
                    </>
                  );
                });
              })()}
              {channel === 'whatsapp' && scheduled.filter((r) => r.client === c.id).length > 0 && <div className="dsep">Scheduled</div>}
              {channel === 'whatsapp' && scheduled.filter((r) => r.client === c.id).map((r) => (
                <div key={r.id} className="msg me sched">
                  <div className="sh">
                    <Icon name="clock" size={13} /><span>{fDT(r.at)} · {until(r.at)}</span>
                    {r.approve ? <span className="chip amber">Needs your approval</span> : <span className="chip green">Auto-send</span>}
                  </div>
                  {r.text}
                  <div className="sa">
                    {r.approve && <button className="btn sm" onClick={() => dispatch({ type: 'REM_APPROVE', id: r.id })}>Approve</button>}
                    <button className="btn sm" onClick={() => dispatch({ type: 'REM_SEND_NOW', id: r.id })}>Send now</button>
                    <button className="btn sm gh" onClick={() => dispatch({ type: 'REM_CANCEL', id: r.id })}>Cancel</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="wa-f">
              <select
                className="sel"
                aria-label="Insert template"
                onChange={(e) => { if (e.target.value) { const t = TPL.find((x) => x.id === e.target.value)!; setInput(fillTpl(t.body, c.contact.split(' ')[0])); e.target.value = ''; } }}
              >
                <option value="">Insert template</option>
                {TPL.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input
                className="inp"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    channel === 'telegram' ? requestTelegramSend() : void send();
                  }
                }}
                placeholder={
                  channel === 'telegram'
                    ? pendingTelegramMsg || isEditingPending
                      ? isEditingPending
                        ? 'Finish editing the message above first…'
                        : 'Approve, edit, or discard the pending message first…'
                      : `Message ${c.contact.split(' ')[0]} via Telegram`
                    : whatsAppLoading
                      ? 'Checking WhatsApp API status…'
                      : !whatsAppReady
                        ? 'WhatsApp API not configured (switch to Telegram or add env vars)'
                        : `Message ${c.contact.split(' ')[0]} via WhatsApp`
                }
                disabled={
                  channel === 'telegram'
                    ? telegramSending || !!pendingTelegramMsg || isEditingPending
                    : whatsAppLoading || !whatsAppReady || whatsAppSending
                }
                aria-label="Message input"
              />
              <button
                className="btn pri"
                onClick={() => channel === 'telegram' ? requestTelegramSend() : void send()}
                disabled={
                  !input.trim() ||
                  (channel === 'telegram'
                    ? !telegramReady || !telegramLinked || telegramSending || telegramLoading || !!pendingTelegramMsg || isEditingPending
                    : whatsAppLoading || !whatsAppReady || whatsAppSending)
                }
                aria-label="Send message"
              >
                {(channel === 'telegram' && telegramSending) || (channel === 'whatsapp' && whatsAppSending) ? (
                  <span className="spin spin-light" />
                ) : (
                  <Icon name="send" size={15} />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {s.ui.wa.tab === 'reminders' && (
        <div className="tline">
          {scheduled.map((r) => {
            const cl = s.clients.find((x) => x.id === r.client)!;
            return (
              <div key={r.id} className="card rem">
                <div className="rt">{fTime(r.at)}<small>{until(r.at)}</small></div>
                <div style={{ minWidth: 0 }}>
                  <div className="row"><span className="av" style={{ ['--t' as any]: cl.tone }}>{cl.short.slice(0, 2).toUpperCase()}</span><b>{cl.name}</b></div>
                  <p>{r.text}</p>
                </div>
                <div className="row">
                  {r.approve ? <button className="btn sm" onClick={() => dispatch({ type: 'REM_APPROVE', id: r.id })}>Approve</button> : null}
                  <button className="btn sm" onClick={() => dispatch({ type: 'REM_SEND_NOW', id: r.id })}>Send now</button>
                  <button className="btn sm gh" onClick={() => dispatch({ type: 'REM_CANCEL', id: r.id })}><Icon name="x" size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {s.ui.wa.tab === 'templates' && (
        <div className="grid g3">
          {TPL.map((t) => (
            <div key={t.id} className="card tpl">
              <div className="row"><b>{t.name}</b><span className="sp" /><span className="chip blue">Utility</span></div>
              <p>{t.body}</p>
            </div>
          ))}
        </div>
      )}

      {showSchedule && <ScheduleModal onClose={() => setShowSchedule(false)} defaultClient={c.id} />}

    </>
  );
}

function ScheduleModal({ onClose, defaultClient }: { onClose: () => void; defaultClient: string }) {
  const s = useAppState();
  const dispatch = useDispatch();
  const [client, setClient] = useState(defaultClient);
  const [tpl, setTpl] = useState('pending');
  const d = new Date(vnow()); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
  const [when, setWhen] = useState(toInput(d));
  const c = s.clients.find((x) => x.id === client)!;
  const t = TPL.find((x) => x.id === tpl)!;
  const [text, setText] = useState(fillTpl(t.body, c.contact.split(' ')[0]));

  return (
    <div className="modal" role="dialog" aria-label="Schedule reminder" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mbox">
        <h2>Schedule a WhatsApp reminder</h2>
        <div className="mgrid">
          <div className="mrow">
            <label className="f">Client</label>
            <select className="sel" value={client} onChange={(e) => { setClient(e.target.value); const cc = s.clients.find((x) => x.id === e.target.value)!; setText(fillTpl(t.body, cc.contact.split(' ')[0])); }}>
              {s.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
            </select>
          </div>
          <div className="mrow">
            <label className="f">Template</label>
            <select className="sel" value={tpl} onChange={(e) => { setTpl(e.target.value); const tt = TPL.find((x) => x.id === e.target.value)!; setText(fillTpl(tt.body, c.contact.split(' ')[0])); }}>
              {TPL.map((tt) => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
            </select>
          </div>
          <div className="mrow"><label className="f">Send on</label><input className="inp" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
        </div>
        <div className="mrow"><label className="f">Message preview</label><textarea className="inp" rows={4} value={text} onChange={(e) => setText(e.target.value)} /></div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn gh" onClick={onClose}>Cancel</button>
          <button
            className="btn pri"
            onClick={() => {
              const at = new Date(when);
              const reminder: Reminder = { id: 'r' + Date.now(), client, tpl, at, repeat: 'Once', approve: true, status: 'scheduled', text };
              dispatch({ type: 'REM_SCHEDULE', reminder });
              onClose();
            }}
          >
            <Icon name="clock" size={14} />Schedule reminder
          </button>
        </div>
      </div>
    </div>
  );
}
