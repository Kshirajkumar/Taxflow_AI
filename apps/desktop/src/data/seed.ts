import type {
  Client, InvoiceDoc, VaultFile, Template, ChatMsg, Reminder,
  FilingTask, Bill, CheckItem, GenType, LogEntry
} from '../types';
import { D, ago, rng, MON, MONTH_FULL } from '../lib/format';

export const CLIENTS: Client[] = [
  { id: 'sharma', name: 'Sharma Traders', short: 'Sharma', city: 'Delhi', country: 'India', cur: 'INR', gstin: '07AABCS1234F1Z5', pan: 'AABCS1234F', svc: ['GST', 'TDS', 'ITR'], contact: 'Rakesh Sharma', phone: '+91 98100 00101', fee: 8500, tone: '#4C8DFF', alias: ['sharma'] },
  { id: 'mehta', name: 'Mehta Textiles Pvt Ltd', short: 'Mehta', city: 'Surat', country: 'India', cur: 'INR', gstin: '24AABCM5521L1Z8', pan: 'AABCM5521L', svc: ['GST', 'TDS', 'ROC', 'Audit'], contact: 'Nilesh Mehta', phone: '+91 98250 00102', fee: 15000, tone: '#3DD6F5', alias: ['mehta', 'textile', 'textiles'] },
  { id: 'iyer', name: 'Iyer & Sons Pharma', short: 'Iyer', city: 'Chennai', country: 'India', cur: 'INR', gstin: '33AABFI3390D1Z4', pan: 'AABFI3390D', svc: ['GST', 'ITR'], contact: 'Suresh Iyer', phone: '+91 98400 00103', fee: 11000, tone: '#8B7CFF', alias: ['iyer', 'pharma'] },
  { id: 'nova', name: 'Nova Digital FZ-LLC', short: 'Nova', city: 'Dubai', country: 'UAE', cur: 'AED', gstin: 'TRN 100412345600003', pan: '—', svc: ['VAT', 'Books'], contact: 'Omar Haddad', phone: '+971 50 000 0106', fee: 1800, tone: '#5EEAD4', alias: ['nova', 'dubai', 'uae'] },
  { id: 'kapoor', name: 'Kapoor Jewellers', short: 'Kapoor', city: 'Jaipur', country: 'India', cur: 'INR', gstin: '08AAAFK4470H1Z6', pan: 'AAAFK4470H', svc: ['GST', 'ITR', 'Audit'], contact: 'Vikram Kapoor', phone: '+91 98290 00108', fee: 20000, tone: '#C084FC', alias: ['kapoor', 'jewel', 'jewellers'] },
];

const DOCSEED: Array<[string, string, InvoiceDoc['kind'], string, string, string, Date, number, number, InvoiceDoc['src'], InvoiceDoc['status'], InvoiceDoc['low']]> = [
  ['d1', 'sharma', 'Sales', 'Bansal Hardware', '07AAACB4521K1ZP', 'SI/26-27/1042', D(2026, 9, 12), 48200, 18, 'WhatsApp', 'approved', null],
  ['d2', 'sharma', 'Purchase', 'Om Steel Traders', '09AAFCO7712M1Z2', 'OST/8841', D(2026, 9, 8), 126500, 18, 'Email', 'extracted', null],
  ['d3', 'sharma', 'Expense', 'Blue Orbit Telecom', '07AAACB2894G1ZT', 'BO/9917', D(2026, 9, 5), 3390, 18, 'Upload', 'review', 'gstin'],
  ['d4', 'mehta', 'Purchase', 'Rajlaxmi Yarn Mills', '24AABFR3390D1ZV', 'RYM/2211', D(2026, 8, 29), 412000, 5, 'Email', 'approved', null],
  ['d5', 'mehta', 'Sales', 'Ambika Garments', '24AAGCA5522L1Z9', 'MT/26-27/0388', D(2026, 9, 3), 685000, 5, 'Upload', 'extracted', null],
  ['d6', 'mehta', 'Purchase', 'Shree Dyes & Chem', '24AAECS1183Q1ZK', 'SDC/1290', D(2026, 9, 10), 96800, 18, 'WhatsApp', 'queued', null],
  ['d7', 'iyer', 'Sales', 'Lotus Wellness Pharmacy', '33AAFCL7781H1ZD', 'IP/26-27/0771', D(2026, 9, 2), 254000, 12, 'WhatsApp', 'approved', null],
  ['d8', 'iyer', 'Purchase', 'Zenith Formulations', '27AAGCZ4410B1ZM', 'ZF/40122', D(2026, 8, 27), 318500, 12, 'Email', 'review', 'taxable' as any],
  ['d13', 'nova', 'Purchase', 'Gulf Office Supplies LLC', 'TRN 100345678900003', 'GOS-20419', D(2026, 9, 4), 8400, 5, 'Upload', 'extracted', null],
  ['d14', 'nova', 'Sales', 'Al Noor Trading', 'TRN 100298765400003', 'NV-0146', D(2026, 9, 15), 42000, 5, 'WhatsApp', 'queued', null],
  ['d17', 'kapoor', 'Purchase', 'Sona Gold Refiners', '08AAKFS6602C1ZH', 'SGR/3310', D(2026, 9, 7), 1850000, 3, 'WhatsApp', 'review', 'party'],
  ['d18', 'kapoor', 'Sales', 'Rani Jewels Retail', '08AAHFR1120K1ZS', 'KJ/26-27/0455', D(2026, 9, 13), 920000, 3, 'WhatsApp', 'approved', null],
];

