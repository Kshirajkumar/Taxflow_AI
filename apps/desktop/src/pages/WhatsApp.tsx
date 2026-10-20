import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { Icon } from '../components/Icon';
import { FileArtifactCard } from '../components/FileArtifactCard';
import { DocumentPreviewDialog } from '../components/DocumentPreviewDialog';
import {
  createTelegramLink,
  fetchTelegramMessages,
  fetchTelegramStatus,
  sendTelegramMessage,
  fetchTelegramUnread,
  fetchTelegramPreviews,
  markTelegramClientRead,
  fetchDocumentPreview,
  fetchWhatsAppStatus,
  sendWhatsAppManualMessage,
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  type TelegramMessage,
  type TelegramPreview,
  type MessageTemplate,
} from '../lib/api';
import { useAppState, useDispatch } from '../state/store';
import { openWithDefaultApp, supportsNativeFileOpen } from '../lib/nativeFiles';
import { nextMsgId } from '../lib/messageIds';
import { missing } from '../lib/domain';
import { fDate, fTime, fDT, until, agoT, dayDiff, vnow, toInput } from '../lib/format';
import type { ChatMsg, Reminder } from '../types';

function dayLabel(d: Date) {
  const n = dayDiff(vnow(), d);
  return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : fDate(d);
}

function fillTpl(body: string, name: string, portalLink?: string) {
  const link = portalLink || 'https://taxflowaiwebsite.vercel.app/portal';
  const filled = body.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === 'name') return name;
    if (k === 'period') return 'August 2026';
    if (k === 'due') return '20 Sep 2026';
    if (k === 'filing') return 'GSTR-3B';
    if (k === 'doc') return 'bank statement';
    if (k === 'portalLink') return link;
    return '—';
  });
  return filled.includes(link) ? filled : `${filled.trim()}\n\nUpload documents securely after signing in: ${link}`;
}


function formatAttachmentSize(bytes?: number | null) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sameTelegramMessages(a: TelegramMessage[], b: TelegramMessage[]) {
  return a.length === b.length && a.every((message, index) => {
    const next = b[index];
    return message.id === next.id
      && message.provider_message_id === next.provider_message_id
      && message.body === next.body
      && message.message_type === next.message_type
      && message.delivery_status === next.delivery_status
      && message.telegram_file_name === next.telegram_file_name
      && message.mime_type === next.mime_type
      && message.file_size === next.file_size
      && message.vault_file_ref === next.vault_file_ref
      && message.file_download_pending === next.file_download_pending
      && message.attachment_download_status === next.attachment_download_status
      && message.file_download_error === next.file_download_error
      && message.file_download_retryable === next.file_download_retryable;
  });
}

