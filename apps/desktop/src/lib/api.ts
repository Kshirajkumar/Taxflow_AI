// TaxFlow.AI — API Client Service (Production Grade)
// All API calls require Authorization header when user is authenticated.

const API_BASE_URL = 'http://localhost:5000/api/v1';

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
  vaultFolder?: string;
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
  const res = await fetch(`${API_BASE_URL}/auth/me`, { headers: authHeaders() });
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
      assigned_ca: clientData.assignedCA || null,
      filing_types: clientData.filingTypes || [],
  };
    const res = await fetch(`${API_BASE_URL}/clients`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message || `Failed to save client (HTTP ${res.status}).`);
    return json.data;
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
      filing_types: clientData.filingTypes || [],
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.message || `Failed to update client (HTTP ${res.status}).`);
  return json.data;
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

export async function uploadToLocalVault(payload: {
  clientId: string;
  fileName: string;
  fileType: string;
  category: string;
  fileBase64?: string;
  source?: string;
}): Promise<DocumentItem | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/documents/upload-vault`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    return json.data;
  } catch (err) {
    console.error('Local Vault upload failed', err);
    return null;
  }
}

export function getVaultFileUrl(docId: string): string {
  return `${API_BASE_URL}/vault/files/${docId}`;
}

export async function verifyDocumentExtraction(documentId: string, verifiedBy = 'CA Admin') {
  try {
    const res = await fetch(`${API_BASE_URL}/extraction/verify`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ documentId, verifiedBy })
    });
    return await res.json();
  } catch (err) {
    console.error('Failed to verify document', err);
    return null;
  }
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
