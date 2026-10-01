import { readFileSync } from 'node:fs';
import type { HttpJson, HttpRequest } from '../src/core/http.js';
import type { Platform, Stay } from '../src/core/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fixture(path: string): any {
  return JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8'));
}

export interface RecordedCall {
  url: string;
  req: HttpRequest;
}

/** A fake HttpJson: the handler maps (url, request) to a JSON value or an Error to throw. */
export function fakeHttp(handler: (url: string, req: HttpRequest) => unknown) {
  const calls: RecordedCall[] = [];
  const http = (async (url: string, req: HttpRequest = {}) => {
    calls.push({ url, req });
    const out = handler(url, req);
    if (out instanceof Error) throw out;
    return out;
  }) as HttpJson;
  return { http, calls };
}

export function makeStay(platform: Platform, n: number, overrides: Partial<Stay> = {}): Stay {
  return {
    id: `${platform}:${n}`,
    platform,
    title: `${platform} ${n}`,
    city: 'رامسر',
    province: 'مازندران',
    type: 'villa',
    url: `https://example.com/${platform}/${n}`,
    image: null,
    rating: null,
    reviewsCount: null,
    capacity: { base: 2, max: 4 },
    bedrooms: 1,
    instantBooking: null,
    price: { perNight: 1_000_000, total: null, nights: null },
    location: null,
    ...overrides,
  };
}
