import type { Currency } from '../types';

export const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export const NOW = new Date(2026, 8, 19, 10, 30);
const START = Date.now();
export const vnow = () => new Date(NOW.getTime() + (Date.now() - START));

export const D = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi);
export const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60000);
const pad = (n: number) => String(n).padStart(2, '0');

export const fDate = (d: Date) => `${pad(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`;
export const fShort = (d: Date) => `${pad(d.getDate())} ${MON[d.getMonth()]}`;
export const fTime = (d: Date) => {
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${ap}`;
};
export const fDT = (d: Date) => `${fShort(d)}, ${fTime(d)}`;
export const fdmy = (d: Date) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toInput = (d: Date) => `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const dayDiff = (a: Date, b: Date) => Math.round((dayStart(a).getTime() - dayStart(b).getTime()) / 86400000);

export const until = (d: Date) => {
  const m = Math.round((d.getTime() - vnow().getTime()) / 60000);
  if (m <= 0) return 'due now';
  if (m < 60) return `in ${m} min`;
  if (m < 1440) return `in ${Math.round(m / 60)} h`;
  return `in ${Math.round(m / 1440)} d`;
};

export const agoT = (d: Date) => {
  const m = Math.round((vnow().getTime() - d.getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

export const money = (n: number, cur: Currency = 'INR') => {
  const locale = { INR: 'en-IN', AED: 'en-AE', GBP: 'en-GB' }[cur];
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${cur} ${Math.round(n)}`;
  }
};

export const num = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const sum = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((s, x) => s + f(x), 0);

export function rng(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
