import type { Client, InvoiceDoc, CheckItem, FilingTask, Bill } from '../types';
import { sum, dayDiff, vnow } from './format';

export function calc(d: InvoiceDoc, client: Client) {
  const tax = Math.round((d.taxable * d.rate) / 100);
  let split: Record<string, number>;
  if (client.cur === 'INR') {
    const same = d.gstin.slice(0, 2) === client.gstin.slice(0, 2);
    split = same ? { CGST: tax / 2, SGST: tax / 2 } : { IGST: tax };
  } else {
    split = { VAT: tax };
  }
  return { tax, total: d.taxable + tax, split };
}

export function missing(checks: Record<string, CheckItem[]>, clientId: string) {
  return (checks[clientId] || []).filter((x) => !x.ok);
}

export interface TaskInfo {
  t: FilingTask;
  done: number;
  total: number;
  pct: number;
  days: number;
  st: 'done' | 'overdue' | 'soon' | 'active';
}

export function taskInfo(t: FilingTask): TaskInfo {
  const total = t.steps.length;
  const done = t.steps.filter(Boolean).length;
  const days = dayDiff(t.due, vnow());
  const st = done === total ? 'done' : days < 0 ? 'overdue' : days <= 3 ? 'soon' : 'active';
  return { t, done, total, pct: Math.round((done / total) * 100), days, st };
}

export function allTasks(tasks: FilingTask[]): TaskInfo[] {
  return tasks.map(taskInfo);
}

export function nextTaskFor(tasks: FilingTask[], clientId: string) {
  return allTasks(tasks)
    .filter((x) => x.t.client === clientId && x.st !== 'done')
    .sort((a, b) => a.days - b.days)[0];
}

export function pendingBill(bills: Bill[], clientId: string) {
  return bills
    .filter((b) => b.client === clientId && b.status !== 'paid')
    .sort((a, b) => a.due.getTime() - b.due.getTime())[0];
}

export function docTotal(docs: InvoiceDoc[], clients: Client[], f: (n: number) => number) {
  return sum(docs, (d) => {
    const c = clients.find((x) => x.id === d.client)!;
    return f(calc(d, c).total);
  });
}
