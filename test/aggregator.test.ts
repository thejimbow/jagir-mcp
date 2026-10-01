import { describe, expect, it } from 'vitest';
import { interleave, resolveAll, searchAll, sortStays } from '../src/core/aggregator.js';
import type { Platform, PlatformAdapter, SearchParams, Stay } from '../src/core/types.js';
import { makeStay } from './helpers.js';

function adapter(platform: Platform, stays: Stay[] | Error): PlatformAdapter {
  const fail = async () => {
    throw new Error('unused');
  };
  return {
    platform,
    resolveLocation: async () => {
      if (stays instanceof Error) throw stays;
      return [{ platform, id: 'x', name: 'رامسر', parent: null, kind: 'city', count: 1 }];
    },
    search: async () => {
      if (stays instanceof Error) throw stays;
      return { total: stays.length * 10, stays };
    },
    getStay: fail,
    getCalendar: fail,
    getQuote: fail,
    getReviews: fail,
  };
}

const params = (over: Partial<SearchParams> = {}): SearchParams => ({ location: 'رامسر', sort: 'relevance', limit: 30, ...over });
const priced = (p: Platform, n: number, perNight: number | null, total: number | null = null) =>
  makeStay(p, n, { price: { perNight, total, nights: total ? 2 : null } });

describe('interleave', () => {
  it('round-robins across lists', () => {
    const out = interleave([[priced('jabama', 1, 1), priced('jabama', 2, 1)], [priced('jajiga', 1, 1)], []]);
    expect(out.map((s) => s.id)).toEqual(['jabama:1', 'jajiga:1', 'jabama:2']);
  });
});

describe('sortStays', () => {
  const stays = [priced('jabama', 1, 500, 1000), priced('jajiga', 1, 300), priced('otaghak', 1, null), priced('otaghak', 2, 900, 800)];
  it('price_asc uses total, then perNight, nulls last', () =>
    expect(sortStays(stays, 'price_asc').map((s) => s.id)).toEqual(['jajiga:1', 'otaghak:2', 'jabama:1', 'otaghak:1']));
  it('price_desc keeps nulls last', () =>
    expect(sortStays(stays, 'price_desc').map((s) => s.id)).toEqual(['jabama:1', 'otaghak:2', 'jajiga:1', 'otaghak:1']));
  it('rating sorts by rating then review count', () => {
    const r = [
      makeStay('jabama', 1, { rating: 4.5, reviewsCount: 10 }),
      makeStay('jajiga', 1, { rating: 4.9, reviewsCount: 1 }),
      makeStay('otaghak', 1, { rating: 4.9, reviewsCount: 50 }),
      makeStay('otaghak', 2, { rating: null }),
    ];
    expect(sortStays(r, 'rating').map((s) => s.id)).toEqual(['otaghak:1', 'jajiga:1', 'jabama:1', 'otaghak:2']);
  });
});

describe('searchAll', () => {
  it('merges successes, reports failures, applies the limit', async () => {
    const res = await searchAll(
      [
        adapter('jabama', [priced('jabama', 1, 300), priced('jabama', 2, 100)]),
        adapter('jajiga', new Error('HTTP 503 from api.jajiga.com')),
        adapter('otaghak', [priced('otaghak', 1, 200)]),
      ],
      params({ sort: 'price_asc', limit: 2 }),
    );
    expect(res.stays.map((s) => s.id)).toEqual(['jabama:2', 'otaghak:1']);
    expect(res.totals).toEqual({ jabama: 20, otaghak: 10 });
    expect(res.errors).toEqual([{ platform: 'jajiga', message: 'HTTP 503 from api.jajiga.com' }]);
  });
});

describe('resolveAll', () => {
  it('groups matches by platform', async () => {
    const res = await resolveAll([adapter('jabama', []), adapter('jajiga', new Error('down'))], 'رامسر');
    expect(Object.keys(res.matches)).toEqual(['jabama']);
    expect(res.errors).toEqual([{ platform: 'jajiga', message: 'down' }]);
  });
});