function makeConf(low: InvoiceDoc['low'], hand: boolean, i: number): Record<string, number> {
  const r = rng(i * 13 + 5);
  const c: Record<string, number> = {};
  ['date', 'no', 'party', 'gstin', 'taxable', 'rate'].forEach((k) => (c[k] = Math.round((0.955 + r() * 0.04) * 100) / 100));
  if (hand) { c.date = 0.66; c.taxable = 0.84; c.no = 0.88; }
  if (low) c[low] = low === 'taxable' ? 0.74 : low === 'party' ? 0.69 : 0.71;
  return c;
}

export const DOCS: InvoiceDoc[] = DOCSEED.map((a, i) => ({
  id: a[0], client: a[1], kind: a[2], party: a[3], gstin: a[4], no: a[5], date: a[6],
  taxable: a[7], rate: a[8], src: a[9], status: a[10], low: a[11], hand: false, running: false,
  got: new Date(a[6].getTime() + 3600000 * (9 + (i % 6))), conf: makeConf(a[11], false, i),
}));

function docBase(d: InvoiceDoc) {
  return d.party.split(' ').slice(0, 2).join('_').replace(/[^A-Za-z0-9_]/g, '') + '_' + d.no.replace(/[^A-Za-z0-9]+/g, '-');
}

export const FILES: VaultFile[] = (() => {
  let fid = 1;
  const files: VaultFile[] = [];
  DOCS.forEach((d) => {
    const base = docBase(d);
    const ext = d.src === 'WhatsApp' || d.hand ? 'jpg' : 'pdf';
    files.push({ id: `f${fid++}`, client: d.client, year: d.date.getFullYear(), mo: d.date.getMonth(), bucket: 'Raw', name: `${base}.${ext}`, size: Math.round(90 + (d.taxable % 900)), at: d.got, src: d.src, docId: d.id });
    if (d.status !== 'queued') {
      files.push({ id: `f${fid++}`, client: d.client, year: d.date.getFullYear(), mo: d.date.getMonth(), bucket: 'Extracted', name: `${base}.json`, size: 3, at: d.got, src: 'Taxflow extraction', docId: d.id });
    }
  });
  CLIENTS.forEach((c, ci) => {
    const r = rng(ci + 7);
    [[2026, 7], [2026, 8]].forEach(([y, m]) => {
      const raws = [`Sales_Register_${MON[m]}${y}.xlsx`, `Bank_Statement_${MON[m]}${y}.pdf`];
      raws.forEach((n) => {
        const at = D(y, m + 1, 1 + Math.floor(r() * 27), 9 + Math.floor(r() * 9), Math.floor(r() * 59));
        files.push({ id: `f${fid++}`, client: c.id, year: y, mo: m, bucket: 'Raw', name: n, size: Math.round(80 + r() * 2400), at, src: r() > 0.5 ? 'Email' : 'Upload' });
      });
    });
  });
  return files;
})();

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

