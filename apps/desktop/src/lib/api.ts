// TaxFlow.AI — API Client Service (Production Grade)
// All API calls require Authorization header when user is authenticated.

const API_BASE_URL = 'http://127.0.0.1:5000/api/v1';

// ─── Token helpers ─────────────────────────────────────────────
function getToken(): string | null {
  try {
    const raw = localStorage.getItem('taxflow_session');
    if (!raw) return null;
    return JSON.parse(raw).token || null;
  } catch { return null; }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

let refreshRequest: Promise<AuthResponse | null> | null = null;

function saveSessionTokens(response: AuthResponse): void {
  if (!response.token) return;
  try {
    const raw = localStorage.getItem('taxflow_session');
    const current = raw ? JSON.parse(raw) : {};
    localStorage.setItem('taxflow_session', JSON.stringify({
      ...current,
      ...(response.user ? { user: response.user } : {}),
      token: response.token,
      refreshToken: response.refreshToken || current.refreshToken,
    }));
  } catch {
    // Continue with the in-memory response if storage is unavailable.
  }
}

async function refreshSession(): Promise<AuthResponse | null> {
  if (!refreshRequest) {
    let refreshToken: string | null = null;
    try {
      const raw = localStorage.getItem('taxflow_session');
      refreshToken = raw ? JSON.parse(raw).refreshToken || null : null;
    } catch {
      refreshToken = null;
    }

    if (!refreshToken) return null;

    refreshRequest = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (response) => {
        const data = await response.json() as AuthResponse;
        if (response.ok && data.success && data.token) {
          saveSessionTokens(data);
          return data;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        refreshRequest = null;
      });
  }
  return refreshRequest;
}

// ─── Types ─────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  name: string;
  firmName: string;
  email: string;
  practiceType: string;
  membershipNo?: string | null;
  role: string;
  onboardingComplete: boolean;
  vaultConfigured: boolean;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  token?: string;
  refreshToken?: string;
  user?: AuthUser;
  needsEmailConfirmation?: boolean;
  rateLimited?: boolean;
  secondsLeft?: number;
  remainingAttempts?: number;
}

export interface NotificationItem {
  id: string;
  event_type: string;
  title: string;
  message: string;
  entity_type?: string | null;
  entity_id?: string | null;
  metadata?: Record<string, unknown>;
  read_at?: string | null;
  created_at: string;
}

async function authRequest<T extends { success: boolean; message?: string }>(
  url: string,
  options: RequestInit,
): Promise<T> {
  let res: Response;

  try {
    res = await fetch(url, options);
  } catch {
    throw new Error(
      'The TaxFlow.AI backend is not available yet. Please wait a moment for Tauri Dev to finish starting, then try again.',
    );
  }

  let data: T;
  try {
    data = await res.json() as T;
  } catch {
    throw new Error(`The backend returned an invalid response (HTTP ${res.status}).`);
  }

  if (!res.ok && !data.message) {
    throw new Error(`The backend request failed (HTTP ${res.status}).`);
  }

  return data;
}

export interface Client {
  id: string;
  name: string;
  entityType: string;
  pan: string;
  gstin: string;
  phone: string;
  email: string;
  status: string;
  assignedCA?: string;
  filingStatus?: string;
  filingTypes?: string[];
  countryId?: string;
  countryName?: string;
  currencyCode?: string;
  vaultFolder?: string;
}

export interface SupportedCountry {
  id: string;
  country_code: string;
  country_name: string;
  tax_authority_name?: string;
  portal_name?: string;
  portal_url?: string;
  currency_code: string;
}

export interface FilingType {
  id: string;
  country_id: string;
  code: string;
  name: string;
  description?: string;
  filing_category?: string;
  filing_frequency?: string;
  output_format: string;
  accepted_file_types: string[];
  government_portal_name?: string;
  government_portal_url?: string;
  specification_version?: string;
  specification_url?: string;
  format_definition?: Record<string, unknown>;
  validation_rules?: Record<string, unknown>;
}

