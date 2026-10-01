import { describe, expect, it } from 'vitest';
import { createOtaghakAdapter, mapOtaghakDetail, mapOtaghakSearchItem } from '../src/platforms/otaghak.js';
import { fakeHttp, fixture } from './helpers.js';

const search = fixture('otaghak/search.json');
const detail = fixture('otaghak/detail.json');
const attributes = fixture('otaghak/attributes.json');
const dated = { checkIn: '2026-10-15', checkOut: '2026-10-17', nights: 2 };

describe('mapOtaghakSearchItem', () => {
  it('uses totalPriceWithExtraPerson as the stay total', () => {
    const stay = mapOtaghakSearchItem(search.rooms[0], dated)!;
    expect(stay).toMatchObject({
      id: 'otaghak:2463937',
      platform: 'otaghak',
      title: 'نوروزی',
      type: 'ویلا',
      city: 'رامسر',
      url: 'https://www.otaghak.com/room/2463937/?checkIn=2026-10-15&checkOut=2026-10-17',
      image: 'https://cdn.otaghak.com/otg-images-new/X500/b331c1ef-512d-495d-9036-968bebad1d55.webp',
      rating: 5,
      reviewsCount: 2,
      capacity: { base: 3, max: 4 },
      instantBooking: false,
      price: { total: 3_800_000, perNight: 1_600_000, nights: 2 },
    });
    expect(JSON.stringify(stay)).not.toMatch(/hostPhoneNumber|hostName/);
  });

  it('uses the base price when undated', () => {
    const raw = fixture('otaghak/search-nodate.json').rooms[0];
    const stay = mapOtaghakSearchItem(raw, { nights: null })!;
    expect(stay.price).toEqual({ perNight: raw.afterDiscount || raw.basePrice, total: null, nights: null });
    expect(stay.url).toBe(`https://www.otaghak.com/room/${raw.roomId}/`);
  });
});

describe('mapOtaghakDetail', () => {
  it('maps the PDP sections', () => {
    const d = mapOtaghakDetail(detail, attributes);
    expect(d).toMatchObject({
      id: 'otaghak:2397109',
      title: 'خیری',
      type: 'ویلا',
      city: 'رامسر',
      province: 'مازندران',
      capacity: { base: 2, max: 4 },
      bedrooms: 1,
      checkInTime: 'ساعت 14:00 تا 17:00',
      checkOutTime: 'ساعت 12:00',
      basePrices: { normal: 900_000, weekend: null, holiday: null, extraPerson: 100_000 },
      location: { lat: 36.896366227, lng: 50.675353436 },
      image: 'https://cdn.otaghak.com/otg-images-new/X500/536ff812-e503-41fa-8621-427b051d8da8.webp',
    });
    expect(d.rules).toContain('ورود حیوان خانگی مجاز نیست');
    expect(d.amenities[0]).toBe('سرویس بهداشتی-1: توالت ایرانی، روشویی، دوش');
    expect(d.cancellationPolicy).toContain('سختگیرانه');
  });
});

describe('createOtaghakAdapter', () => {
  it('resolves a city and searches with the JSON body', async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith('/GetSearchResult') ? fixture('otaghak/locations.json') : search));
    const res = await createOtaghakAdapter(http).search({
      location: 'رامسر', checkIn: '2026-10-15', checkOut: '2026-10-17', guests: 4,
      minPrice: 1_000_000, maxPrice: 3_000_000, sort: 'price_asc', limit: 30,
    });
    expect(calls[0]!.req.query).toEqual({ input: 'رامسر' });
    expect(calls[1]!.url).toBe('https://core.otaghak.com/api/v3/RoomSearch/SearchRooms');
    expect(calls[1]!.req.body).toEqual({
      cities: ['ramsar'], stateCodes: [], checkIn: '2026-10-15', checkOut: '2026-10-17', person: 4,
      minPrice: 1_000_000, maxPrice: 3_000_000, sortingType: 'MinPricePriority', aroundLocations: false, skip: 0, take: 30,
    });
    expect(res.total).toBe(228);
  });

  it('returns city matches', async () => {
    const { http } = fakeHttp(() => fixture('otaghak/locations.json'));
    const [first] = await createOtaghakAdapter(http).resolveLocation('رامسر');
    expect(first).toEqual({ platform: 'otaghak', id: 'ramsar', name: 'رامسر', parent: 'مازندران', kind: 'city', count: 1244 });
  });

  it('reads the OData calendar', async () => {
    const { http, calls } = fakeHttp(() => fixture('otaghak/calendar.json'));
    const days = await createOtaghakAdapter(http).getCalendar('2397109', '2026-10-01', '2026-10-31');
    expect(calls[0]!.url).toBe(
      'https://core.otaghak.com/odata/Otaghak/RoomCalendarDetail/GetRoomCalendarDetails(roomId=2397109,startDate=2026-10-01,endDate=2026-10-31)',
    );
    expect(days[0]).toEqual({ date: '2026-10-01', available: false, price: 900_000, weekend: true, holiday: false });
    expect(days[1]).toEqual({ date: '2026-10-02', available: true, price: 900_000, weekend: false, holiday: true });
  });

  const calendarFor = (blocked = false) => ({
    value: [
      { date: '2026-10-15T00:00:00+03:30', price: 900000, isBlocked: blocked, eventDateType: 'Normal', isPublicHoliday: false },
      { date: '2026-10-16T00:00:00+03:30', price: 1000000, isBlocked: false, eventDateType: 'Weekend', isPublicHoliday: false },
    ],
  });

  it('estimates a quote from the calendar plus extra guests', async () => {
    const { http, calls } = fakeHttp((url) => (url.includes('GetRoomCalendarDetails') ? calendarFor() : detail));
    const q = await createOtaghakAdapter(http).getQuote('2397109', '2026-10-15', '2026-10-17', 3);
    expect(calls.find((c) => c.url.includes('GetRoomCalendarDetails'))!.url).toContain('endDate=2026-10-16)');
    expect(q).toMatchObject({
      id: 'otaghak:2397109', nights: 2, extraGuestsCost: 200_000, fees: null, total: 2_100_000, estimated: true,
      nightly: [{ date: '2026-10-15', price: 900_000 }, { date: '2026-10-16', price: 1_000_000 }],
    });
  });

  it('refuses blocked nights and over-capacity quotes', async () => {
    const blocked = fakeHttp((url) => (url.includes('GetRoomCalendarDetails') ? calendarFor(true) : detail));
    await expect(createOtaghakAdapter(blocked.http).getQuote('2397109', '2026-10-15', '2026-10-17', 2)).rejects.toThrow(/2026-10-15/);
    const full = fakeHttp((url) => (url.includes('GetRoomCalendarDetails') ? calendarFor() : detail));
    await expect(createOtaghakAdapter(full.http).getQuote('2397109', '2026-10-15', '2026-10-17', 5)).rejects.toThrow(/4 guests/);
  });
});
