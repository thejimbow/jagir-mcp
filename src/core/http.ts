export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const DEFAULT_TIMEOUT_MS = 15_000;

type QueryScalar = string | number | boolean;
export type QueryValue = QueryScalar | QueryScalar[] | null | undefined;

export interface HttpRequest {
  method?: 'GET' | 'POST';
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type HttpJson = <T = unknown>(url: string, req?: HttpRequest) => Promise<T>;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function buildUrl(url: string, query: Record<string, QueryValue> = {}): string {
  const entries = Object.entries(query).filter(([, v]) => v != null);
  if (entries.length === 0) return url;
  const u = new URL(url);
  for (const [key, value] of entries) {
    if (Array.isArray(value)) for (const v of value) u.searchParams.append(key, String(v));
    else u.searchParams.set(key, String(value));
  }
  return u.toString();
}

export const httpJson: HttpJson = async <T>(url: string, req: HttpRequest = {}): Promise<T> => {
  const full = buildUrl(url, req.query);
  const host = new URL(full).host;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(full, {
      method: req.method ?? 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...req.headers,
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(`HTTP ${res.status} from ${host}`, res.status, full);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(`Invalid JSON from ${host}`, res.status, full);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if ((e as Error).name === 'AbortError') throw new HttpError(`Timeout after ${timeoutMs}ms contacting ${host}`, null, full);
    throw new HttpError(`Network error contacting ${host}: ${(e as Error).message}`, null, full);
  } finally {
    clearTimeout(timer);
  }
};