async function metadataRequest<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: authHeaders(), signal });
  } catch {
    throw new Error('The backend is unavailable. Please check that TaxFlow.AI is running and try again.');
  }

  let payload: { success?: boolean; message?: string; data?: T };
  try {
    payload = await response.json();
  } catch {
    throw new Error(`The backend returned an invalid response (HTTP ${response.status}).`);
  }

  if (!response.ok || !payload.success) {
    throw new Error(payload.message || `Could not load reference data (HTTP ${response.status}).`);
  }
  return payload.data || ([] as unknown as T);
}

export function fetchSupportedCountries(): Promise<SupportedCountry[]> {
  return metadataRequest<SupportedCountry[]>(`${API_BASE_URL}/metadata/countries`);
}

export function fetchFilingTypes(countryId: string, signal?: AbortSignal): Promise<FilingType[]> {
  return metadataRequest<FilingType[]>(`${API_BASE_URL}/metadata/filing-types?countryId=${encodeURIComponent(countryId)}`, signal);
}

export interface DocumentItem {
  id: string;
  clientId: string;
  clientName: string;
  fileName: string;
  fileType: string;
  fileSize?: string;
  category: string;
  source: string;
  status: string;
  vaultPath?: string;
  uploadDate: string;
  confidenceScore: number;
  extractedData?: any;
}

export interface WhatsAppMessage {
  id: string;
  clientId?: string;
  senderPhone: string;
  senderName: string;
  direction: 'inbound' | 'outbound';
  messageType: 'text' | 'document' | 'image';
  body: string;
  vaultFileRef?: string;
  timestamp: string;
  status: string;
}

export interface ComplianceTask {
  id: string;
  clientId: string;
  clientName: string;
  formType: string;
  dueDate: string;
  status: string;
  progress: number;
  assignedTo: string;
}

// ─── Auth API ──────────────────────────────────────────────────

export async function apiSignup(data: {
  name: string;
  firmName?: string;
  email: string;
  password: string;
  practiceType?: string;
  membershipNo?: string;
}): Promise<AuthResponse> {
  return authRequest<AuthResponse>(`${API_BASE_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function apiLogin(email: string, password: string): Promise<AuthResponse> {
  return authRequest<AuthResponse>(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
}

export async function apiForgotPassword(email: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  return res.json();
}

export async function apiGetMe(): Promise<AuthResponse> {
  let res = await fetch(`${API_BASE_URL}/auth/me`, { headers: authHeaders() });
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed?.token) {
      res = await fetch(`${API_BASE_URL}/auth/me`, { headers: authHeaders() });
    }
  }
  return res.json();
}

export async function apiGetMeWithToken(token: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  return res.json();
}

export async function fetchNotifications(): Promise<{ data: NotificationItem[]; unreadCount: number }> {
  const response = await fetch(`${API_BASE_URL}/notifications?limit=20`, { headers: authHeaders() });
  let payload: { success?: boolean; data?: NotificationItem[]; unreadCount?: number; message?: string };
  try { payload = await response.json(); } catch { throw new Error(`The notification service returned an invalid response (HTTP ${response.status}).`); }
  if (!response.ok || !payload.success) throw new Error(payload.message || `Could not load notifications (HTTP ${response.status}).`);
  return { data: payload.data || [], unreadCount: payload.unreadCount || 0 };
}

export async function markNotificationsRead(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/notifications/read`, { method: 'POST', headers: authHeaders() });
  if (!response.ok) throw new Error(`Could not mark notifications as read (HTTP ${response.status}).`);
}

export async function apiUpdateProfile(data: {
  name?: string;
  firmName?: string;
  practiceType?: string;
  membershipNo?: string;
}): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/profile`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(data)
  });
  return res.json();
}

export async function apiSetupVault(vaultPath: string): Promise<{ success: boolean; message: string; vaultPath?: string }> {
  const res = await fetch(`${API_BASE_URL}/auth/vault-setup`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ vaultPath })
  });
  return res.json();
}

// ─── Client API ────────────────────────────────────────────────

export async function fetchClients(): Promise<Client[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/clients`, { headers: authHeaders() });
    const json = await res.json();
    return json.data || [];
  } catch (err) {
    console.warn('Failed to fetch clients', err);
    return [];
  }
}

