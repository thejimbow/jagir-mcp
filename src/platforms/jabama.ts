import { compactDate, nightsBetween, toJalaliString } from '../core/dates.js';
import { httpJson, type HttpJson } from '../core/http.js';
import { formatStayId } from '../core/ids.js';
import {
  PlatformError, type CalendarDay, type Fact, type LocationMatch, type PlatformAdapter, type Quote, type RatingSummary, type Review,
  type SortOrder, type Stay, type StayDetail,
} from '../core/types.js';
import { compact, fact, itemText, MAX_IMAGES, num, pos, rialToToman, str, type Raw } from '../core/util.js';

const API = 'https://gw.jabama.com';
const WEB = 'https://www.jabama.com';
const MAX_PAGE = 36;
const MAX_REVIEW_PAGES = 30; // 10 reviews per page
const NO_UPPER_BOUND = 1_000_000_000; // Toman per night

const SORTS: Record<SortOrder, [field: string, direction: string]> = {
  relevance: ['booking_probability', 'true'],
  price_asc: ['price', 'false'],
  price_desc: ['price', 'true'],
  rating: ['rate', 'true'],
};

interface DateCtx {
  checkIn?: string;
  checkOut?: string;
  nights: number | null;
}

function unwrap(env: Raw): Raw {
  if (!env || env.success === false || env.result == null) {
    throw new PlatformError('jabama', str(env?.error?.message) ?? 'Jabama returned an unsuccessful response');
  }
  return env.result;
}

export function jabamaUrl(type: unknown, code: number | string, checkIn?: string, checkOut?: string): string {
  const base = `${WEB}/stay/${str(type) ?? 'villa'}-${code}`;
  return checkIn && checkOut ? `${base}?checkIn=${toJalaliString(checkIn)}&checkOut=${toJalaliString(checkOut)}` : base;
}

function capacityTotal(c: Raw): number | null {
  const base = num(c?.base);
  return base === null ? null : base + (num(c?.extra) ?? 0);
}

function latLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = num(lat);
  const b = num(lng);
  return a !== null && b !== null ? { lat: a, lng: b } : null;
}

export function mapJabamaSearchItem(item: Raw, ctx: DateCtx): Stay | null {
  const code = num(item?.code);
  const title = str(item?.name);
  if (code === null || !title) return null;
  const p = item.price ?? {};
  const stayPrice = pos(p.discountedPrice) ?? pos(p.mainPrice);
  const dated = ctx.nights !== null && p.isDefaultDate !== true;
  const nights = dated ? (num(p.nights_count) ?? ctx.nights) : null;
  const total = dated ? rialToToman(stayPrice) : null;
  const perNight = dated
    ? total !== null && nights
      ? Math.round(total / nights)
      : rialToToman(pos(p.perNight))
    : rialToToman(stayPrice ?? pos(p.perNight));
  return {
    id: formatStayId('jabama', code),
    platform: 'jabama',
    title,
    city: str(item.location?.city),
    province: str(item.location?.province),
    type: str(item.type),
    url: jabamaUrl(item.type, code, ctx.checkIn, ctx.checkOut),
    image: str(item.image),
    rating: pos(item.rate_review?.score),
    reviewsCount: num(item.rate_review?.count),
    capacity: {
      base: num(item.rawCapacity?.base) ?? num(item.capacity?.base),
      max: capacityTotal(item.rawCapacity) ?? capacityTotal(item.capacity),
    },
    bedrooms: num(item.accommodationMetrics?.bedroomsCount),
    instantBooking: str(item.reservation_type) ? item.reservation_type === 'instant' : null,
    price: { perNight, total, nights },
    location: latLng(item.location?.geo?.lat, item.location?.geo?.long),
  };
}

const BEDS: [key: string, label: string][] = [
  ['double', 'تخت دونفره'],
  ['single', 'تخت یک‌نفره'],
  ['twin', 'تخت دوقلو'],
  ['mattress', 'تشک'],
];

const LONG_STAY_DISCOUNTS: Record<string, string> = {
  threeDay: 'اقامت ۳ شب و بیشتر',
  fourteenDay: 'اقامت ۱۴ شب و بیشتر',
  short: 'اقامت کوتاه‌مدت',
  long: 'اقامت بلندمدت',
};

