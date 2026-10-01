import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import type { Platform, PlatformAdapter, SearchParams } from '../src/core/types.js';
import { makeStay } from './helpers.js';

const TODAY = '2026-10-01';

interface Seen {
  search?: SearchParams;
  calendar?: unknown[];
  quote?: unknown[];
  reviews?: unknown[];
}

function adapter(platform: Platform, seen: Seen): PlatformAdapter {
  return {
    platform,
    resolveLocation: async (q) => [{ platform, id: `${platform}-${q}`, name: q, parent: null, kind: 'city', count: 1 }],
    search: async (p) => {
      seen.search = p;
      if (platform === 'jajiga') throw new Error('jajiga down');
      return { total: 1, stays: [makeStay(platform, 1)] };
    },
    getStay: async (id) => ({
      ...makeStay(platform, Number(id)),
      description: null, amenities: [], missingAmenities: [], rules: [], checkInTime: null, checkOutTime: null, minNights: null,
      cancellationPolicy: null, basePrices: { normal: null, weekend: null, holiday: null, extraPerson: null }, ratings: null,
      areaM2: null, bathrooms: null, floor: null, beds: [], privacy: null, successfulBookings: null, discounts: [], facts: [],
      images: [], media: [],
    }),
    getReviews: async (id, limit) => {
      seen.reviews = [id, limit];
      return { id: `${platform}:${id}`, platform, url: 'u', total: 1, ratings: null, reviews: [] };
    },
    getCalendar: async (id, from, to) => {
      seen.calendar = [id, from, to];
      return [{ date: from, available: true, price: 1 }];
    },
    getQuote: async (id, checkIn, checkOut, guests) => {
      seen.quote = [id, checkIn, checkOut, guests];
      return {
        id: `${platform}:${id}`, platform, checkIn, checkOut, guests, nights: 2, nightly: [],
        extraGuestsCost: 0, fees: 0, total: 10, estimated: false, url: 'u',
      };
    },
  };
}

async function connect() {
  const seen: Record<Platform, Seen> = { jabama: {}, jajiga: {}, otaghak: {} };
  const server = createServer(
    { jabama: adapter('jabama', seen.jabama), jajiga: adapter('jajiga', seen.jajiga), otaghak: adapter('otaghak', seen.otaghak) },
    { today: () => TODAY },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
    const text = res.content[0]!.text;
    return { isError: res.isError === true, text, json: res.isError ? null : JSON.parse(text) };
  };
  return { client, call, seen };
}

describe('MCP server', () => {
  it('lists the six tools', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_quote', 'get_reviews', 'get_stay', 'get_stay_calendar', 'resolve_location', 'search_stays',
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('advertises the server icon', async () => {
    const { client } = await connect();
    const info = client.getServerVersion()!;
    expect(info).toMatchObject({ name: 'jayab-mcp', title: 'jayab' });
    expect(info.icons!.map((i) => i.mimeType)).toEqual(['image/png', 'image/svg+xml']);
    expect(info.icons![0]!.src).toMatch(/^data:image\/png;base64,iVBOR/);
  });

  it('search_stays normalizes Jalali dates and reports platform errors', async () => {
    const { call, seen } = await connect();
    const res = await call('search_stays', { location: 'رامسر', checkIn: '1405-07-23', checkOut: '1405-07-25', guests: 4 });
    expect(res.isError).toBe(false);
    expect(seen.jabama.search).toMatchObject({ checkIn: '2026-10-15', checkOut: '2026-10-17', guests: 4, sort: 'relevance', limit: 30 });
    expect(res.json.query.nights).toBe(2);
    expect(res.json.stays.map((s: { id: string }) => s.id)).toEqual(['jabama:1', 'otaghak:1']);
    expect(res.json.errors).toEqual([{ platform: 'jajiga', message: 'jajiga down' }]);
    expect(res.json.currency).toBe('IRT');
  });

  it('search_stays honours the platforms filter', async () => {
    const { call, seen } = await connect();
    await call('search_stays', { location: 'رامسر', platforms: ['otaghak'] });
    expect(seen.jabama.search).toBeUndefined();
    expect(seen.otaghak.search).toBeDefined();
  });

  it('search_stays rejects a lone checkIn', async () => {
    const { call } = await connect();
    const res = await call('search_stays', { location: 'رامسر', checkIn: '2026-10-15' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/both checkIn and checkOut/);
  });

  it('resolve_location groups by platform', async () => {
    const { call } = await connect();
    const res = await call('resolve_location', { query: 'رامسر' });
    expect(Object.keys(res.json.matches).sort()).toEqual(['jabama', 'jajiga', 'otaghak']);
  });

  it('get_stay routes by id prefix and rejects bad ids', async () => {
    const { call } = await connect();
    expect((await call('get_stay', { id: 'otaghak:7' })).json.id).toBe('otaghak:7');
    const bad = await call('get_stay', { id: '7' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Invalid stay id/);
  });

  it('get_stay_calendar defaults to a 30-day window from today', async () => {
    const { call, seen } = await connect();
    await call('get_stay_calendar', { id: 'jajiga:5' });
    expect(seen.jajiga.calendar).toEqual(['5', TODAY, '2026-10-31']);
  });

  it('get_stay_calendar caps the window at 120 days', async () => {
    const { call } = await connect();
    const res = await call('get_stay_calendar', { id: 'jajiga:5', from: '2026-10-01', to: '2027-03-01' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/120/);
  });

  it('get_reviews defaults to 50 reviews and caps at 200', async () => {
    const { call, seen } = await connect();
    expect((await call('get_reviews', { id: 'otaghak:9' })).json.id).toBe('otaghak:9');
    expect(seen.otaghak.reviews).toEqual(['9', 50]);
    await call('get_reviews', { id: 'jajiga:9', limit: 120 });
    expect(seen.jajiga.reviews).toEqual(['9', 120]);
    expect((await call('get_reviews', { id: 'jajiga:9', limit: 500 })).isError).toBe(true);
  });

  it('get_quote validates dates and forwards to the adapter', async () => {
    const { call, seen } = await connect();
    const res = await call('get_quote', { id: 'jabama:800749', checkIn: '2026-10-15', checkOut: '2026-10-17', guests: 6 });
    expect(res.json.total).toBe(10);
    expect(seen.jabama.quote).toEqual(['800749', '2026-10-15', '2026-10-17', 6]);
    const past = await call('get_quote', { id: 'jabama:1', checkIn: '2026-09-01', checkOut: '2026-09-03', guests: 2 });
    expect(past.isError).toBe(true);
  });
});