export async function createClient(clientData: Partial<Client>): Promise<Client | null> {
  const payload = {
      name: clientData.name,
      entity_type: clientData.entityType === 'Private Limited' ? 'Pvt Ltd' : (clientData.entityType === 'Other' ? 'Individual' : clientData.entityType),
      pan: clientData.pan || null,
      gstin: clientData.gstin || null,
      phone: clientData.phone || `not-provided-${crypto.randomUUID()}`,
      email: clientData.email || null,
      country_id: clientData.countryId || null,
      assigned_ca: clientData.assignedCA || null,
      filing_types: clientData.filingTypes || [],
  };
  try {
    const res = await fetch(`${API_BASE_URL}/clients`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    let json: any;
    try { json = await res.json(); } catch { throw new Error(`The backend returned an invalid response (HTTP ${res.status}).`); }
    if (!res.ok || !json.success) throw new Error(json.message || `Failed to save client (HTTP ${res.status}).`);
    return json.data;
  } catch (err: any) {
    if (err instanceof TypeError) {
      throw new Error('The TaxFlow.AI backend is not reachable. Start the app with “npm run dev:full” and try again.');
    }
    throw err;
  }
}

export async function updateClient(clientId: string, clientData: Partial<Client>): Promise<Client> {
  const res = await fetch(`${API_BASE_URL}/clients/${clientId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      name: clientData.name,
      entity_type: clientData.entityType,
      pan: clientData.pan || null,
      gstin: clientData.gstin || null,
      phone: clientData.phone || null,
      email: clientData.email || null,
      country_id: clientData.countryId || null,
      filing_types: clientData.filingTypes || [],
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.message || `Failed to update client (HTTP ${res.status}).`);
  return json.data;
}

export async function deleteClient(clientId: string): Promise<{ id: string; name: string; vaultWarning?: string | null }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/clients/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  } catch {
    throw new Error('The TaxFlow.AI backend is unavailable. Nothing was deleted.');
  }
  let json: any;
  try { json = await res.json(); } catch { throw new Error(`The backend returned an invalid response (HTTP ${res.status}).`); }
  if (!res.ok || !json.success) throw new Error(json.message || `Could not delete the client (HTTP ${res.status}).`);
  return json.data;
}

export interface VaultTreeEntry {
  name: string;
  type: 'folder' | 'file';
  size?: number;
  modifiedAt: string;
  children?: VaultTreeEntry[];
}

export interface VaultTreeResponse {
  clientId: string;
  clientName: string;
  root: string;
  entries: VaultTreeEntry[];
}

export async function fetchVaultTree(clientId: string): Promise<VaultTreeResponse> {
  const res = await fetch(`${API_BASE_URL}/clients/${encodeURIComponent(clientId)}/vault-tree`, { headers: authHeaders() });
  let json: any;
  try { json = await res.json(); } catch { throw new Error(`The vault returned an invalid response (HTTP ${res.status}).`); }
  if (!res.ok || !json.success) throw new Error(json.message || `Could not read the vault (HTTP ${res.status}).`);
  return json.data;
}

export async function deleteVaultFile(clientId: string, relativePath: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/clients/${encodeURIComponent(clientId)}/vault-file`, {
      method: 'DELETE',
      headers: authHeaders(),
      body: JSON.stringify({ relativePath }),
    });
  } catch {
    throw new Error('The backend is unavailable. The file was not deleted.');
  }

  let json: any;
  try { json = await res.json(); } catch { throw new Error(`The vault returned an invalid response (HTTP ${res.status}).`); }
  if (!res.ok || !json.success) throw new Error(json.message || `The file could not be deleted (HTTP ${res.status}).`);
}

// ─── Documents API ─────────────────────────────────────────────

export async function fetchDocuments(clientId?: string): Promise<DocumentItem[]> {
  try {
    const url = clientId ? `${API_BASE_URL}/documents?clientId=${clientId}` : `${API_BASE_URL}/documents`;
    const res = await fetch(url, { headers: authHeaders() });
    const json = await res.json();
    return json.data || [];
  } catch (err) {
    console.warn('Failed to fetch documents', err);
    return [];
  }
}