function TelegramInlineImage({
  message,
  onOpen,
  onLoaded,
}: {
  message: TelegramMessage;
  onOpen: (message: TelegramMessage, file: Blob) => void;
  onLoaded: () => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const element = previewRef.current;
    if (!element || !('IntersectionObserver' in window)) {
      setShouldLoad(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { root: element.closest('#wa-thread'), rootMargin: '180px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.vault_file_ref]);

  useEffect(() => {
    if (!message.vault_file_ref || !shouldLoad) return undefined;
    const controller = new AbortController();
    setFile(null);
    setError('');
    void fetchDocumentPreview(message.vault_file_ref, controller.signal)
      .then((downloaded) => {
        if (!controller.signal.aborted) {
          setFile(new Blob([downloaded], { type: message.mime_type || downloaded.type || 'application/octet-stream' }));
        }
      })
      .catch((downloadError) => {
        if (!controller.signal.aborted) {
          setError(downloadError instanceof Error ? downloadError.message : 'Image preview could not be loaded.');
        }
      });
    return () => controller.abort();
  }, [message.vault_file_ref, message.mime_type, shouldLoad]);

  useEffect(() => {
    if (!file) {
      setImageUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (error) return <div className="tg-inline-image-error" ref={previewRef} role="status">Image preview unavailable. Use Open to retry.</div>;
  if (!imageUrl) return <div className="tg-inline-image-loading" ref={previewRef} role="status"><span className="spin" />{shouldLoad ? 'Loading image…' : 'Image preview will load when visible…'}</div>;
  return (
    <div ref={previewRef}>
      <button
        type="button"
        className="tg-inline-image"
        onClick={() => file && onOpen(message, file)}
        aria-label={`View image ${message.telegram_file_name || 'sent in Telegram'}`}
      >
        <img src={imageUrl} alt={message.telegram_file_name || 'Image sent in Telegram'} loading="lazy" onLoad={onLoaded} />
        <span><Icon name="scan" size={12} />View image</span>
      </button>
    </div>
  );
}

function mergeTelegramMessages(serverMessages: TelegramMessage[], currentMessages: TelegramMessage[], clientId: string): TelegramMessage[] {
  const merged = new Map<string, TelegramMessage>();
  const statusRank: Record<string, number> = { received: 0, queued: 1, sending: 2, failed: 3, sent: 4 };
  const keyFor = (message: TelegramMessage) => message.provider_message_id || message.id;
  for (const message of serverMessages) {
    merged.set(keyFor(message), message);
  }
  for (const message of currentMessages) {
    if (message.client_id !== clientId) continue;
    const key = keyFor(message);
    const serverMessage = merged.get(key);
    if (!serverMessage) {
      merged.set(key, message);
    } else {
      const preferredStatus = (statusRank[message.delivery_status] || 0) > (statusRank[serverMessage.delivery_status] || 0)
        ? message.delivery_status
        : serverMessage.delivery_status;
      merged.set(key, { ...message, ...serverMessage, delivery_status: preferredStatus });
    }
  }
  return Array.from(merged.values())
    .sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      || keyFor(a).localeCompare(keyFor(b))
    )
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
  const [telegramRefreshWarning, setTelegramRefreshWarning] = useState('');
  const [telegramInfo, setTelegramInfo] = useState('');
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [telegramSending, setTelegramSending] = useState(false);
  const [openingTelegramFileId, setOpeningTelegramFileId] = useState('');
  const [activeTelegramPreview, setActiveTelegramPreview] = useState<{ message: TelegramMessage; file: Blob } | null>(null);
  const [telegramFileOpenError, setTelegramFileOpenError] = useState<{ messageId: string; message: string } | null>(null);
  const [telegramNativeOpenError, setTelegramNativeOpenError] = useState('');
  const [openingTelegramNativePreview, setOpeningTelegramNativePreview] = useState(false);
  const [telegramTemplatesOpen, setTelegramTemplatesOpen] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: '', cat: 'Utility', body: '' });
  const [templateSaving, setTemplateSaving] = useState(false);
  const [contactsCollapsed, setContactsCollapsed] = useState(false);
  const [telegramDraft, setTelegramDraft] = useState('');
  const [telegramRequestId, setTelegramRequestId] = useState('');
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
  const telegramMessageInputRef = useRef<HTMLTextAreaElement>(null);
  const whatsAppMessageInputRef = useRef<HTMLTextAreaElement>(null);
  const telegramTemplateMenuRef = useRef<HTMLDivElement>(null);
  const shouldFollowThreadRef = useRef(true);
  const activeChatRef = useRef({ clientId: '', channel });
  const c = s.clients.find((x) => x.id === s.ui.wa.client) || s.clients[0];
  activeChatRef.current = { clientId: c?.id || '', channel };
  const pendingTelegramClient = s.clients.find((client) => client.id === pendingTelegramClientId);
  const pendingTelegramForCurrentClient = !!pendingTelegramMsg && pendingTelegramClientId === c?.id;
  const pendingTelegramForOtherClient = !!pendingTelegramMsg && !!pendingTelegramClientId && pendingTelegramClientId !== c?.id;
  const visibleClients = s.clients.filter((client) => client.name.toLocaleLowerCase().includes(clientSearch.trim().toLocaleLowerCase()));
  const thread = c ? (s.threads[c.id] || []).slice().sort((a, b) => a.at.getTime() - b.at.getTime()) : [];
  const isTelegramConversationLoading = channel === 'telegram' && !!c && telegramConversationClientId !== c.id;
  const isTelegramLinkedForCurrentClient = !!c && telegramConversationClientId === c.id && telegramLinked;
  const clientIds = s.clients.map((client) => client.id).join(',');

  useEffect(() => {
    setTelegramTemplatesOpen(false);
    setComposerExpanded(false);
    setActiveTelegramPreview(null);
    setTelegramFileOpenError(null);
    setTelegramNativeOpenError('');
  }, [channel, c?.id]);

  useLayoutEffect(() => {
    if (!composerExpanded) return;
    const textarea = channel === 'telegram'
      ? telegramMessageInputRef.current
      : whatsAppMessageInputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = 168;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input, channel, composerExpanded]);

  function openComposer() {
    setComposerExpanded(true);
    scrollThreadToLatest('smooth');
    requestAnimationFrame(() => {
      const textarea = channel === 'telegram'
        ? telegramMessageInputRef.current
        : whatsAppMessageInputRef.current;
      if (!textarea?.disabled) textarea?.focus();
    });
  }

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

  const scrollThreadToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    shouldFollowThreadRef.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const threadElement = threadRef.current;
      if (threadElement) threadElement.scrollTo({ top: threadElement.scrollHeight, behavior });
    }));
  }, []);

  useEffect(() => {
    if (!shouldFollowThreadRef.current) return;
    scrollThreadToLatest('auto');
  }, [thread.length, telegramMessages, pendingTelegramMsg, isEditingPending, telegramConversationClientId, s.ui.wa.tab, scrollThreadToLatest]);

  useEffect(() => {
    if (!telegramTemplatesOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!telegramTemplateMenuRef.current?.contains(event.target as Node)) setTelegramTemplatesOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTelegramTemplatesOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [telegramTemplatesOpen]);

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
    let hasLoadedConversation = telegramConversationClientId === c.id;
    if (!hasLoadedConversation) {
      shouldFollowThreadRef.current = true;
      setTelegramLinked(false);
    }
    setTelegramError('');
    setTelegramRefreshWarning('');
    const load = async () => {
      if (loadingConversation) return;
      loadingConversation = true;
      try {
        const conversation = await fetchTelegramMessages(c.id);
        if (active) {
          hasLoadedConversation = true;
          setTelegramLinked(conversation.linked);
          setTelegramMessages((current) => {
            const merged = mergeTelegramMessages(conversation.messages, current, c.id);
            return sameTelegramMessages(current, merged) ? current : merged;
          });
          setTelegramConversationClientId(c.id);
          setTelegramError('');
          setTelegramRefreshWarning('');
        }
      }
      catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : 'Telegram is unavailable.';
          if (!hasLoadedConversation) {
            setTelegramLinked(false);
            setTelegramConversationClientId(c.id);
            setTelegramError(message);
          } else {
            setTelegramRefreshWarning('Live refresh is temporarily unavailable. Previously loaded messages remain visible.');
            console.warn('Telegram conversation refresh failed; keeping the current conversation visible.', error);
          }
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

  // Load message templates from backend
  useEffect(() => {
    let active = true;
    async function loadTemplates() {
      setTemplatesLoading(true);
      setTemplateError('');
      try {
        const data = await fetchTemplates();
        if (active) setTemplates(data);
      } catch (error) {
        if (active) {
          setTemplateError(error instanceof Error ? error.message : 'Could not load templates.');
        }
      } finally {
        if (active) setTemplatesLoading(false);
      }
    }
    void loadTemplates();
  }, []);

  function startTemplateEdit(template?: MessageTemplate) {
    setEditingTemplate(template || null);
    setTemplateEditorOpen(true);
    setTemplateForm(template
      ? { name: template.name, cat: template.cat, body: template.body }
      : { name: '', cat: 'Utility', body: '' });
    setTemplateError('');
  }

  async function saveTemplate() {
    if (templateSaving) return;
    setTemplateSaving(true);
    setTemplateError('');
    try {
      const payload = {
        name: templateForm.name.trim(),
        cat: templateForm.cat.trim() || 'Utility',
        body: templateForm.body.trim(),
      };
      if (editingTemplate) {
        const updated = await updateTemplate(editingTemplate.id, payload);
        setTemplates((current) => current.map((item) => item.id === updated.id ? updated : item));
      } else {
        const created = await createTemplate(payload);
        setTemplates((current) => [...current, created]);
      }
      setTemplateEditorOpen(false);
      setEditingTemplate(null);
      setTemplateForm({ name: '', cat: 'Utility', body: '' });
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Could not save template.');
    } finally {
      setTemplateSaving(false);
    }
  }

  async function removeTemplate(template: MessageTemplate) {
    if (template.protected || !window.confirm(`Delete the "${template.name}" template?`)) return;
    setTemplateError('');
    try {
      await deleteTemplate(template.id);
      setTemplates((current) => current.filter((item) => item.id !== template.id));
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Could not delete template.');
    }
  }

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

  async function openTelegramFile(message: TelegramMessage, inlineFile?: Blob, preferNative = true) {
    if (!message.vault_file_ref || openingTelegramFileId) return;
    if (inlineFile) {
      setTelegramFileOpenError(null);
      setTelegramNativeOpenError('');
      setActiveTelegramPreview({ message, file: inlineFile });
      return;
    }
    setOpeningTelegramFileId(message.id);
    setTelegramFileOpenError(null);
    try {
      const file = await fetchDocumentPreview(message.vault_file_ref);
      if (activeChatRef.current.clientId !== message.client_id || activeChatRef.current.channel !== 'telegram') return;
      if (preferNative) {
        try {
          if (await openWithDefaultApp(file, message.telegram_file_name || message.body || 'telegram-attachment')) {
            setTelegramInfo(`Opened ${message.telegram_file_name || 'the attachment'} with the default app on this computer.`);
            return;
          }
        } catch (nativeError) {
          setTelegramNativeOpenError(nativeError instanceof Error ? nativeError.message : 'A default app could not open this file. You can still preview or download it here.');
        }
      }
      setActiveTelegramPreview({
        message,
        file: new Blob([file], { type: message.mime_type || file.type || 'application/octet-stream' }),
      });
      if (!preferNative || !supportsNativeFileOpen()) setTelegramNativeOpenError('');
    } catch (error) {
      if (activeChatRef.current.clientId === message.client_id && activeChatRef.current.channel === 'telegram') {
        setTelegramFileOpenError({
          messageId: message.id,
          message: error instanceof Error ? error.message : 'Could not open this Telegram attachment.',
        });
      }
    } finally {
      setOpeningTelegramFileId('');
    }
  }

  async function openTelegramPreviewNative() {
    if (!activeTelegramPreview) return;
    setOpeningTelegramNativePreview(true);
    setTelegramNativeOpenError('');
    try {
      await openWithDefaultApp(
        activeTelegramPreview.file,
        activeTelegramPreview.message.telegram_file_name || activeTelegramPreview.message.body || 'telegram-attachment',
      );
    } catch (error) {
      setTelegramNativeOpenError(error instanceof Error ? error.message : 'The file could not be opened by a default application.');
    } finally {
      setOpeningTelegramNativePreview(false);
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
    scrollThreadToLatest();
  }

  async function confirmTelegramSend() {
    const messageText = telegramDraft;
    if (!messageText || telegramSending || !c || pendingTelegramClientId !== c.id) return;
    const targetClientId = pendingTelegramClientId;
    const requestId = telegramRequestId || crypto.randomUUID();
    setTelegramSending(true);
    setTelegramError('');
    setTelegramInfo('Sending message through Telegram…');
    try {
      const optimisticMessage: TelegramMessage = {
        id: `local-${requestId}`,
        client_id: targetClientId,
        provider_message_id: `taxflow:${requestId}`,
        direction: 'outbound',
        chat_id: '',
        body: messageText,
        message_type: 'text',
        delivery_status: 'sending',
        created_at: new Date().toISOString(),
      };
      setTelegramMessages((current) => mergeTelegramMessages(
        [optimisticMessage],
        current,
        targetClientId,
      ));
      scrollThreadToLatest();
      setPendingTelegramMsg('');
      setPendingTelegramClientId('');
      setTelegramDraft('');
      setTelegramRequestId('');
      setIsEditingPending(false);
      setEditText('');

      const sentMessage = await sendTelegramMessage(targetClientId, messageText, requestId);
      setTelegramMessages((current) => mergeTelegramMessages([sentMessage], current, targetClientId));
      setPendingTelegramMsg('');
      setPendingTelegramClientId('');
      setTelegramDraft('');
      setTelegramRequestId('');
      setTelegramInfo('Message sent through Telegram.');
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
        <button type="button" className="btn sm inbox-schedule-btn" onClick={() => setShowSchedule(true)}>
          <Icon name="plus" size={13} />Schedule
        </button>
        {channel === 'telegram' && <button className="btn sm wa-connect-btn" onClick={() => void connectTelegram()} disabled={telegramLoading || isTelegramConversationLoading || telegramConnecting || !telegramReady}>
          {telegramConnecting && <span className="spin" />}
          {telegramConnecting ? 'Connecting…' : isTelegramLinkedForCurrentClient ? 'Reconnect client' : 'Connect client'}
        </button>}
        {!whatsAppReady && channel === 'whatsapp' && <small className="wa-config-note">Configure Meta API credentials on the backend.</small>}
      </div>

      {s.ui.wa.tab === 'chats' && <div className={`card wa${contactsCollapsed ? ' contacts-collapsed' : ''}`} id="inbox-panel-chats" role="tabpanel" aria-labelledby="inbox-tab-chats">
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
                <button
                  type="button"
                  key={cl.id}
                  className={'wa-c' + (isSelected ? ' on' : '') + (clUnread > 0 ? ' has-unread' : '')}
                  aria-label={`${cl.name}${clUnread ? `, ${clUnread} unread messages` : ''}`}
                  aria-pressed={isSelected}
                  title={cl.name}
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
                </button>
              );
            })}
          </div>
          <div className={`wa-r${composerExpanded ? ' composer-open' : ''}`}>
            <div className="wa-h">
              <div className="row">
                <button
                  type="button"
                  className="wa-contacts-toggle"
                  onClick={() => setContactsCollapsed((collapsed) => !collapsed)}
                  aria-label={contactsCollapsed ? 'Show conversations list' : 'Collapse conversations list'}
                  aria-expanded={!contactsCollapsed}
                  title={contactsCollapsed ? 'Show conversations' : 'Collapse conversations'}
                >
                  <Icon name="chev" size={15} />
                </button>
                <span className="av lg wa-chat-avatar" style={{ ['--t' as any]: c.tone }}>{c.short.slice(0, 2).toUpperCase()}</span>
                <div className="wa-chat-identity">
                  <b>{c.name}</b>
                  <small className="wa-chat-subtitle">
                    <i className={channel === 'telegram'
                      ? (isTelegramLinkedForCurrentClient ? 'connected' : 'disconnected')
                      : (whatsAppLoading ? 'pending' : whatsAppReady ? 'connected' : 'disconnected')} />
                    {channel === 'telegram'
                      ? `${isTelegramLinkedForCurrentClient ? 'Telegram connected' : 'Telegram not linked'} · ${c.contact} · ${c.phone}`
                      : `${whatsAppLoading ? 'Checking WhatsApp' : whatsAppReady ? 'WhatsApp connected' : 'WhatsApp unavailable'} · ${c.contact} · ${c.phone}`}
                  </small>
                </div>
                <span className="sp" />
              </div>
              <div className="ckl">
                {s.checks[c.id]?.map((x, i) => (
                  <span key={i} className={'chip ' + (x.ok ? 'green' : 'amber')}><Icon name={x.ok ? 'check' : 'clock'} size={12} />{x.n}</span>
                ))}
              </div>
            </div>
            <div
              id="wa-thread"
              ref={threadRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                shouldFollowThreadRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
              }}
            >
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
              {channel === 'telegram' && telegramRefreshWarning && (
                <div className="telegram-notice telegram-refresh-warning" role="status">{telegramRefreshWarning}</div>
              )}
              {channel === 'telegram' && isTelegramLinkedForCurrentClient && !isTelegramConversationLoading && telegramMessages.map((m) => {
                const hasAttachment = Boolean(m.telegram_file_name || m.vault_file_ref || m.file_download_pending || m.file_download_error);
                const attachmentName = m.telegram_file_name || m.body;
                const isInlineImage = m.direction === 'inbound'
                  && Boolean(m.vault_file_ref)
                  && (m.mime_type?.startsWith('image/') || ['image', 'photo'].includes(m.message_type));
                return (
                  <div key={m.provider_message_id || m.id} className={'msg ' + (m.direction === 'outbound' ? 'me' : 'cl')}>
                    {hasAttachment ? (
                      <>
                        {m.body && m.body !== attachmentName && <div className="tg-file-caption">{m.body}</div>}
                        {isInlineImage && (
                          <TelegramInlineImage
                            message={m}
                            onOpen={(message, file) => void openTelegramFile(message, file, false)}
                            onLoaded={() => { if (shouldFollowThreadRef.current) scrollThreadToLatest('auto'); }}
                          />
                        )}
                        <FileArtifactCard
                          fileName={attachmentName}
                          mimeType={m.mime_type}
                          detailText={`${m.message_type.replace(/_/g, ' ')} attachment`}
                          sizeText={formatAttachmentSize(m.file_size)}
                          statusText={m.direction === 'outbound'
                            ? m.delivery_status === 'sent'
                              ? 'Sent to client through Telegram'
                              : m.delivery_status === 'failed'
                                ? 'Delivery failed; check Telegram before retrying'
                                : 'Sending through Telegram…'
                            : m.vault_file_ref
                              ? 'Saved securely in the client vault'
                              : 'Telegram files are not downloaded. Ask the client to upload through their secure portal.'}
                          onOpen={m.vault_file_ref ? () => void openTelegramFile(m) : undefined}
                          openLabel={supportsNativeFileOpen() ? 'Open with default app' : 'Preview file'}
                          opening={openingTelegramFileId === m.id}
                        />
                        {telegramFileOpenError?.messageId === m.id && <small className="tg-file-error">{telegramFileOpenError.message}</small>}
                      </>
                    ) : <div className="wa-message-body">{m.body}</div>}
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
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
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
                    <button className="btn sm" onClick={() => void sendReminder(r)} disabled={sendingReminderId === r.id || whatsAppLoading || !whatsAppReady}>
                      {sendingReminderId === r.id ? 'Sending…' : 'Send now'}
                    </button>
                    <button className="btn sm gh" onClick={() => dispatch({ type: 'REM_CANCEL', id: r.id })}>Cancel</button>
                  </div>
                  {reminderSendErrors[r.id] && <small className="wa-reminder-error">{reminderSendErrors[r.id]}</small>}
                </div>
              ))}
            </div>
            <div className={`wa-compose-dock${composerExpanded ? ' expanded' : ''}`}>
              {composerExpanded ? (
                <>
                  <div className="wa-compose-heading">
                    <span className="wa-compose-heading-icon"><Icon name="chat" size={14} /></span>
                    <span><b>Message {c.contact.split(' ')[0]}</b><small>via {channel === 'telegram' ? 'Telegram' : 'WhatsApp'}</small></span>
                    <button
                      type="button"
                      className="wa-compose-collapse"
                      onClick={() => { setComposerExpanded(false); setTelegramTemplatesOpen(false); }}
                      aria-label="Collapse message composer"
                      title="Collapse composer"
                    >
                      <Icon name="chev" size={15} />
                    </button>
                  </div>
                  {channel === 'telegram' ? (
                <div className="wa-f telegram-composer">
                  <div className="wa-shortcuts" aria-label="Message shortcuts">
                    <span className="wa-shortcuts-label"><Icon name="bolt" size={11} />Shortcuts</span>
                    {templates.slice(0, 4).map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className="wa-shortcut"
                        onClick={() => {
                          setInput(fillTpl(template.body, c.contact.split(' ')[0]));
                          requestAnimationFrame(() => telegramMessageInputRef.current?.focus());
                        }}
                        disabled={telegramSending || !!pendingTelegramMsg || isEditingPending}
                        title={`Insert ${template.name}`}
                      >
                        {template.name}
                      </button>
                    ))}
                  </div>
                <div className="telegram-composer-pill">
                  <div className="telegram-file-policy" role="note">Share files through the secure client portal.</div>
                  <div className="telegram-template-anchor" ref={telegramTemplateMenuRef}>
                    <button
                      type="button"
                      className="telegram-composer-action telegram-template-trigger"
                      aria-label="Insert a message template"
                      aria-expanded={telegramTemplatesOpen}
                      aria-controls="telegram-template-menu"
                      title="Choose a message template"
                      onClick={() => setTelegramTemplatesOpen((open) => !open)}
                      disabled={telegramSending || !!pendingTelegramMsg || isEditingPending}
                    >
                      <Icon name="file" size={17} />
                    </button>
                    {telegramTemplatesOpen && (
                      <div className="telegram-template-menu" id="telegram-template-menu" role="menu" aria-label="Telegram message templates">
                        <div className="telegram-template-menu-heading">
                          <b>Message templates</b>
                          <small>Choose a prepared message to edit</small>
                        </div>
                        {templates.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            role="menuitem"
                            className="telegram-template-option"
                            onClick={() => {
                              setInput(fillTpl(template.body, c.contact.split(' ')[0]));
                              setTelegramTemplatesOpen(false);
                              requestAnimationFrame(() => telegramMessageInputRef.current?.focus());
                            }}
                          >
                            <span className="telegram-template-option-icon"><Icon name="file" size={14} /></span>
                            <span><b>{template.name}</b><small>{fillTpl(template.body, c.contact.split(' ')[0])}</small></span>
                            <span className="chip blue">{template.cat}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                    <textarea
                    ref={telegramMessageInputRef}
                    className="inp telegram-composer-input"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setTelegramTemplatesOpen(false);
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        requestTelegramSend();
                      }
                      if (event.key === 'Escape') setComposerExpanded(false);
                    }}
                    placeholder={
                      pendingTelegramForOtherClient
                        ? `Review the pending message for ${pendingTelegramClient?.short || 'another client'} first…`
                        : pendingTelegramForCurrentClient || isEditingPending
                          ? isEditingPending
                            ? 'Finish editing the message above first…'
                            : 'Approve, edit, or discard the pending message first…'
                          : `Message ${c.contact.split(' ')[0]} via Telegram`
                    }
                    disabled={telegramSending || telegramLoading || isTelegramConversationLoading || !!pendingTelegramMsg || isEditingPending}
                    aria-label="Message input"
                  />
                    <button
                    type="button"
                    className="telegram-composer-send"
                    onClick={requestTelegramSend}
                    disabled={!input.trim() || !telegramReady || !isTelegramLinkedForCurrentClient || isTelegramConversationLoading || telegramSending || telegramLoading || !!pendingTelegramMsg || isEditingPending}
                    aria-label="Review message before sending"
                    title="Review message"
                  >
                    {telegramSending ? <span className="spin spin-light" /> : <Icon name="send" size={17} />}
                  </button>
                </div>
                <small className="telegram-composer-hint">Messages are reviewed before they are sent.</small>
              </div>
            ) : (
              <div className="wa-f">
                <label className="wa-template-picker">
                  <Icon name="file" size={14} />
                  <select
                    className="sel"
                    aria-label="Insert template"
                    value=""
                    onChange={(event) => {
                      const template = templates.find((item) => item.id === event.target.value);
                      if (template) setInput(fillTpl(template.body, c.contact.split(' ')[0]));
                    }}
                  >
                    <option value="">Insert template</option>
                    {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                  </select>
                </label>
                <textarea
                  ref={whatsAppMessageInputRef}
                  className="inp wa-compose-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                    if (event.key === 'Escape') setComposerExpanded(false);
                  }}
                  placeholder={whatsAppLoading
                    ? 'Checking WhatsApp API status…'
                    : !whatsAppReady
                      ? 'WhatsApp API not configured (switch to Telegram or add env vars)'
                      : `Message ${c.contact.split(' ')[0]} via WhatsApp`}
                  disabled={whatsAppLoading || !whatsAppReady || whatsAppSending}
                  aria-label="Message input"
                />
                <button
                  type="button"
                  className="btn pri"
                  onClick={() => void send()}
                  disabled={!input.trim() || whatsAppLoading || !whatsAppReady || whatsAppSending}
                  aria-label="Send message"
                >
                  {whatsAppSending ? <span className="spin spin-light" /> : <Icon name="send" size={15} />}
                </button>
              </div>
            )}
                  <div className="wa-footer-note" role="status">
                    <Icon name="lock" size={11} />
                    <span>Messages are sent through the selected channel. Delivery status appears in each message.</span>
                    <span className="wa-footer-channel">{channel === 'telegram' ? 'Telegram gateway' : 'WhatsApp Business'}</span>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="wa-compose-launcher"
                  onClick={openComposer}
                  aria-label={`Write a message to ${c.contact.split(' ')[0]}`}
                  title="Write a message"
                >
                  <Icon name="chat" size={18} />
                  <span className="wa-compose-launcher-plus"><Icon name="plus" size={11} /></span>
                </button>
              )}
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
                          <span className="chip blue">{templates.find((template) => template.id === reminder.tpl)?.name || 'Reminder'}</span>
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
        <div id="inbox-panel-templates" role="tabpanel" aria-labelledby="inbox-tab-templates">
          <div className="row" style={{ marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0 }}>Message templates</h2>
              <small>Templates include the authenticated client portal link. Do not send sensitive files through Telegram.</small>
            </div>
            <span className="sp" />
            {!templateEditorOpen && <button className="btn pri" onClick={() => startTemplateEdit()}><Icon name="plus" size={14} />New template</button>}
          </div>
          {templateError && <div className="empty error" role="alert">{templateError}</div>}
          {templateEditorOpen ? (
            <section className="card" style={{ marginBottom: 16, padding: 16 }}>
              <h3>{editingTemplate ? `Edit ${editingTemplate.name}` : 'Create template'}</h3>
              <div className="mgrid">
                <div className="mrow">
                  <label className="f" htmlFor="template-name">Name</label>
                  <input id="template-name" className="inp" maxLength={200} value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} />
                </div>
                <div className="mrow">
                  <label className="f" htmlFor="template-category">Category</label>
                  <input id="template-category" className="inp" maxLength={50} value={templateForm.cat} onChange={(event) => setTemplateForm((current) => ({ ...current, cat: event.target.value }))} />
                </div>
              </div>
              <div className="mrow">
                <label className="f" htmlFor="template-body">Message</label>
                <textarea id="template-body" className="inp" rows={5} maxLength={5000} value={templateForm.body} onChange={(event) => setTemplateForm((current) => ({ ...current, body: event.target.value }))} />
                <small>Use {'{name}'} for the client name. The secure portal link is added automatically.</small>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn gh" onClick={() => { setTemplateEditorOpen(false); setEditingTemplate(null); setTemplateError(''); }}>Cancel</button>
                <button className="btn pri" onClick={() => void saveTemplate()} disabled={templateSaving || !templateForm.name.trim() || !templateForm.body.trim()}>
                  {templateSaving ? 'Saving…' : 'Save template'}
                </button>
              </div>
            </section>
          ) : null}
          {templatesLoading && <div className="empty" role="status">Loading templates…</div>}
          {!templatesLoading && !templates.length && !templateError && <div className="empty">No templates are available yet.</div>}
          <div className="wa-template-grid">
          {templates.map((template) => (
            <article className="card tpl wa-template-card" key={template.id}>
              <div className="row">
                <b>{template.name}</b><span className="sp" /><span className="chip blue">{template.cat}</span>
                {template.protected && <span className="chip green">Protected</span>}
              </div>
              <p>{template.body}</p>
              <div className="wa-template-footer">
                <button className="btn sm" onClick={() => startTemplateEdit(template)}>Edit</button>
                <button className="btn sm gh" onClick={() => void removeTemplate(template)} disabled={template.protected} title={template.protected ? 'Core templates cannot be deleted' : 'Delete template'}>Delete</button>
                <span className="sp" />
                <button
                  className="btn sm"
                  onClick={() => {
                    setInput(fillTpl(template.body, c.contact.split(' ')[0]));
                    setComposerExpanded(true);
                    dispatch({ type: 'WA_TAB', tab: 'chats' });
                    scrollThreadToLatest('smooth');
                  }}
                >
                  Use template
                </button>
              </div>
            </article>
          ))}
          </div>
        </div>
      )}

      {activeTelegramPreview && (
        <DocumentPreviewDialog
          file={activeTelegramPreview.file}
          fileName={activeTelegramPreview.message.telegram_file_name || activeTelegramPreview.message.body || 'telegram-attachment'}
          mimeType={activeTelegramPreview.message.mime_type}
          onClose={() => setActiveTelegramPreview(null)}
          onOpenNative={supportsNativeFileOpen() ? () => void openTelegramPreviewNative() : undefined}
          openingNative={openingTelegramNativePreview}
          nativeError={telegramNativeOpenError}
        />
      )}

      {showSchedule && <ScheduleModal onClose={() => setShowSchedule(false)} defaultClient={c.id} templates={templates} />}

    </div>
  );
}

