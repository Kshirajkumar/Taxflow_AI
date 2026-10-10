export type Currency = 'INR' | 'AED' | 'GBP' | 'USD' | 'SGD';

export interface Client {
  id: string;
  name: string;
  entityType?: string;
  short: string;
  city: string;
  country: string;
  countryId?: string;
  cur: Currency;
  gstin: string;
  pan: string;
  svc: string[];
  filingTypes?: string[];
  contact: string;
  phone: string;
  fee: number;
  tone: string;
  alias: string[];
}

export type DocKind = 'Sales' | 'Purchase' | 'Expense';
export type DocSource = 'WhatsApp' | 'Email' | 'Upload';
export type DocStatus = 'queued' | 'review' | 'extracted' | 'approved';

export interface InvoiceDoc {
  id: string;
  client: string;
  kind: DocKind;
  party: string;
  gstin: string;
  no: string;
  date: Date;
  taxable: number;
  rate: number;
  src: DocSource;
  status: DocStatus;
  low: 'date' | 'taxable' | 'party' | 'gstin' | 'no' | null;
  hand: boolean;
  running: boolean;
  got: Date;
  conf: Record<string, number>;
}

export interface VaultFile {
  id: string;
  client: string;
  year: number;
  mo: number; // 0-11
  bucket: 'Raw' | 'Extracted' | 'Generated';
  name: string;
  size: number; // KB
  at: Date;
  src: string;
  docId?: string;
}

export interface Template {
  id: string;
  name: string;
  cat: string;
  body: string;
}

export interface ChatMsg {
  id: number;
  f: 'me' | 'cl' | 'sys';
  t: string;
  at: Date;
  file?: string | null;
  st: 'sent' | 'delivered' | 'read';
  auto?: boolean;
}

export interface Reminder {
  id: string;
  client: string;
  tpl: string;
  at: Date;
  repeat: 'Once' | 'Weekly';
  approve: boolean;
  status: 'scheduled' | 'sent' | 'cancelled';
  text: string;
}

export interface FilingTask {
  id: string;
  client: string;
  name: string;
  cat: string;
  due: Date;
  steps: boolean[];
}

export interface Bill {
  no: string;
  client: string;
  desc: string;
  amt: number;
  due: Date;
  status: 'paid' | 'pending' | 'overdue';
}

export interface CheckItem {
  n: string;
  ok: boolean;
}

export interface GenType {
  id: string;
  name: string;
  file: string;
  desc: string;
  ext: string;
  svc: string;
}

export interface LogEntry {
  at: Date;
  ic: string;
  t: string;
}

export type Page =
  | 'dashboard'
  | 'extract'
  | 'whatsapp'
  | 'files'
  | 'deadlines'
  | 'generate'
  | 'clients'
  | 'billing'
  | 'settings';