export async function fetchClientDocuments(clientId: string, signal?: AbortSignal): Promise<DocumentItem[]> {
  const res = await fetch(`${API_BASE_URL}/documents?clientId=${encodeURIComponent(clientId)}`, { headers: authHeaders(), signal });
  let json: any;
  try { json = await res.json(); } catch { throw new Error(`The client document list returned an invalid response (HTTP ${res.status}).`); }
  if (!res.ok || !json.success) throw new Error(json.message || `Could not load this client's files (HTTP ${res.status}).`);
  return Array.isArray(json.data) ? json.data : [];
}

export interface VaultUploadResponse {
  data?: DocumentItem;
  message?: string;
  warning?: string;
  source?: string;
  metadataSaved?: boolean;
}

export async function uploadToLocalVault(payload: {
  clientId: string;
  clientName?: string;
  fileName: string;
  fileType: string;
  category: string;
  assessmentYear?: string;
  fileBase64?: string;
  source?: string;
}): Promise<VaultUploadResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/documents/upload-vault`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error('The TaxFlow.AI backend is unavailable. Start the backend and try again.');
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error(`The backend returned an invalid upload response (HTTP ${res.status}).`);
  }
  if (!res.ok || !json.success) {
    throw new Error(json.message || `The file could not be uploaded (HTTP ${res.status}).`);
  }
  return json;
}

export function getVaultFileUrl(docId: string): string {
  return `${API_BASE_URL}/documents/${encodeURIComponent(docId)}/serve`;
}

export async function fetchDocumentPreview(documentId: string, signal?: AbortSignal): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(getVaultFileUrl(documentId), { headers: authHeaders(), signal });
  } catch {
    throw new Error('The original file could not be reached. Check that the backend and Local Vault are available.');
  }
  if (!res.ok) {
    let message = '';
    try { message = (await res.json()).message || ''; } catch {}
    throw new Error(message || `The original file could not be opened (HTTP ${res.status}).`);
  }
  return res.blob();
}

export async function verifyDocumentExtraction(documentId: string, verifiedBy = 'CA Admin', correctedData?: Record<string, unknown>) {
  try {
    const res = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(documentId)}/verify`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ verifiedBy, correctedData })
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message || `Could not save the reviewed extraction (HTTP ${res.status}).`);
    return json;
  } catch (err) {
    console.error('Failed to verify document', err);
    return null;
  }
}

export async function processDocumentExtraction(documentId: string, category = 'General') {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/extraction/process`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ documentId, category }),
    });
  } catch {
    throw new Error('The extraction service is unavailable. The uploaded file is still safe in the client vault.');
  }

  let json: any;
  try { json = await res.json(); } catch { throw new Error(`The extraction service returned an invalid response (HTTP ${res.status}).`); }
  if (!res.ok || !json.success) throw new Error(json.message || `AI extraction failed (HTTP ${res.status}).`);
  return json;
}

// ─── WhatsApp API ──────────────────────────────────────────────

export async function fetchWhatsAppMessages(): Promise<WhatsAppMessage[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/whatsapp/messages`, { headers: authHeaders() });
    const json = await res.json();
    return json.data || [];
  } catch (err) {
    console.warn('Failed to fetch WhatsApp messages', err);
    return [];
  }
}

// ─── Compliance API ────────────────────────────────────────────

export async function fetchComplianceTasks(): Promise<ComplianceTask[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/deadlines`, { headers: authHeaders() });
    const json = await res.json();
    return json.data || [];
  } catch (err) {
    console.warn('Failed to fetch compliance tasks', err);
    return [];
  }
}

// ─── Generate API ──────────────────────────────────────────────

export async function generateNoticeResponse(payload: {
  clientId: string;
  noticeText: string;
  section?: string;
}) {
  try {
    const res = await fetch(`${API_BASE_URL}/generate/notice-response`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error('Failed to generate notice response', err);
    return null;
  }
}

// ─── Health ────────────────────────────────────────────────────

export async function getHealthStatus() {
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    return await res.json();
  } catch (err) {
    return { status: 'offline' };
  }
}
