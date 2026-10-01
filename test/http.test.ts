import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUrl, HttpError, httpJson, USER_AGENT } from '../src/core/http.js';

afterEach(() => vi.unstubAllGlobals());

describe('buildUrl', () => {
  it('appends scalars and repeats arrays, skipping nullish', () => {
    const url = buildUrl('https://api.example.com/search', { 'locations[]': ['303', 'd1'], page: 1, q: undefined, x: null });
    const u = new URL(url);
    expect(u.searchParams.getAll('locations[]')).toEqual(['303', 'd1']);
    expect(u.searchParams.get('page')).toBe('1');
    expect(u.searchParams.has('q')).toBe(false);
    expect(u.searchParams.has('x')).toBe(false);
  });
  it('keeps OData parentheses in the path', () =>
    expect(buildUrl('https://h/odata/F(roomId=1,startDate=2026-10-01)')).toBe('https://h/odata/F(roomId=1,startDate=2026-10-01)'));
});

describe('httpJson', () => {
  it('sends JSON body with headers and parses the response', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await httpJson<{ ok: boolean }>('https://h/x', { method: 'POST', body: { a: 1 } });
    expect(out).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['User-Agent']).toBe(USER_AGENT);
  });

  it('throws HttpError with status on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    const err = (await httpJson('https://h/x').catch((e: unknown) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/HTTP 503 from h/);
  });

  it('throws HttpError on invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    await expect(httpJson('https://h/x')).rejects.toThrow(/Invalid JSON/);
  });

  it('times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
      ),
    );
    await expect(httpJson('https://h/x', { timeoutMs: 20 })).rejects.toThrow(/Timeout/);
  });
});
