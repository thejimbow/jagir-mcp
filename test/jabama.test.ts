import { describe, expect, it } from 'vitest';
import { createJabamaAdapter, mapJabamaDetail, mapJabamaSearchItem } from '../src/platforms/jabama.js';
import { fakeHttp, fixture } from './helpers.js';

const search = fixture('jabama/search.json');
const nodate = fixture('jabama/search-nodate.json');
const detail = fixture('jabama/detail.json');
const dated = { checkIn: '2026-10-15', checkOut: '2026-10-17', nights: 2 };

describe('mapJabamaSearchItem', () => {
  it('maps a dated result, converting Rial to Toman', () => {
    const stay = mapJabamaSearchItem(search.result.items[0], dated)!;
    expect(stay).toMatchObject({
      id: 'jabama:800749',
      platform: 'jabama',
      title: 'ویلا دوخوابه هونام',
      city: 'رامسر',
      province: 'مازندران',
      type: 'villa',
      url: 'https://www.jabama.com/stay/villa-800749?checkIn=1405-07-23&checkOut=1405-07-25',
      rating: 4.9,
      reviewsCount: 30,
      capacity: { base: 4, max: 8 },
      bedrooms: 2,
      instantBooking: true,
      price: { total: 4_680_000, perNight: 2_340_000, nights: 2 },
      location: { lat: 36.8875864, lng: 50.69174381403633 },
    });
  });

  it('maps an undated result to a nightly price only', () => {
    const raw = nodate.result.items.find((i: { code?: number }) => typeof i.code === 'number');
    const stay = mapJabamaSearchItem(raw, { nights: null })!;
    const expected = Math.round((raw.price.discountedPrice || raw.price.mainPrice) / 10);
    expect(stay.price).toEqual({ perNight: expected, total: null, nights: null });
    expect(stay.url).toBe(`https://www.jabama.com/stay/${raw.type}-${raw.code}`);
  });

  it('skips items without a code', () => expect(mapJabamaSearchItem({ name: 'ad' }, dated)).toBeNull());
});

describe('mapJabamaDetail', () => {
  it('maps listing detail', () => {
    const d = mapJabamaDetail(detail.result.item);
    expect(d).toMatchObject({
      id: 'jabama:800749',
      title: 'ویلا دوخوابه هونام',
      city: 'رامسر',
      province: 'مازندران',
      capacity: { base: 4, max: 8 },
      bedrooms: 2,
      checkInTime: '14:00',
      checkOutTime: '12:00',
      minNights: 1,
      basePrices: { normal: 2_920_000, weekend: 3_220_000, holiday: 3_550_000, extraPerson: 340_000 },
      location: { lat: 36.887585, lng: 50.691742 },
    });
    expect(d.rules[0]).toBe('ارائه کارت ملی کافی است.');
    expect(d.amenities).toContain('پارکینگ');
    expect(d.images.length).toBeGreaterThan(0);
    expect(d.cancellationPolicy).toMatch(/^از لحظه رزرو/);
  });
});

describe('mapJabamaDetail extras', () => {
  const d = mapJabamaDetail(detail.result.item, detail.result.meta);

  it('includes the rating breakdown with cleanliness and the star distribution', () => {
    expect(d.ratings).toMatchObject({ overall: 4.9, count: 30, distribution: { '1': 0, '2': 0, '3': 1, '4': 2, '5': 27 } });
    expect(d.ratings!.breakdown).toContainEqual({ label: 'نظافت', score: 4.7 });
  });

  it('maps size, beds, nearby places, descriptions and missing amenities', () => {
    expect(d).toMatchObject({ areaM2: 100, bathrooms: 1, floor: 1 });
    expect(d.beds).toEqual(['2 تخت دونفره', '2 تشک']);
    expect(d.facts).toContainEqual({ label: 'قابل دسترسی با خودرو — فاصله از دریا', value: 'زیر ‍۵ دقیقه' });
    expect(d.facts).toContainEqual({ label: 'توصیف فضای اقامتگاه و واحد', value: 'ویلا دارای حیاط نسبتا بزرگ و مستقل می باشد.' });
    expect(d.missingAmenities).toContain('رستوران');
  });

  it('never exposes host contact fields', () => {
    expect(JSON.stringify(d)).not.toMatch(/telephone|ownerName|hostInfo/);
  });
});