const TS: Array<[string, string, string, Date, number]> = [
  ['sharma', 'GSTR-3B (Aug)', 'GST', D(2026, 9, 20), 5],
  ['sharma', 'GSTR-1 (Sep)', 'GST', D(2026, 10, 11), 1],
  ['sharma', 'TDS payment (Sep)', 'TDS', D(2026, 10, 7), 2],
  ['mehta', 'GSTR-3B (Aug)', 'GST', D(2026, 9, 20), 3],
  ['mehta', 'ROC AOC-4', 'ROC', D(2026, 10, 30), 1],
  ['mehta', 'Tax audit report', 'Audit', D(2026, 9, 30), 3],
  ['iyer', 'GSTR-3B (Aug)', 'GST', D(2026, 9, 20), 6],
  ['iyer', 'ITR – AY 2026-27', 'ITR', D(2026, 10, 31), 3],
  ['nova', 'Bookkeeping close (Sep)', 'Books', D(2026, 10, 5), 1],
  ['nova', 'UAE VAT return (Q3)', 'VAT', D(2026, 10, 28), 2],
  ['kapoor', 'GSTR-3B (Aug)', 'GST', D(2026, 9, 20), 1],
  ['kapoor', 'ITR & tax audit', 'Audit', D(2026, 10, 31), 1],
];
export const TASKS: FilingTask[] = TS.map((a, i) => ({
  id: `t${i}`, client: a[0], name: a[1], cat: a[2], due: a[3],
  steps: STEPS[a[2]].map((_, j) => j < a[4]),
}));

const REMSEED: Array<[string, string, string, Date, Reminder['repeat'], boolean]> = [
  ['r1', 'mehta', 'pending', D(2026, 9, 19, 12, 5), 'Once', false],
  ['r2', 'kapoor', 'pending', D(2026, 9, 19, 17, 0), 'Once', true],
  ['r3', 'sharma', 'docs', D(2026, 9, 20, 10, 0), 'Once', true],
  ['r5', 'nova', 'pending', D(2026, 9, 22, 10, 0), 'Once', true],
];

function fillTpl(t: Template, c: Client): string {
  const nt = TASKS.filter((x) => x.client === c.id && !x.steps.every(Boolean)).sort((a, b) => a.due.getTime() - b.due.getTime())[0];
  const v: Record<string, string> = {
    name: c.contact.split(' ')[0],
    period: 'August 2026',
    due: nt ? nt.due.toDateString() : 'the due date',
    filing: nt ? nt.name : 'your return',
    doc: 'documents',
    inv: 'FEE/26-27/040', amt: '—', feedue: '—',
  };
  return t.body.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
}

export const REMINDERS: Reminder[] = REMSEED.map((a) => {
  const c = CLIENTS.find((x) => x.id === a[1])!;
  const t = TPL.find((x) => x.id === a[2]) || TPL[1];
  return { id: a[0], client: a[1], tpl: a[2], at: a[3], repeat: a[4], approve: a[5], status: 'scheduled', text: fillTpl(t, c) };
});

export const BILLS: Bill[] = [
  { no: 'FEE/26-27/033', client: 'sharma', desc: 'August retainer', amt: 8500, due: D(2026, 8, 31), status: 'paid' },
  { no: 'FEE/26-27/041', client: 'sharma', desc: 'September retainer', amt: 8500, due: D(2026, 9, 30), status: 'pending' },
  { no: 'FEE/26-27/034', client: 'mehta', desc: 'August compliance retainer', amt: 15000, due: D(2026, 8, 31), status: 'paid' },
  { no: 'FEE/26-27/038', client: 'mehta', desc: 'Q2 audit & ROC work', amt: 45000, due: D(2026, 9, 10), status: 'overdue' },
  { no: 'FEE/26-27/039', client: 'iyer', desc: 'GST + ITR quarterly', amt: 22000, due: D(2026, 10, 5), status: 'pending' },
  { no: 'FEE/26-27/035', client: 'nova', desc: 'Bookkeeping August', amt: 1800, due: D(2026, 9, 1), status: 'paid' },
  { no: 'FEE/26-27/042', client: 'kapoor', desc: 'Audit advance', amt: 60000, due: D(2026, 10, 10), status: 'pending' },
];

export const CHECKS: Record<string, CheckItem[]> = {
  sharma: [{ n: 'Sales invoices', ok: true }, { n: 'Purchase invoices', ok: true }, { n: 'Bank statement', ok: false }],
  mehta: [{ n: 'Sales register', ok: true }, { n: 'Purchase invoices', ok: false }, { n: 'Bank statement', ok: true }],
  iyer: [{ n: 'Sales invoices', ok: true }, { n: 'Purchase invoices', ok: true }, { n: 'Bank statement', ok: true }],
  nova: [{ n: 'Bank statements', ok: true }, { n: 'Sales invoices', ok: false }, { n: 'Purchase invoices', ok: true }],
  kapoor: [{ n: 'Sales invoices', ok: true }, { n: 'Gold purchase bills', ok: false }, { n: 'Bank statement', ok: false }],
};