const MEALS: Record<string, string> = { breakfast: 'صبحانه', lunch: 'ناهار', dinner: 'شام' };

/** Rating summary from the listing payload's `meta.reviews` (falls back to `item.rateAndReview`). */
export function mapJabamaRatings(item: Raw, meta: Raw): RatingSummary | null {
  const reviews = meta?.reviews;
  const overall = pos(reviews?.overalRating) ?? pos(item?.rateAndReview?.score);
  const count = num(reviews?.reviewsCount) ?? num(item?.rateAndReview?.count);
  if (overall === null && count === null) return null;
  const chart: Raw[] = reviews?.starsChart ?? [];
  return {
    overall,
    count,
    breakdown: compact(
      (reviews?.items ?? []).map((i: Raw) => {
        const label = str(i?.ratingItem?.title);
        const score = num(i?.rating);
        return label && score !== null && i?.ratingItem?.inVisible !== true ? { label, score } : null;
      }),
    ),
    distribution: chart.length
      ? Object.fromEntries(compact(chart.map((c) => (num(c?.starsCount) !== null ? [String(c.starsCount), num(c.reviewsCount) ?? 0] : null))))
      : null,
  };
}

function detailFacts(item: Raw): Fact[] {
  const metrics = item.accommodationMetrics ?? {};
  const nearby = (item.nearbyCentersV2 ?? []).flatMap((group: Raw) =>
    (group?.items ?? []).map((i: Raw) => fact(`${str(group?.title) ?? ''} — ${str(i?.key) ?? ''}`.replace(/^ — | — $/g, ''), i?.value)),
  );
  const descriptions = (item.extraDescription ?? []).map((d: Raw) => fact(d?.title, d?.text));
  const meals = Object.entries(item.meal ?? {}).filter(([, v]) => v === true).map(([k]) => MEALS[k] ?? k);
  return compact<Fact>([
    ...nearby,
    ...descriptions,
    fact('متراژ زیربنا', pos(metrics.buildingSize)),
    fact('سرویس ایرانی', pos(metrics.iranianToiletsCount)),
    fact('سرویس فرنگی', pos(metrics.toiletsCount)),
    fact('تعداد پله', pos(metrics.stairsCount)),
    fact('تعداد واحد', (num(item.unitCount) ?? 0) > 1 ? item.unitCount : null),
    fact('وعده غذایی', meals.join('، ')),
    fact('مناسب سالمندان و معلولان', item.suitableForElderlyAndDisabled === true ? 'بله' : null),
    ...(item.specialAmenities ?? []).map((a: Raw) => fact('امکانات ویژه', str(a?.title?.fa) ?? itemText(a))),
  ]);
}

export function mapJabamaDetail(item: Raw, meta?: Raw): StayDetail {
  const code = num(item?.code);
  const title = str(item?.title);
  if (code === null || !title) throw new PlatformError('jabama', 'Unexpected listing payload');
  const place = item.placeOfResidence ?? {};
  const city = place.city ?? place.area?.city;
  const guests = item.capacity?.guests;
  const price = item.price ?? {};
  const metrics = item.accommodationMetrics ?? {};
  const images = compact<string>((item.placeImages ?? []).map((i: Raw) => str(i?.url))).slice(0, MAX_IMAGES);
  return {
    id: formatStayId('jabama', code),
    platform: 'jabama',
    title,
    city: str(city?.name?.fa),
    province: str(city?.province?.name?.fa),
    type: str(item.type),
    url: jabamaUrl(item.type, code),
    image: images[0] ?? null,
    rating: pos(item.rateAndReview?.score),
    reviewsCount: num(item.rateAndReview?.count),
    capacity: { base: num(guests?.base), max: capacityTotal(guests) },
    bedrooms: num(item.accommodationMetrics?.bedroomsCount),
    instantBooking: str(item.reservationType) ? item.reservationType === 'instant' : null,
    price: { perNight: rialToToman(pos(price.base)), total: null, nights: null },
    location: latLng(place.location?.lat, place.location?.lng),
    description: str(item.description),
    amenities: compact<string>(
      (item.amenitiesV2 ?? []).filter((a: Raw) => a?.state !== false).map((a: Raw) => str(a?.title?.fa) ?? str(a?.title?.en)),
    ),
    missingAmenities: compact<string>((item.missedAmenities ?? []).map((a: Raw) => str(a?.title?.fa) ?? str(a?.title?.en))),
    rules: compact<string>((item.rules ?? []).map((r: Raw) => str((r?.texts ?? []).map((t: Raw) => t?.text ?? '').join('')))),
    checkInTime: str(item.checkIn),
    checkOutTime: str(item.checkOut),
    minNights: num(item.minNight),
    cancellationPolicy: str(item.cancellationPolicyText),
    basePrices: {
      normal: rialToToman(pos(price.base)),
      weekend: rialToToman(pos(price.weekend)),
      holiday: rialToToman(pos(price.holiday)),
      extraPerson: rialToToman(pos(price.extraPeople?.base)),
    },
    ratings: mapJabamaRatings(item, meta),
    areaM2: pos(metrics.areaSize),
    bathrooms: num(metrics.bathroomsCount),
    floor: num(metrics.floor),
    beds: compact(BEDS.map(([key, label]) => {
      const n = pos(item.capacity?.beds?.[key]);
      return n !== null ? `${n} ${label}` : null;
    })),
    privacy: null,
    successfulBookings: null,
    discounts: compact(
      Object.entries(price.longStaysDiscount ?? {}).map(([k, v]) => (pos(v) ? `${v}% تخفیف ${LONG_STAY_DISCOUNTS[k] ?? k}` : null)),
    ),
    facts: detailFacts(item),
    images,
    media: [],
  };
}

