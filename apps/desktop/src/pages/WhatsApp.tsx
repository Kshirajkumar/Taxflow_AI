import { useEffect, useRef, useState, useCallback } from 'react';
import { Icon } from '../components/Icon';
import {
  createTelegramLink,
  fetchTelegramMessages,
  fetchTelegramStatus,
  sendTelegramMessage,
  sendTelegramAttachment,
  fetchTelegramUnread,
  fetchTelegramPreviews,
  markTelegramClientRead,
  downloadTelegramMessageFile,
  fetchDocumentPreview,
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

const MAX_TELEGRAM_OUTBOUND_FILE_BYTES = 25 * 1024 * 1024;

function mergeTelegramMessages(serverMessages: TelegramMessage[], currentMessages: TelegramMessage[], clientId: string): TelegramMessage[] {
  const merged = new Map<string, TelegramMessage>();
  const statusRank: Record<string, number> = { received: 0, queued: 1, sending: 2, failed: 3, sent: 4 };
  for (const message of serverMessages) {
    merged.set(message.provider_message_id || message.id, message);
  }
  for (const message of currentMessages) {
    if (message.client_id !== clientId || !message.provider_message_id?.startsWith('taxflow:')) continue;
    const key = message.provider_message_id;
    const serverMessage = merged.get(key);
    if (!serverMessage) {
      merged.set(key, message);
    } else if ((statusRank[message.delivery_status] || 0) > (statusRank[serverMessage.delivery_status] || 0)) {
      merged.set(key, { ...message, ...serverMessage, delivery_status: message.delivery_status });
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-200);
}

export function WhatsAppPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const [channel, setChannel] = useState<'whatsapp' | 'telegram'>('telegram');
  const [input, setInput] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [sendingReminderId, setSendingReminderId] = useState('');
  const [reminderSendErrors, setReminderSendErrors] = useState<Record<string, string>>({});
  const [telegramMessages, setTelegramMessages] = useState<TelegramMessage[]>([]);
  const [telegramConversationClientId, setTelegramConversationClientId] = useState('');
  const [telegramReady, setTelegramReady] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramBot, setTelegramBot] = useState('');
  const [telegramStatusError, setTelegramStatusError] = useState('');
  const [telegramDiagnostics, setTelegramDiagnostics] = useState<string[]>([]);
  const [telegramError, setTelegramError] = useState('');
  const [telegramInfo, setTelegramInfo] = useState('');
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [telegramSending, setTelegramSending] = useState(false);
  const [openingTelegramFileId, setOpeningTelegramFileId] = useState('');
  const [retryingTelegramFileId, setRetryingTelegramFileId] = useState('');
  const [telegramDraft, setTelegramDraft] = useState('');
  const [telegramRequestId, setTelegramRequestId] = useState('');
  const [pendingTelegramFile, setPendingTelegramFile] = useState<File | null>(null);
  const [telegramRetry, setTelegramRetry] = useState(0);
  /** Text staged inline in the thread waiting for approval — NOT yet sent */
  const [pendingTelegramMsg, setPendingTelegramMsg] = useState('');
  const [pendingTelegramClientId, setPendingTelegramClientId] = useState('');
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
  const telegramFileInputRef = useRef<HTMLInputElement>(null);
  const c = s.clients.find((x) => x.id === s.ui.wa.client) || s.clients[0];
  const pendingTelegramClient = s.clients.find((client) => client.id === pendingTelegramClientId);
  const pendingTelegramForCurrentClient = !!pendingTelegramMsg && pendingTelegramClientId === c?.id;
  const pendingTelegramForOtherClient = !!pendingTelegramMsg && !!pendingTelegramClientId && pendingTelegramClientId !== c?.id;
  const visibleClients = s.clients.filter((client) => client.name.toLocaleLowerCase().includes(clientSearch.trim().toLocaleLowerCase()));
  const thread = c ? (s.threads[c.id] || []).slice().sort((a, b) => a.at.getTime() - b.at.getTime()) : [];
  const isTelegramConversationLoading = channel === 'telegram' && !!c && telegramConversationClientId !== c.id;
  const isTelegramLinkedForCurrentClient = !!c && telegramConversationClientId === c.id && telegramLinked;
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
    if (channel !== 'telegram') return undefined;
    let active = true;
    const loadStatus = async () => {
      if (active) setTelegramLoading(true);
      try {
        const status = await fetchTelegramStatus();
        if (active) {
          setTelegramReady(status.connected);
          setTelegramBot(status.bot?.username || '');
          setTelegramDiagnostics(status.diagnostics?.warnings || []);
          setTelegramStatusError('');
        }
      } catch (error) {
        if (active) {
          setTelegramReady(false);
          setTelegramStatusError(error instanceof Error ? error.message : 'Telegram is unavailable.');
        }
      } finally {
        if (active) setTelegramLoading(false);
      }
    };
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [channel]);

  useEffect(() => {
    if (channel !== 'telegram' || !c) {
      setTelegramMessages([]);
      setTelegramLinked(false);
      setTelegramConversationClientId('');
      return undefined;
    }
    let active = true;
    let loadingConversation = false;
    setTelegramMessages([]);
    setTelegramLinked(false);
    setTelegramError('');
    setTelegramInfo('');
    setTelegramConversationClientId('');
    const load = async () => {
      if (loadingConversation) return;
      loadingConversation = true;
      try {
        const conversation = await fetchTelegramMessages(c.id);
        if (active) {
          setTelegramLinked(conversation.linked);
          setTelegramMessages((current) => mergeTelegramMessages(conversation.messages, current, c.id));
          setTelegramConversationClientId(c.id);
          setTelegramError('');
        }
      }
      catch (error) {
        if (active) {
          setTelegramLinked(false);
          setTelegramConversationClientId(c.id);
          setTelegramError(error instanceof Error ? error.message : 'Telegram is unavailable.');
        }
      }
      finally { loadingConversation = false; }
    };
    void load(); const timer = window.setInterval(() => void load(), 4000); return () => { active = false; window.clearInterval(timer); };
  }, [channel, c?.id, telegramRetry]);

  useEffect(() => {
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
  }, []);

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

  async function openTelegramFile(message: TelegramMessage) {
    if (!message.vault_file_ref || openingTelegramFileId) return;
    const preview = window.open('', '_blank');
    if (!preview) {
      setTelegramError('Allow pop-ups for TaxFlow.AI to open this attachment.');
      return;
    }
    setOpeningTelegramFileId(message.id);
    setTelegramError('');
    try {
      const file = await fetchDocumentPreview(message.vault_file_ref);
      const url = URL.createObjectURL(file);
      preview.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      preview.close();
      setTelegramError(error instanceof Error ? error.message : 'Could not open this Telegram attachment.');
    } finally {
      setOpeningTelegramFileId('');
    }
  }

  async function retryTelegramFile(message: TelegramMessage) {
    if (!c || retryingTelegramFileId) return;
    setRetryingTelegramFileId(message.id);
    setTelegramError('');
    try {
      const updated = await downloadTelegramMessageFile(c.id, message.id);
      setTelegramMessages((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error) {
      setTelegramError(error instanceof Error ? error.message : 'Could not download this Telegram attachment.');
    } finally {
      setRetryingTelegramFileId('');
    }
  }

  function requestTelegramSend() {
    const text = input.trim();
    if (!text || telegramSending || pendingTelegramMsg || !c) return;
    if (!telegramReady || !isTelegramLinkedForCurrentClient || isTelegramConversationLoading) {
      setTelegramError('Telegram is not ready or this client is not linked. Please check the connection and try again.');
      return;
    }
    setTelegramError('');
    setTelegramInfo('');
    setTelegramRequestId(crypto.randomUUID());
    setTelegramDraft(text);
    setPendingTelegramMsg(text);
    setPendingTelegramClientId(c.id);
    setInput('');
  }

  function requestTelegramAttachment(file: File) {
    if (telegramSending || pendingTelegramMsg || !c) return;
    if (!telegramReady || !isTelegramLinkedForCurrentClient || isTelegramConversationLoading) {
      setTelegramError('Telegram is not ready or this client is not linked. Please check the connection and try again.');
      return;
    }
    if (file.size === 0) {
      setTelegramError('The selected attachment is empty.');
      return;
    }
    if (file.size > MAX_TELEGRAM_OUTBOUND_FILE_BYTES) {
      setTelegramError('Telegram attachments cannot exceed 25 MB.');
      return;
    }
    setTelegramError('');
    setTelegramInfo('');
    setTelegramRequestId(crypto.randomUUID());
    setTelegramDraft('');
    setPendingTelegramFile(file);
    setPendingTelegramMsg(file.name);
    setPendingTelegramClientId(c.id);
    setIsEditingPending(false);
    setInput('');
  }

  async function confirmTelegramSend() {
    const file = pendingTelegramFile;
    const messageText = telegramDraft;
    if ((!messageText && !file) || telegramSending || !c || pendingTelegramClientId !== c.id) return;
    const targetClientId = pendingTelegramClientId;
    const requestId = telegramRequestId || crypto.randomUUID();
    setTelegramSending(true);
    setTelegramError('');
    setTelegramInfo('Sending securely through Telegram…');
    try {
      const optimisticMessage: TelegramMessage = {
        id: `local-${requestId}`,
        client_id: targetClientId,
        provider_message_id: `taxflow:${requestId}`,
        direction: 'outbound',
        chat_id: '',
        body: file ? file.name : messageText,
        message_type: file ? 'document' : 'text',
        ...(file ? {
          telegram_file_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          file_size: file.size,
        } : {}),
        delivery_status: 'sending',
        created_at: new Date().toISOString(),
      };
      setTelegramMessages((current) => mergeTelegramMessages(
        [optimisticMessage],
        current,
        targetClientId,
      ));
      setPendingTelegramMsg('');
      setPendingTelegramClientId('');
      setTelegramDraft('');
      setTelegramRequestId('');
      setPendingTelegramFile(null);
      setIsEditingPending(false);
      setEditText('');

      const sentMessage = file
        ? await sendTelegramAttachment(targetClientId, file, requestId)
        : await sendTelegramMessage(targetClientId, messageText, requestId);
      setTelegramMessages((current) => mergeTelegramMessages([sentMessage], current, targetClientId));
      setPendingTelegramMsg('');
      setPendingTelegramClientId('');
      setTelegramDraft('');
      setTelegramRequestId('');
      setTelegramInfo(file ? 'Attachment sent through Telegram.' : 'Message sent through Telegram.');
      setTelegramSending(false);

      try {
        setTelegramPreviews(await fetchTelegramPreviews());
      } catch (error) {
        console.warn('Failed to refresh Telegram preview after sending', error);
      }
    } catch (error) {
      setTelegramInfo('');
      setTelegramMessages((current) => current.map((message) =>
        message.provider_message_id === `taxflow:${requestId}`
          ? { ...message, delivery_status: 'failed' }
          : message
      ));
      setPendingTelegramMsg('');
      setPendingTelegramClientId('');
      setTelegramDraft('');
      setTelegramRequestId('');
      setPendingTelegramFile(null);
      setIsEditingPending(false);
      setEditText('');
      setTelegramError(error instanceof Error ? error.message : 'Unable to send Telegram message. Please try again.');
    } finally {
      setTelegramSending(false);
    }
  }

  function cancelTelegramPending() {
    setPendingTelegramMsg('');
    setPendingTelegramClientId('');
    setTelegramDraft('');
    setTelegramRequestId('');
    setPendingTelegramFile(null);
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

  const scheduled = s.reminders.filter((r) => r.status === 'scheduled').sort((a, b) => a.at.getTime() - b.at.getTime());
  const reminderGroups = scheduled.reduce<{ label: string; items: Reminder[] }[]>((groups, reminder) => {
    const label = dayLabel(reminder.at);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.label === label) lastGroup.items.push(reminder);
    else groups.push({ label, items: [reminder] });
    return groups;
  }, []);

  if (!c) {
    return (
      <div className="inbox-page">
        <div className="ph inbox-page-head"><div><span className="eyebrow">MESSAGES</span><h1>Client Inbox</h1><p>Your WhatsApp and Telegram conversations.</p></div><label className="wa-channel-control"><span>Channel</span><select id="inbox-channel-empty" className="sel" value={channel} onChange={(e) => setChannel(e.target.value as 'whatsapp' | 'telegram')}><option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option></select></label></div>
        <div className="card workspace-empty workspace-empty-inbox">
          <div className="workspace-empty-visual"><span className="workspace-empty-ring ring-one" /><span className="workspace-empty-ring ring-two" /><span className="workspace-empty-orb"><Icon name="chat" size={30} /></span><span className="workspace-empty-float float-one"><Icon name="send" size={14} /></span><span className="workspace-empty-float float-two"><Icon name="bell" size={14} /></span></div>
          <div className="workspace-empty-copy"><span className="eyebrow">A QUIET INBOX IS A CLEAN START</span><h2>Your client conversations will appear here</h2><p>Once a client is added, chats, reminders, and approved message templates will stay together in one focused workspace.</p><button className="btn pri" onClick={() => dispatch({ type: 'GO', page: 'clients' })}><Icon name="users" size={14} />Add your first client</button></div>
          <div className="workspace-empty-note"><Icon name="check" size={16} /><div><b>Ready for WhatsApp and Telegram</b><span>Choose a channel when your first client is ready.</span></div></div>
        </div>
      </div>
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

  async function sendReminder(reminder: Reminder) {
    const reminderClient = s.clients.find((client) => client.id === reminder.client);
    if (!reminderClient) {
      setReminderSendErrors((errors) => ({ ...errors, [reminder.id]: 'The selected client could not be found.' }));
      return;
    }
    if (!whatsAppReady) {
      setReminderSendErrors((errors) => ({ ...errors, [reminder.id]: 'Connect WhatsApp before sending this reminder.' }));
      return;
    }

    setSendingReminderId(reminder.id);
    setReminderSendErrors((errors) => ({ ...errors, [reminder.id]: '' }));
    try {
      await sendWhatsAppManualMessage(reminderClient.id, reminderClient.phone, reminder.text);
      dispatch({ type: 'REM_SEND_NOW', id: reminder.id });
    } catch (error) {
      setReminderSendErrors((errors) => ({
        ...errors,
        [reminder.id]: error instanceof Error ? error.message : 'Could not send this reminder.',
      }));
    } finally {
      setSendingReminderId('');
    }
  }

  return (
    <div className="inbox-page">
      <div className="ph inbox-page-head">
        <div><span className="eyebrow">MESSAGES</span><h1>Client Inbox</h1><p>Conversations, files, and follow-ups in one focused workspace.</p></div>
        <button className="btn sm" onClick={() => setShowSchedule(true)}><Icon name="plus" size={14} />Schedule reminder</button>
      </div>

      <div className="card wa-top">
        <label className="wa-channel-control" htmlFor="inbox-channel"><span>Channel</span><select id="inbox-channel" className="sel" value={channel} onChange={(e) => setChannel(e.target.value as 'whatsapp' | 'telegram')}>
          <option value="telegram">Telegram</option>
          <option value="whatsapp">WhatsApp</option>
        </select></label>
        {channel === 'telegram' && (
          <>
            <span className={'chip ' + (telegramLoading ? 'amber' : telegramReady ? 'green' : 'amber')}>
              <i className="sdot" style={{ margin: '0 2px 0 0' }} />
              {telegramLoading ? 'Checking Telegram…' : telegramReady ? `@${telegramBot}` : 'Telegram unavailable'}
            </span>
            <span className={'chip wa-linked-status ' + (isTelegramConversationLoading ? 'amber' : isTelegramLinkedForCurrentClient ? 'green' : 'amber')}>
              {isTelegramConversationLoading ? 'Loading chat…' : isTelegramLinkedForCurrentClient ? 'Client linked' : 'Client not linked'}
            </span>
            {totalUnreadAcrossClients > 0 && (
              <span className="chip wa-total-unread-pill" title={`${totalUnreadAcrossClients} unread message${totalUnreadAcrossClients > 1 ? 's' : ''} across all connected clients`}>
                <span className="wa-unread-glow-dot" />
                {totalUnreadAcrossClients} unread {totalUnreadAcrossClients === 1 ? 'message' : 'messages'}
              </span>
            )}
          </>
        )}
        {channel === 'whatsapp' && (
          <>
            <span className={'chip ' + (whatsAppLoading ? 'amber' : whatsAppReady ? 'green' : 'amber')}>
              <i className="sdot" style={{ margin: '0 2px 0 0' }} />
              {whatsAppLoading ? 'Checking WhatsApp…' : whatsAppReady ? 'WhatsApp connected' : 'WhatsApp not configured'}
            </span>
          </>
        )}
        <div className="tabs inbox-tabs" role="tablist" aria-label="Client inbox sections">
          {(['chats', 'reminders', 'templates'] as const).map((tab) => (
            <button
              key={tab}
              id={`inbox-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={s.ui.wa.tab === tab}
              aria-controls={`inbox-panel-${tab}`}
              className={s.ui.wa.tab === tab ? 'on' : ''}
              onClick={() => dispatch({ type: 'WA_TAB', tab })}
            >
              {tab === 'chats' ? 'Chats' : tab === 'reminders' ? `Scheduled reminders (${scheduled.length})` : 'Templates'}
            </button>
          ))}
        </div>
        <span className="sp" />
        {channel === 'telegram' && <button className="btn sm wa-connect-btn" onClick={() => void connectTelegram()} disabled={telegramLoading || isTelegramConversationLoading || telegramConnecting || !telegramReady}>
          {telegramConnecting && <span className="spin" />}
          {telegramConnecting ? 'Connecting…' : isTelegramLinkedForCurrentClient ? 'Reconnect client' : 'Connect client'}
        </button>}
        {!whatsAppReady && channel === 'whatsapp' && <small className="wa-config-note">Configure Meta API credentials on the backend.</small>}
      </div>

      {s.ui.wa.tab === 'chats' && <div className="card wa" id="inbox-panel-chats" role="tabpanel" aria-labelledby="inbox-tab-chats">
          <div className="wa-l">
            <div className="wa-list-head">
              <div><b>Conversations</b><span>{visibleClients.length} clients</span></div>
              <label className="wa-client-search"><Icon name="search" size={13} /><input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Find a client" aria-label="Filter clients" /></label>
            </div>
            {visibleClients.map((cl) => {
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
                      <span className={'nm' + (clUnread > 0 ? ' unread-nm' : '')} title={cl.name}>{cl.name}</span>
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
              {channel === 'telegram' && isTelegramConversationLoading && (
                <div className="tg-conversation-skeleton" role="status" aria-live="polite" aria-label={`Loading Telegram conversation with ${c.name}`}>
                  <div className="tg-skeleton-heading"><span className="tg-skeleton-dot" /><span>Loading conversation history</span></div>
                  <div className="tg-skeleton-message incoming"><i /><i /><i /></div>
                  <div className="tg-skeleton-message outgoing"><i /><i /></div>
                  <div className="tg-skeleton-message incoming short"><i /><i /></div>
                  <div className="tg-skeleton-message outgoing short"><i /><i /><i /></div>
                </div>
              )}
              {channel === 'telegram' && (telegramStatusError || telegramDiagnostics.length > 0) && (
                <div className="empty telegram-state error" role="alert">
                  <b>Telegram setup needs attention</b>
                  {telegramStatusError && <span>{telegramStatusError}</span>}
                  {telegramDiagnostics.map((warning) => <span key={warning}>{warning}</span>)}
                </div>
              )}
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
              {channel === 'telegram' && telegramConversationClientId === c.id && telegramError && (
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
              {channel === 'telegram' && !isTelegramConversationLoading && telegramConversationClientId === c.id && !telegramError && !isTelegramLinkedForCurrentClient && (
                <div className="tg-unlinked-state" role="status">
                  <div className="tg-unlinked-art">
                    <span className="tg-unlinked-orbit orbit-one" />
                    <span className="tg-unlinked-orbit orbit-two" />
                    <span className="tg-unlinked-icon"><Icon name="send" size={23} /></span>
                    <span className="tg-unlinked-lock"><Icon name="lock" size={13} /></span>
                  </div>
                  <span className="eyebrow">PRIVATE CLIENT CONNECTION</span>
                  <h3>{telegramReady ? `Connect ${c.short} to Telegram` : 'Telegram is unavailable'}</h3>
                  <p>
                    {telegramReady
                      ? `Link ${c.name} with your Telegram bot to securely load this conversation and exchange messages here.`
                      : 'The Telegram bot is not available right now. Check the backend connection and try again.'}
                  </p>
                  {telegramReady && (
                    <button className="btn sm pri" onClick={() => void connectTelegram()} disabled={telegramConnecting}>
                      {telegramConnecting ? <><span className="spin spin-light" />Creating secure link…</> : <><Icon name="link" size={13} />Connect client</>}
                    </button>
                  )}
                  <small>Messages will appear in this conversation after the client completes the Telegram link.</small>
                </div>
              )}
              {channel === 'telegram' && !isTelegramConversationLoading && isTelegramLinkedForCurrentClient && !telegramError && telegramMessages.length === 0 && !pendingTelegramForCurrentClient && (
                <div className="tg-conversation-empty" role="status">
                  <span><Icon name="chat" size={20} /></span>
                  <b>No messages yet</b>
                  <small>This Telegram conversation is connected. Send a message to start the conversation.</small>
                </div>
              )}
              {channel === 'telegram' && pendingTelegramForOtherClient && pendingTelegramClient && (
                <div className="telegram-notice tg-pending-client-notice">
                  <span>A message for {pendingTelegramClient.short} is waiting for your approval.</span>
                  <button className="btn sm" onClick={() => dispatch({ type: 'WA_CLIENT', id: pendingTelegramClient.id })}>Review message</button>
                </div>
              )}
              {channel === 'telegram' && telegramConversationClientId === c.id && !isTelegramConversationLoading && telegramInfo && <div className="telegram-notice">{telegramInfo}</div>}
              {channel === 'telegram' && isTelegramLinkedForCurrentClient && !isTelegramConversationLoading && telegramMessages.map((m) => {
                const hasAttachment = Boolean(m.telegram_file_name || m.vault_file_ref || m.file_download_pending || m.file_download_error);
                const attachmentName = m.telegram_file_name || m.body;
                return (
                  <div key={m.provider_message_id || m.id} className={'msg ' + (m.direction === 'outbound' ? 'me' : 'cl')}>
                    {hasAttachment ? (
                      <>
                        {m.body && m.body !== attachmentName && <div className="tg-file-caption">{m.body}</div>}
                        <div className="tg-file-attachment">
                          <Icon name="file" size={17} />
                          <span className="tg-file-attachment-name">
                            <b>{attachmentName}</b>
                            <small>{m.message_type.replace(/_/g, ' ')} attachment</small>
                          </span>
                          {m.vault_file_ref ? (
                            <button className="btn sm tg-file-open" onClick={() => void openTelegramFile(m)} disabled={openingTelegramFileId === m.id}>
                              {openingTelegramFileId === m.id ? 'Opening…' : 'Open'}
                            </button>
                          ) : m.direction === 'outbound' ? (
                            <small className="tg-file-pending">
                              {m.delivery_status === 'sent'
                                ? 'Sent to client through Telegram'
                                : m.delivery_status === 'failed'
                                  ? 'Delivery failed; check Telegram before retrying'
                                  : 'Sending…'}
                            </small>
                          ) : m.file_download_error ? (
                            m.file_download_retryable === false
                              ? <small className="tg-file-pending">Cannot save this format</small>
                              : <button className="btn sm tg-file-open" onClick={() => void retryTelegramFile(m)} disabled={retryingTelegramFileId === m.id}>
                                  {retryingTelegramFileId === m.id ? 'Retrying…' : 'Retry'}
                                </button>
                          ) : (
                            <small className="tg-file-pending">
                              {m.attachment_download_status === 'downloading' ? 'Saving…' : m.file_download_pending ? 'Queued for saving…' : 'Waiting to download…'}
                            </small>
                          )}
                        </div>
                        {m.direction === 'inbound' && m.file_download_error && <small className="tg-file-error">{m.file_download_error}</small>}
                      </>
                    ) : <div>{m.body}</div>}
                    <span className="mt">
                      {fTime(new Date(m.created_at))} · {
                        m.delivery_status === 'sending' || m.delivery_status === 'queued'
                          ? 'Sending…'
                          : m.delivery_status === 'failed'
                            ? 'Delivery failed'
                            : m.delivery_status === 'sent' ? 'Sent' : m.delivery_status
                      }
                    </span>
                  </div>
                );
              })}
              {channel === 'telegram' && pendingTelegramForCurrentClient && (
                <div className="tg-pending-group">

                  {/* ── Message bubble (muted while pending / editing) ── */}
                  <div className={`msg me tg-pending-bubble${isEditingPending ? ' tg-pending-bubble--editing' : ''}`}>
                    {pendingTelegramFile ? (
                      <div className="tg-file-attachment">
                        <Icon name="file" size={17} />
                        <span className="tg-file-attachment-name">
                          <b>{pendingTelegramFile.name}</b>
                          <small>{(pendingTelegramFile.size / (1024 * 1024)).toFixed(2)} MB · not sent</small>
                        </span>
                      </div>
                    ) : <div>{pendingTelegramMsg}</div>}
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
                            <span>{pendingTelegramFile ? 'File not delivered yet. Approve or discard.' : 'Message not delivered yet. Approve, edit, or discard.'}</span>
                          </div>
                        </div>
                        <div className="tg-approval-actions">
                          {/* Discard */}
                          <button className="tg-cancel-btn" onClick={cancelTelegramPending} disabled={telegramSending}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            Discard
                          </button>
                          {/* Edit */}
                          {!pendingTelegramFile && <button className="tg-edit-btn" onClick={startEditingPending} disabled={telegramSending}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            Edit
                          </button>}
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
                    <button className="btn sm" onClick={() => void sendReminder(r)} disabled={sendingReminderId === r.id || whatsAppLoading || !whatsAppReady}>
                      {sendingReminderId === r.id ? 'Sending…' : 'Send now'}
                    </button>
                    <button className="btn sm gh" onClick={() => dispatch({ type: 'REM_CANCEL', id: r.id })}>Cancel</button>
                  </div>
                  {reminderSendErrors[r.id] && <small className="wa-reminder-error">{reminderSendErrors[r.id]}</small>}
                </div>
              ))}
            </div>
            <div className="wa-f">
              {channel === 'telegram' && (
                <>
                  <input
                    ref={telegramFileInputRef}
                    type="file"
                    hidden
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (file) requestTelegramAttachment(file);
                    }}
                    aria-label="Select a file to send through Telegram"
                  />
                  <button
                    type="button"
                    className="btn sm gh"
                    onClick={() => telegramFileInputRef.current?.click()}
                    disabled={!telegramReady || !isTelegramLinkedForCurrentClient || isTelegramConversationLoading || telegramSending || !!pendingTelegramMsg || isEditingPending}
                    aria-label="Attach file for Telegram"
                    title="Attach a file (up to 25 MB)"
                  >
                    <Icon name="upload" size={14} />
                  </button>
                </>
              )}
              <label className="wa-template-picker">
                <Icon name="file" size={14} />
                <select
                  className="sel"
                  aria-label="Insert template"
                  value=""
                  onChange={(e) => { if (e.target.value) { const t = TPL.find((x) => x.id === e.target.value)!; setInput(fillTpl(t.body, c.contact.split(' ')[0])); } }}
                >
                  <option value="">Insert template</option>
                  {TPL.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
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
                    ? pendingTelegramForOtherClient
                      ? `Review the pending message for ${pendingTelegramClient?.short || 'another client'} first…`
                      : pendingTelegramForCurrentClient || isEditingPending
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
                    ? telegramSending || telegramLoading || isTelegramConversationLoading || !!pendingTelegramMsg || isEditingPending
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
                    ? !telegramReady || !isTelegramLinkedForCurrentClient || isTelegramConversationLoading || telegramSending || telegramLoading || !!pendingTelegramMsg || isEditingPending
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
        </div>}

      {s.ui.wa.tab === 'reminders' && (
        <div className="wa-reminders" id="inbox-panel-reminders" role="tabpanel" aria-labelledby="inbox-tab-reminders">
          {whatsAppLoading
            ? <div className="wa-reminder-notice"><span className="spin" />Checking WhatsApp connection…</div>
            : !whatsAppReady && <div className="wa-reminder-notice"><Icon name="info" size={14} />Connect WhatsApp to send reminders. You can still review and approve scheduled messages.</div>}
          {scheduled.length === 0 ? (
            <div className="card wa-tab-empty">
              <Icon name="clock" size={22} />
              <b>No scheduled reminders</b>
              <span>Plan a follow-up and it will appear here.</span>
              <button className="btn sm" onClick={() => setShowSchedule(true)}><Icon name="plus" size={13} />Schedule reminder</button>
            </div>
          ) : reminderGroups.map((group) => (
            <section className="wa-reminder-group" key={group.label}>
              <h2 className="wa-reminder-day">{group.label}</h2>
              <div className="wa-reminder-list">
                {group.items.map((reminder) => {
                  const reminderClient = s.clients.find((client) => client.id === reminder.client);
                  if (!reminderClient) return null;
                  return (
                    <article className="card wa-reminder-card" key={reminder.id}>
                      <div className="wa-reminder-time">
                        <b>{fTime(reminder.at)}</b>
                        <small>{until(reminder.at)}</small>
                      </div>
                      <div className="wa-reminder-content">
                        <div className="wa-reminder-client">
                          <span className="av" style={{ ['--t' as any]: reminderClient.tone }}>{reminderClient.short.slice(0, 2).toUpperCase()}</span>
                          <b>{reminderClient.name}</b>
                          <span className="chip blue">{TPL.find((template) => template.id === reminder.tpl)?.name || 'Reminder'}</span>
                        </div>
                        <p>{reminder.text}</p>
                        {reminderSendErrors[reminder.id] && <small className="wa-reminder-error">{reminderSendErrors[reminder.id]}</small>}
                      </div>
                      <div className="wa-reminder-actions">
                        <span className={`chip ${reminder.approve ? 'amber' : 'green'}`}>{reminder.approve ? 'Needs approval' : 'Approved'}</span>
                        {reminder.approve && <button className="btn sm" onClick={() => dispatch({ type: 'REM_APPROVE', id: reminder.id })}>Approve</button>}
                        <button className="btn sm" onClick={() => void sendReminder(reminder)} disabled={sendingReminderId === reminder.id || whatsAppLoading || !whatsAppReady}>
                          {sendingReminderId === reminder.id ? 'Sending…' : 'Send now'}
                        </button>
                        <button className="btn sm gh" onClick={() => dispatch({ type: 'REM_CANCEL', id: reminder.id })} aria-label={`Cancel reminder for ${reminderClient.name}`} title="Cancel reminder"><Icon name="x" size={13} /></button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {s.ui.wa.tab === 'templates' && (
        <div className="wa-template-grid" id="inbox-panel-templates" role="tabpanel" aria-labelledby="inbox-tab-templates">
          {TPL.map((template) => (
            <article className="card tpl wa-template-card" key={template.id}>
              <div className="row">
                <b>{template.name}</b><span className="sp" /><span className="chip blue">{template.cat}</span>
              </div>
              <p>{template.body}</p>
              <div className="wa-template-footer">
                <span className="chip green"><Icon name="check" size={11} />Ready to use</span>
                <button
                  className="btn sm"
                  onClick={() => {
                    setInput(fillTpl(template.body, c.contact.split(' ')[0]));
                    dispatch({ type: 'WA_TAB', tab: 'chats' });
                  }}
                >
                  Use template
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {showSchedule && <ScheduleModal onClose={() => setShowSchedule(false)} defaultClient={c.id} />}

    </div>
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
