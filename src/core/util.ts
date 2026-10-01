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