function mapReview(r: Raw): Review | null {
  const text = str(r?.comment);
  if (!text) return null;
  const info = compact<string>([...(r.subTitles ?? []).map(itemText), ...(r.reviewInfo ?? []).map(itemText)]);
  return {
    date: null,
    rating: num(r.overalRating),
    text,
    positives: [],
    negatives: [],
    recommended: null,
    stayInfo: info.length ? info.join(' · ') : null,
    hostReply: str(r.response?.comment),
  };
}

function mapCalendarDay(d: Raw): CalendarDay | null {
  const date = str(d?.date);
  if (!date) return null;
  const available = d.status === 'available';
  return { date, available, price: available ? rialToToman(pos(d.price)) : null, holiday: d.isHoliday === true };
}

export function createJabamaAdapter(http: HttpJson = httpJson): PlatformAdapter {
  /** Listing payload: `item` is the accommodation, `meta` carries the rating breakdown. */
  async function fetchListing(id: string): Promise<{ item: Raw; meta: Raw }> {
    const result = unwrap(await http(`${API}/api/v1/accommodations/${encodeURIComponent(id)}`, { query: { reversePeriods: 'true' } }));
    if (!result.item) throw new PlatformError('jabama', `Listing ${id} not found`);
    return { item: result.item, meta: result.meta };
  }
  const fetchItem = async (id: string): Promise<Raw> => (await fetchListing(id)).item;

  async function resolveLocation(query: string): Promise<LocationMatch[]> {
    const cities = unwrap(await http(`${API}/api/taraaz/v1/area/cities/search`, { query: { q: query, page: 1 } }));
    const matches = compact<LocationMatch>(
      (cities.items ?? []).map((c: Raw): LocationMatch | null => {
        const en = str(c?.nameEn);
        return en ? { platform: 'jabama', id: `city-${en}`, name: str(c.nameFa) ?? en, parent: str(c.provinceNameFa), kind: 'city', count: null } : null;
      }),
    );
    if (matches.length > 0) return matches;
    const fts: Raw = await http(`${API}/api/taraaz/v2/search/fts`, { query: { query } });
    return compact<LocationMatch>(
      (fts?.result?.items ?? fts?.items ?? []).map((i: Raw): LocationMatch | null => {
        const slug = str(i?.url);
        if (i?.type !== 'plp' || !slug || !/^(city|province)-/.test(slug)) return null;
        return {
          platform: 'jabama', id: slug, name: str(i.title) ?? slug, parent: str(i.subtitle),
          kind: slug.startsWith('province-') ? 'province' : 'city', count: num(i.liquidity),
        };
      }),
    );
  }

  return {
    platform: 'jabama',
    resolveLocation,

    async search(params) {
      const [loc] = await resolveLocation(params.location);
      if (!loc) throw new PlatformError('jabama', `Location "${params.location}" not found`);
      const nights = params.checkIn && params.checkOut ? nightsBetween(params.checkIn, params.checkOut) : null;
      const [sort, direction] = SORTS[params.sort];
      const body: Record<string, unknown> = {
        'page-size': Math.min(params.limit, MAX_PAGE), 'page-number': 1, sort, 'sort-direction': direction,
      };
      if (nights !== null) body.date = { start: compactDate(params.checkIn!), end: compactDate(params.checkOut!) };
      if (params.guests) body.capacity = params.guests;
      if (params.minPrice != null || params.maxPrice != null) {
        const factor = (nights ?? 1) * 10; // Jabama filters on the stay total, in Rial
        body.price = { start: (params.minPrice ?? 0) * factor, end: (params.maxPrice ?? NO_UPPER_BOUND) * factor };
      }
      const result = unwrap(
        await http(`${API}/api/taraaz/v3/search/merchandising/legacy-plp/${loc.id}`, {
          method: 'POST',
          query: { platform: 'desktop', allowEmptyCity: 'true', hasUnitRoom: 'true', guarantees: 'false' },
          body,
        }),
      );
      const ctx: DateCtx = { checkIn: params.checkIn, checkOut: params.checkOut, nights };
      return { total: num(result.total), stays: compact<Stay>((result.items ?? []).map((i: Raw) => mapJabamaSearchItem(i, ctx))) };
    },

    async getStay(id) {
      const { item, meta } = await fetchListing(id);
      return mapJabamaDetail(item, meta);
    },

    async getReviews(id, limit) {
      const { item, meta } = await fetchListing(id);
      const code = num(item.code) ?? id;
      const reviews: Review[] = [];
      for (let page = 1; page <= MAX_REVIEW_PAGES && reviews.length < limit; page++) {
        const result = unwrap(await http(`${API}/api/v2/reviews/place/${encodeURIComponent(String(code))}`, { query: { page } }));
        const batch: Raw[] = result.reviews ?? [];
        if (batch.length === 0) break;
        reviews.push(...compact(batch.map(mapReview)));
      }
      const ratings = mapJabamaRatings(item, meta);
      return {
        id: formatStayId('jabama', code),
        platform: 'jabama',
        url: jabamaUrl(item.type, code),
        total: ratings?.count ?? null,
        ratings,
        reviews: reviews.slice(0, limit),
      };
    },

    async getCalendar(id, from, to) {
      const item = await fetchItem(id);
      return compact<CalendarDay>((item.calendar ?? []).map(mapCalendarDay)).filter((d) => d.date >= from && d.date <= to);
    },

    async getQuote(id, checkIn, checkOut, guests): Promise<Quote> {
      const item = await fetchItem(id);
      const accommodationId = str(item.id);
      if (!accommodationId) throw new PlatformError('jabama', 'Listing has no accommodation id');
      const result = unwrap(
        await http(`${API}/api/v1/accommodations/orders/preview`, {
          method: 'POST',
          body: { accommodationId, checkIn, checkOut, passengers: { adults: guests, children: 0 } },
        }),
      );
      const line = result.lineItems?.[0];
      const total = rialToToman(pos(result.totalPrice) ?? pos(line?.total));
      if (!line || total === null) throw new PlatformError('jabama', 'No price available for these dates');
      const days: Raw[] = line.pricePerDay?.days ?? [];
      const extraRial = days.reduce((s, d) => s + Math.max(0, (num(d?.totalDayPrice) ?? 0) - (num(d?.price) ?? 0)), 0);
      const daysRial = days.reduce((s, d) => s + (num(d?.totalDayPrice) ?? num(d?.price) ?? 0), 0);
      const code = num(item.code) ?? id;
      return {
        id: formatStayId('jabama', code),
        platform: 'jabama',
        checkIn,
        checkOut,
        guests,
        nights: nightsBetween(checkIn, checkOut),
        nightly: compact(days.map((d) => (str(d?.date) ? { date: d.date as string, price: rialToToman(num(d.price)) ?? 0 } : null))),
        extraGuestsCost: days.length ? Math.round(extraRial / 10) : null,
        fees: days.length ? Math.max(0, total - Math.round(daysRial / 10)) : null,
        total,
        estimated: false,
        url: jabamaUrl(item.type, code, checkIn, checkOut),
      };
    },
  };
}