const THREADS: Record<string, Array<[ChatMsg['f'], string, number, string?]>> = {
  sharma: [
    ['me', 'Namaste Rakesh ji, please share the August sales & purchase invoices and the bank statement by 15th so we can file GSTR-3B on time.', 3060],
    ['cl', 'Ji sir, aaj shaam tak bhejta hoon.', 3040],
    ['cl', '', 2900, 'IMG_20260912_1904.jpg'],
    ['sys', 'Auto-saved to Raw folder · extraction done · 1 field needs review', 2899],
    ['me', 'Hi Rakesh ji, we still need the August bank statement (HDFC). Kindly send it here as PDF.', 1640],
    ['cl', 'Kal bhej dunga sir, bank se download karna hai.', 1600],
  ],
  mehta: [
    ['me', 'Hello Nilesh ji, GSTR-1 for September is due on 11 Oct. Please share the sales register by 5 Oct.', 4300],
    ['cl', 'Noted. Accounts team will share it.', 4250],
    ['cl', '', 600, 'Rajlaxmi_Yarn_Aug.pdf'],
    ['sys', 'Auto-saved to Raw folder · duplicate invoice SDC/1290 blocked', 598],
  ],
  iyer: [
    ['me', 'Hello Suresh ji, your GSTR-3B for August is ready for approval. Please confirm.', 1500],
    ['cl', 'Approved. Please file.', 1450],
    ['me', 'Filed. The acknowledgement is attached.', 1400],
  ],
  nova: [
    ['me', 'Hello Omar, please share the September sales invoices for the VAT return.', 3500],
    ['cl', 'Sure, will send this week.', 3300],
  ],
  kapoor: [
    ['me', 'Namaste Vikram ji, the GSTR-3B for August needs the gold purchase bills and the stock statement.', 6200],
    ['cl', 'Purchase bills mil rahe hain, thoda time lagega.', 6100],
  ],
};

export function seedThreads(): Record<string, ChatMsg[]> {
  let mid = 1;
  const out: Record<string, ChatMsg[]> = {};
  Object.keys(THREADS).forEach((k) => {
    out[k] = THREADS[k].map((a) => ({ id: mid++, f: a[0], t: a[1], at: ago(a[2]), file: a[3] || null, st: 'read' }));
  });
  return out;
}

export const GEN: GenType[] = [
  { id: 'gstr1', name: 'GSTR-1', file: 'GSTR-1', desc: 'Outward supplies as JSON for the GST portal', ext: 'json', svc: 'GST' },
  { id: 'gstr3b', name: 'GSTR-3B', file: 'GSTR-3B', desc: 'Monthly summary return with ITC as JSON', ext: 'json', svc: 'GST' },
  { id: 'recon', name: 'GSTR-2B reconciliation', file: 'GSTR-2B_Recon', desc: 'Purchase invoices matched against 2B', ext: 'xlsx', svc: 'GST' },
  { id: 'itr', name: 'ITR computation', file: 'ITR_Computation', desc: 'Income and tax workings sheet', ext: 'xlsx', svc: 'ITR' },
  { id: 'vat', name: 'VAT return workings', file: 'VAT_Workings', desc: 'UAE and UK VAT boxes with totals', ext: 'xlsx', svc: 'VAT' },
  { id: 'reg', name: 'Sales & purchase register', file: 'Register', desc: 'Invoice-wise register for the period', ext: 'xlsx', svc: '*' },
];

export const INITIAL_LOG: LogEntry[] = [
  { at: ago(8), ic: 'scan', t: 'Extracted 3 invoices from WhatsApp for Sharma Traders' },
  { at: ago(35), ic: 'send', t: 'Sent a missing-document reminder to Iyer & Sons Pharma' },
  { at: ago(74), ic: 'spark', t: 'Prepared the GSTR-3B (Aug) draft for Iyer & Sons Pharma' },
  { at: ago(140), ic: 'x', t: 'Blocked duplicate invoice SDC/1290 for Mehta Textiles' },
  { at: ago(260), ic: 'folder', t: 'Filed 6 documents into the 2026 / 09 - September folders' },
];

export { MONTH_FULL };
