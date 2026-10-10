import type {
  Client, InvoiceDoc, VaultFile, Template, ChatMsg, Reminder,
  FilingTask, Bill, CheckItem, GenType, LogEntry
} from '../types';
import { D, ago, rng, MON, MONTH_FULL } from '../lib/format';

export const CLIENTS: Client[] = [];

export const DOCS: InvoiceDoc[] = [];

export const FILES: VaultFile[] = [];

export const TPL: Template[] = [
  { id: 'docs', name: 'GST documents request', cat: 'Utility', body: 'Hello {name}, please share your {period} sales & purchase invoices by {due} so we can file {filing} on time.' },
  { id: 'pending', name: 'Missing document', cat: 'Utility', body: 'Hi {name}, we have not received the {doc} for {period} yet. Please send a photo or PDF right here on this chat.' },
  { id: 'fee', name: 'Fee payment due', cat: 'Utility', body: 'Hi {name}, our fee invoice {inv} for {amt} is due on {feedue}. You can pay securely here: pay.example.com/{inv}' },
  { id: 'filed', name: 'Filing completed', cat: 'Utility', body: 'Hi {name}, your {filing} has been filed. The acknowledgement is attached for your records.' },
];

export const STEPS: Record<string, string[]> = {
  GST: ['Collect sales & purchase documents', 'Extract & verify invoices', 'Reconcile with GSTR-2B', 'Prepare return', 'Client approval', 'File & pay'],
  TDS: ['Collect payment details', 'Compute TDS', 'Prepare challan', 'Client approval', 'File & pay'],
  ITR: ['Collect Form 16 / 26AS', 'Compute income', 'Review computation', 'Client approval', 'File & e-verify'],
  ROC: ['Collect financials', 'Prepare forms', 'Director sign-off', 'File with MCA'],
  VAT: ['Collect invoices', 'Extract & verify', 'Prepare VAT return', 'Client approval', 'Submit'],
  Audit: ['Data request', 'Fieldwork', 'Draft report', 'Management review', 'Sign & file'],
  Books: ['Collect bank statements', 'Categorise transactions', 'Reconcile', 'Review', 'Close month'],
};

export const TASKS: FilingTask[] = [];

export const REMINDERS: Reminder[] = [];

export const BILLS: Bill[] = [];

export const CHECKS: Record<string, CheckItem[]> = {};

export function seedThreads(): Record<string, ChatMsg[]> {
  return {};
}

export const GEN: GenType[] = [
  { id: 'gstr1', name: 'GSTR-1', file: 'GSTR-1', desc: 'Outward supplies as JSON for the GST portal', ext: 'json', svc: 'GST' },
  { id: 'gstr3b', name: 'GSTR-3B', file: 'GSTR-3B', desc: 'Monthly summary return with ITC as JSON', ext: 'json', svc: 'GST' },
  { id: 'recon', name: 'GSTR-2B reconciliation', file: 'GSTR-2B_Recon', desc: 'Purchase invoices matched against 2B', ext: 'xlsx', svc: 'GST' },
  { id: 'itr', name: 'ITR computation', file: 'ITR_Computation', desc: 'Income and tax workings sheet', ext: 'xlsx', svc: 'ITR' },
  { id: 'vat', name: 'VAT return workings', file: 'VAT_Workings', desc: 'UAE and UK VAT boxes with totals', ext: 'xlsx', svc: 'VAT' },
  { id: 'reg', name: 'Sales & purchase register', file: 'Register', desc: 'Invoice-wise register for the period', ext: 'xlsx', svc: '*' },
];

export const INITIAL_LOG: LogEntry[] = [];

export { MONTH_FULL };