describe('createJabamaAdapter', () => {
  it('pages through reviews up to the limit', async () => {
    const reviews = fixture('jabama/reviews.json');
    const { http, calls } = fakeHttp((url, req) => {
      if (url.includes('/reviews/place/')) return req.query?.page === 1 ? reviews : { result: { reviews: [] }, success: true };
      return detail;
    });
    const res = await createJabamaAdapter(http).getReviews('800749', 50);
    expect(calls.filter((c) => c.url.includes('/reviews/place/800749')).map((c) => c.req.query?.page)).toEqual([1, 2]);
    expect(res).toMatchObject({ id: 'jabama:800749', platform: 'jabama', total: 30, url: 'https://www.jabama.com/stay/villa-800749' });
    expect(res.ratings!.breakdown).toContainEqual({ label: 'نظافت', score: 4.7 });
    expect(res.reviews).toHaveLength(10);
    expect(res.reviews[0]).toMatchObject({
      rating: 5,
      stayInfo: 'اقامت 6 روز پیش · 4 شب اقامت در اقامتگاه',
      hostReply: 'بادرود ازنقطه نظرات حضرتعالی وکمال تشکر را داریم به امید دیدار مجدتتان',
      positives: [],
      negatives: [],
      recommended: null,
    });
    expect(res.reviews[0]!.text).toMatch(/^سلام دوستان بسیار عالی بود/);
    expect(JSON.stringify(res)).not.toContain('رویا');

    const few = await createJabamaAdapter(http).getReviews('800749', 3);
    expect(few.reviews).toHaveLength(3);
  });

  it('resolves a city then searches with Jabama body format', async () => {
    const { http, calls } = fakeHttp((url) =>
      url.includes('/area/cities/search') ? fixture('jabama/cities.json') : search,
    );
    const res = await createJabamaAdapter(http).search({
      location: 'رامسر', checkIn: '2026-10-15', checkOut: '2026-10-17', guests: 4,
      minPrice: 1_000_000, maxPrice: 3_000_000, sort: 'price_asc', limit: 30,
    });
    expect(calls[0]!.req.query).toMatchObject({ q: 'رامسر' });
    const req = calls[1]!;
    expect(req.url).toBe('https://gw.jabama.com/api/taraaz/v3/search/merchandising/legacy-plp/city-ramsar');
    expect(req.req.method).toBe('POST');
    expect(req.req.body).toEqual({
      'page-size': 30, 'page-number': 1, sort: 'price', 'sort-direction': 'false',
      date: { start: 20261015, end: 20261017 }, capacity: 4,
      price: { start: 20_000_000, end: 60_000_000 },
    });
    expect(res.total).toBe(search.result.total);
    expect(res.stays[0]!.id).toBe('jabama:800749');
  });

  it('falls back to full-text search for locations', async () => {
    const { http } = fakeHttp((url) =>
      url.includes('/area/cities/search') ? { result: { items: [] }, success: true } : fixture('jabama/fts.json'),
    );
    const matches = await createJabamaAdapter(http).resolveLocation('رامسر');
    expect(matches[0]).toEqual({ platform: 'jabama', id: 'city-ramsar', name: 'رامسر', parent: 'استان مازندران', kind: 'city', count: 2798 });
    expect(matches.every((m) => /^(city|province)-/.test(m.id))).toBe(true);
  });

  it('throws when the envelope is unsuccessful', async () => {
    const { http } = fakeHttp(() => ({ success: false, error: { message: 'boom' }, result: null }));
    await expect(createJabamaAdapter(http).getStay('1')).rejects.toThrow('boom');
  });

  it('extracts the calendar window from the detail payload', async () => {
    const { http } = fakeHttp(() => detail);
    const days = await createJabamaAdapter(http).getCalendar('800749', '2026-10-01', '2026-10-15');
    expect(days[0]).toEqual({ date: '2026-10-01', available: false, price: null, holiday: false });
    expect(days.at(-1)).toMatchObject({ date: '2026-10-15', available: true, price: 2_460_000 });
    expect(days.every((d) => d.date >= '2026-10-01' && d.date <= '2026-10-15')).toBe(true);
  });

  it('quotes via orders/preview using the mongo id', async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith('/orders/preview') ? fixture('jabama/preview.json') : detail));
    const q = await createJabamaAdapter(http).getQuote('800749', '2026-10-15', '2026-10-17', 6);
    expect(calls[1]!.req.body).toEqual({
      accommodationId: detail.result.item.id, checkIn: '2026-10-15', checkOut: '2026-10-17',
      passengers: { adults: 6, children: 0 },
    });
    expect(q).toMatchObject({
      id: 'jabama:800749', platform: 'jabama', nights: 2, total: 6_040_000, extraGuestsCost: 1_360_000, fees: 0, estimated: false,
      nightly: [{ date: '2026-10-15', price: 2_460_000 }, { date: '2026-10-16', price: 2_220_000 }],
    });
  });
});
