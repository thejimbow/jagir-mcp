import { isValidJalaaliDate, toGregorian, toJalaali } from 'jalaali-js';

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DAY_MS = 86_400_000;
const TEHRAN_OFFSET_MS = 3.5 * 3_600_000;
export const MAX_NIGHTS = 60;

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function toLatinDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
}

/** Accepts Gregorian or Jalali (year 1300–1499) YYYY-MM-DD, returns Gregorian YYYY-MM-DD. */
export function normalizeDate(input: string): string {
  const m = DATE_RE.exec(toLatinDigits(input.trim()).replace(/\//g, '-'));
  if (!m) throw new Error(`Invalid date "${input}". Use YYYY-MM-DD (Gregorian or Jalali).`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y >= 1300 && y < 1500) {
    if (!isValidJalaaliDate(y, mo, d)) throw new Error(`Invalid Jalali date "${input}".`);
    const g = toGregorian(y, mo, d);
    return fmt(g.gy, g.gm, g.gd);
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Invalid date "${input}".`);
  }
  return fmt(y, mo, d);
}

export function addDays(date: string, days: number): string {
  return new Date(utc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((utc(checkOut) - utc(checkIn)) / DAY_MS);
}

/** Every night of a stay: checkIn inclusive, checkOut exclusive. */
export function eachNight(checkIn: string, checkOut: string): string[] {
  return Array.from({ length: Math.max(0, nightsBetween(checkIn, checkOut)) }, (_, i) => addDays(checkIn, i));
}

export function toJalaliString(date: string): string {
  const [y, m, d] = parts(date);
  const j = toJalaali(y, m, d);
  return fmt(j.jy, j.jm, j.jd);
}

/** 2026-10-15 → 20261015 (Jabama search body format). */
export function compactDate(date: string): number {
  return Number(date.replace(/-/g, ''));
}

export function todayTehran(now: Date = new Date()): string {
  return new Date(now.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
}

export function validateStayDates(
  checkIn: string,
  checkOut: string,
  today: string = todayTehran(),
): { checkIn: string; checkOut: string; nights: number } {
  const ci = normalizeDate(checkIn);
  const co = normalizeDate(checkOut);
  if (ci < today) throw new Error(`checkIn ${ci} is in the past (today is ${today}).`);
  const nights = nightsBetween(ci, co);
  if (nights < 1) throw new Error('checkOut must be after checkIn.');
  if (nights > MAX_NIGHTS) throw new Error(`Stays longer than ${MAX_NIGHTS} nights are not supported.`);
  return { checkIn: ci, checkOut: co, nights };
}
