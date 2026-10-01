/** Raw platform payloads are untyped JSON; mappers read them defensively. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = any;

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** A strictly positive number, else null (platforms use 0 for "no price"). */
export function pos(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export function rialToToman(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n / 10);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function compact<T>(xs: readonly (T | null | undefined)[]): T[] {
  return xs.filter((x): x is T => x != null);
}

export const MAX_IMAGES = 50;

/** A labelled fact, or null when the value is empty. */
export function fact(label: unknown, value: unknown): { label: string; value: string } | null {
  const l = str(label);
  const v = typeof value === 'number' ? String(value) : str(value);
  return l && v ? { label: l, value: v } : null;
}

/** Text of a list item that may be a plain string or an object with a title/name/text field. */
export function itemText(x: unknown): string | null {
  if (typeof x === 'string') return str(x);
  const o = x as Raw;
  return str(o?.title) ?? str(o?.name) ?? str(o?.text) ?? str(o?.body);
}