function ScheduleModal({ onClose, defaultClient, templates }: { onClose: () => void; defaultClient: string; templates: MessageTemplate[] }) {
  const s = useAppState();
  const dispatch = useDispatch();
  const [client, setClient] = useState(defaultClient);
  const [tpl, setTpl] = useState(templates[0]?.id || '');
  const d = new Date(vnow()); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
  const [when, setWhen] = useState(toInput(d));
  const c = s.clients.find((x) => x.id === client)!;
  const t = templates.find((x) => x.id === tpl);
  const [text, setText] = useState(t ? fillTpl(t.body, c.contact.split(' ')[0]) : '');

  return (
    <div className="modal" role="dialog" aria-label="Schedule reminder" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mbox">
        <h2>Schedule a WhatsApp reminder</h2>
        <div className="mgrid">
          <div className="mrow">
            <label className="f">Client</label>
            <select className="sel" value={client} onChange={(e) => { setClient(e.target.value); const cc = s.clients.find((x) => x.id === e.target.value)!; const selectedTemplate = templates.find((item) => item.id === tpl); if (selectedTemplate) setText(fillTpl(selectedTemplate.body, cc.contact.split(' ')[0])); }}>
              {s.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
            </select>
          </div>
          <div className="mrow">
            <label className="f">Template</label>
            <select className="sel" value={tpl} onChange={(e) => { setTpl(e.target.value); const tt = templates.find((x) => x.id === e.target.value); if (tt) setText(fillTpl(tt.body, c.contact.split(' ')[0])); }}>
              {templates.map((tt) => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
            </select>
          </div>
          <div className="mrow"><label className="f">Send on</label><input className="inp" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
        </div>
        <div className="mrow"><label className="f">Message preview</label><textarea className="inp" rows={4} value={text} onChange={(e) => setText(e.target.value)} /></div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn gh" onClick={onClose}>Cancel</button>
          <button
            className="btn pri"
            disabled={!templates.length || !text.trim()}
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
