import { describe, expect, it } from 'vitest';
import { createJajigaAdapter, mapJajigaDetail, mapJajigaSearchItem } from '../src/platforms/jajiga.js';
import { fakeHttp, fixture } from './helpers.js';

const search = fixture('jajiga/search.json');
const room = fixture('jajiga/room.json');

describe('mapJajigaSearchItem', () => {
  it('uses invoice.final as the stay total when dated', () => {
    expect(mapJajigaSearchItem(search.rooms.items[0], 2)).toMatchObject({
      id: 'jajiga:3179488',
      platform: 'jajiga',
      title: 'خانه ویلایی در رامسر - طبقه اول',
      city: 'رامسر',
      province: 'مازندران',
      url: 'https://www.jajiga.com/room/3179488?gstnum=4&chin=2026-10-15&chout=2026-10-17',
      image: 'https://storage.jajiga.com/public/pictures/medium/2026/08/03/31794882608032252477407770.jpg',
      rating: 4.7,
      reviewsCount: 27,
      capacity: { base: 4, max: 7 },
      bedrooms: 2,
      instantBooking: false,
      price: { total: 4_000_000, perNight: 2_000_000, nights: 2 },
      location: { lat: 36.94260025024414, lng: 50.618099212646484 },
    });
  });

  it('uses price_after_discount as nightly when undated', () => {
    const stay = mapJajigaSearchItem(fixture('jajiga/search-nodate.json').rooms.items[0], null)!;
    expect(stay.price).toEqual({ perNight: 2_400_000, total: null, nights: null });
    expect(stay.url).toBe('https://www.jajiga.com/room/3254790');
  });
});

describe('mapJajigaDetail', () => {
  it('maps room detail with Persian labels', () => {
    const d = mapJajigaDetail(room);
    expect(d).toMatchObject({
      id: 'jajiga:3237270',
      title: 'خانه مبله در رامسر - همکف',
      city: 'رامسر',
      province: 'مازندران',
      type: 'apartment',
      capacity: { base: 4, max: 8 },
      bedrooms: 2,
      checkInTime: '14:00 تا 22:00',
      checkOutTime: '12:00',
      minNights: 1,
      cancellationPolicy: 'سیاست متعادل',
      instantBooking: true,
      basePrices: { normal: 3_000_000, weekend: null, holiday: null, extraPerson: 500_000 },
    });
    expect(d.amenities).toContain('اقلام بهداشتی: مایع دستشویی و مایع ظرفشویی');
    expect(d.amenities).toContain('پارکینگ: پارکینگ روباز برای سه خودرو');
    expect(d.amenities).toContain('یخچال');
    expect(d.rules).toContain('همراه داشتن حیوان خانگی ممنوع است.');
    expect(d.images[0]).toBe('https://storage.jajiga.com/public/pictures/medium/2026/04/30/32372702604302224565579734.jpg');
  });
});

describe('createJajigaAdapter', () => {
  it('resolves location then searches', async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith('/autocomplete') ? fixture('jajiga/autocomplete.json') : search));
    const res = await createJajigaAdapter(http).search({
      location: 'رامسر', checkIn: '2026-10-15', checkOut: '2026-10-17', guests: 4,
      minPrice: 2_000_000, maxPrice: 6_000_000, sort: 'price_asc', limit: 30,
    });
    expect(calls[0]!.req.query).toEqual({ phrase: 'رامسر' });
    expect(calls[1]!.url).toBe('https://api.jajiga.com/api/search');
    expect(calls[1]!.req.query).toEqual({
      'locations[]': ['303'], checkin: '2026-10-15', checkout: '2026-10-17', min_capacity: 4,
      min_price: 2_000_000, max_price: 6_000_000, order: 'low_price', page: 1, per_page: 30, 'with[]': ['rooms'],
    });
    expect(res.total).toBe(725);
    expect(res.stays).toHaveLength(search.rooms.items.length);
  });

  it('returns location matches', async () => {
    const { http } = fakeHttp(() => fixture('jajiga/autocomplete.json'));
    const [first] = await createJajigaAdapter(http).resolveLocation('رامسر');
    expect(first).toEqual({ platform: 'jajiga', id: '303', name: 'رامسر', parent: 'مازندران', kind: 'city', count: 1876 });
  });

  it('filters the nights calendar', async () => {
    const { http, calls } = fakeHttp(() => fixture('jajiga/nights.json'));
    const days = await createJajigaAdapter(http).getCalendar('3237270', '2026-09-30', '2026-10-02');
    expect(calls[0]!.req.query).toEqual({ room_id: '3237270' });
    expect(days).toEqual([
      { date: '2026-09-30', available: false, price: 3_000_000, weekend: true, holiday: false },
      { date: '2026-10-01', available: false, price: 3_000_000, weekend: true, holiday: false },
      { date: '2026-10-02', available: true, price: 3_000_000, weekend: false, holiday: false },
    ]);
  });

  it('quotes from /invoice', async () => {
    const { http, calls } = fakeHttp(() => fixture('jajiga/invoice.json'));
    const q = await createJajigaAdapter(http).getQuote('3237270', '2026-10-15', '2026-10-17', 4);
    expect(calls[0]!.req.query).toEqual({ room_id: '3237270', guests: 4, checkin: '2026-10-15', checkout: '2026-10-17' });
    expect(q).toMatchObject({
      id: 'jajiga:3237270', nights: 2, total: 6_198_000, fees: 198_000, extraGuestsCost: 0, estimated: false,
      nightly: [{ date: '2026-10-15', price: 3_000_000 }, { date: '2026-10-16', price: 3_000_000 }],
      url: 'https://www.jajiga.com/room/3237270',
    });
  });

  it('rejects non-numeric ids', async () => {
    const { http } = fakeHttp(() => ({}));
    await expect(createJajigaAdapter(http).getStay('abc')).rejects.toThrow(/numeric/);
  });
});
