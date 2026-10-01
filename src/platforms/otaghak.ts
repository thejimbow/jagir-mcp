import { addDays, eachNight, nightsBetween } from '../core/dates.js';
import { httpJson, type HttpJson } from '../core/http.js';
import { formatStayId } from '../core/ids.js';
import {
  PlatformError, type CalendarDay, type Fact, type LocationMatch, type PlatformAdapter, type RatingSummary, type Review,
  type SortOrder, type Stay, type StayDetail,
} from '../core/types.js';
import { compact, fact, itemText, MAX_IMAGES, num, pos, str, type Raw } from '../core/util.js';

const API = 'https://core.otaghak.com';
const WEB = 'https://www.otaghak.com';
const IMAGES = 'https://cdn.otaghak.com/otg-images-new/X500/';
const MAX_PAGE = 36;
const STATE_PREFIX = 'state:';

const SORTS: Record<SortOrder, string> = {
  relevance: 'OtaghakSuggestions',
  price_asc: 'MinPricePriority',
  price_desc: 'MaxPricePriority',
  rating: 'MostRated',
};

interface DateCtx {
  checkIn?: string;
  checkOut?: string;
  nights: number | null;
}

function roomUrl(id: number | string, checkIn?: string, checkOut?: string): string {
  const base = `${WEB}/room/${id}/`;
  return checkIn && checkOut ? `${base}?checkIn=${checkIn}&checkOut=${checkOut}` : base;
}

function image(title: unknown): string | null {
  const t = str(title);
  return t ? IMAGES + t : null;
}

function latLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = num(lat);
  const b = num(lng);
  return a !== null && b !== null ? { lat: a, lng: b } : null;
}

function ensureNumericId(id: string): string {
  if (!/^\d+$/.test(id)) throw new PlatformError('otaghak', `Otaghak ids are numeric, got "${id}"`);
  return id;
}

export function mapOtaghakSearchItem(room: Raw, ctx: DateCtx): Stay | null {
  const id = num(room?.roomId) ?? num(room?.id);
  const title = str(room?.roomName);
  if (id === null || !title) return null;
  let perNight: number | null;
  let total: number | null = null;
  let nights: number | null = null;
  if (ctx.nights !== null) {
    total = pos(room.totalPriceWithExtraPerson) ?? pos(room.totalPrice);
    nights = total !== null ? (pos(room.totalNights) ?? ctx.nights) : null;
    // Derive from the total so extra-guest charges are included, like the other platforms.
    perNight = total !== null && nights ? Math.round(total / nights) : pos(room.afterDiscountAverage);
  } else {
    perNight = pos(room.afterDiscount) ?? pos(room.basePrice);
  }
  return {
    id: formatStayId('otaghak', id),
    platform: 'otaghak',
    title,
    city: str(room.cityFaName),
    province: str(room.stateFaName),
    type: str(room.roomTypeName),
    url: roomUrl(id, ctx.checkIn, ctx.checkOut),
    image: image(room.roomMediaTitles?.mainImageTitle),
    rating: pos(room.rate),
    reviewsCount: num(room.commentsCount),
    capacity: { base: num(room.basePersonCount) ?? num(room.personCapacity), max: num(room.personCapacity) },
    bedrooms: num(room.bedRoom),
    instantBooking: typeof room.isInstantBook === 'boolean' ? room.isInstantBook : null,
    price: { perNight, total, nights },
    location: latLng(room.latitude, room.longitude),
  };
}

/** Ratings from `Points/GetRoomPointsV2`; falls back to the PDP's seo rating when points are unavailable. */
export function mapOtaghakRatings(points: Raw, seo: Raw = {}): RatingSummary | null {
  const overall = pos(points?.score) ?? pos(seo?.rate);
  const count = num(points?.totalCount) ?? num(seo?.rateCount) ?? num(seo?.commentCount);
  if (overall === null && count === null) return null;
  const progresses: Raw[] = points?.progresses ?? [];
  return {
    overall,
    count,
    breakdown: compact(
      (points?.points ?? []).map((p: Raw) => {
        const label = str(p?.title);
        const score = num(p?.point);
        return label && score !== null ? { label, score } : null;
      }),
    ),
    distribution: progresses.length
      ? Object.fromEntries(compact(progresses.map((p) => (num(p?.score) !== null ? [String(p.score), num(p.count) ?? 0] : null))))
      : null,
  };
}

/** Name/description items of a PDP section as facts. */
function sectionFacts(section: Raw): (Fact | null)[] {
  return (section?.items ?? []).map((i: Raw) => fact(i?.name, i?.description));
}

export function mapOtaghakDetail(pdp: Raw, attributes: Raw, points: Raw = null): StayDetail {
  const info = pdp?.roomInfo;
  const id = num(info?.roomId);
  const title = str(info?.roomName);
  if (id === null || !title) throw new PlatformError('otaghak', 'Unexpected room payload');
  const sections: Raw[] = pdp.pdpSections ?? [];
  const section = (type: string): Raw => sections.find((s) => s?.sectionType === type);
  const gallery: Raw[] = section('Images')?.media ?? [];
  const areas: Raw[] = section('RoomAreas')?.roomAreas ?? [];
  const rentType = (section('Header')?.items ?? []).find((i: Raw) => i?.icon === 'ic_renttype');
  const times: Raw[] = section('RoomTime')?.items ?? [];
  const timeOf = (label: string) => str(times.find((t) => str(t?.name)?.includes(label))?.description);
  const cancel = section('RoomCancelRuleType');
  const map = section('Map');
  const seo = pdp.seoInfo ?? {};
  const base = num(info.personCount);
  const extra = num(info.extraPersonCount);
  const mainImage = image(seo.mainImageUrl);
  return {
    id: formatStayId('otaghak', id),
    platform: 'otaghak',
    title,
    city: str(pdp.breadCrumb?.cityName),
    province: str(pdp.breadCrumb?.stateName),
    type: str(pdp.breadCrumb?.roomType),
    url: roomUrl(id),
    image: mainImage,
    rating: pos(seo.rate),
    reviewsCount: num(seo.rateCount) ?? num(seo.commentCount),
    capacity: { base, max: base !== null ? base + (extra ?? 0) : null },
    bedrooms: num(seo.bedRoomCount),
    instantBooking: typeof seo.isInstant === 'boolean' ? seo.isInstant : null,
    price: { perNight: pos(pdp.price?.basePrice), total: null, nights: null },
    location: latLng(map?.latitude, map?.longitude),
    description: str(info.description),
    amenities: compact<string>(
      (Array.isArray(attributes) ? attributes : []).flatMap((g: Raw) =>
        (g?.items ?? []).map((i: Raw) => {
          const name = str(i?.name);
          const description = str(i?.description);
          return name && description ? `${name}: ${description}` : name;
        }),
      ),
    ),
    rules: compact<string>([...(section('RoomRules')?.items ?? []), ...(section('RoomHostRule')?.items ?? [])].map((i: Raw) => str(i?.name))),
    checkInTime: timeOf('ورود'),
    checkOutTime: timeOf('خروج'),
    minNights: null,
    cancellationPolicy: compact([str(cancel?.cancelRuleTitle), str(cancel?.cancelRuleDescription)]).join(': ') || null,
    basePrices: { normal: pos(pdp.price?.basePrice), weekend: null, holiday: null, extraPerson: pos(pdp.price?.extraPersonPrice) },
    missingAmenities: [],
    ratings: mapOtaghakRatings(points, seo),
    areaM2: pos(seo.area),
    bathrooms: null,
    floor: null,
    beds: compact<string>(
      areas
        .filter((a) => a?.roomAreaType === 'BedRoom')
        .flatMap((a) =>
          (a.items ?? []).map((i: Raw) => {
            const what = compact([str(i?.name), str(i?.description) ? `(${i.description.trim()})` : null]).join(' ');
            return what ? `${str(a.name) ?? 'اتاق خواب'}: ${what}` : null;
          }),
        ),
    ),
    privacy: str(rentType?.name) ?? str(seo.rentType),
    successfulBookings: num(seo.successfulBookingCount),
    discounts: compact([seo.isLastSecondDiscount === true ? 'تخفیف لحظه آخری' : null]),
    facts: compact<Fact>([
      ...sectionFacts(section('PromotedRoomAttributes')),
      ...sectionFacts(section('AboutRoom')),
      ...sectionFacts(section('RoomPrice')),
      ...sectionFacts(section('HostFullProfile')),
      ...areas
        .filter((a) => a?.roomAreaType !== 'BedRoom')
        .flatMap((a) => (a.items ?? []).map((i: Raw) => fact(`${str(a.name) ?? ''} — ${str(i?.name) ?? ''}`, i?.description))),
      fact('حیوان خانگی', seo.isPetAllowed === true ? 'مجاز' : null),
      fact('استعمال دخانیات', seo.isSmokingAllowed === true ? 'مجاز' : null),
      fact('پرایم', seo.isPrime === true ? 'اقامتگاه پرایم اتاقک' : null),
    ]),
    images: gallery.length ? compact<string>(gallery.map((m) => image(m?.name))).slice(0, MAX_IMAGES) : mainImage ? [mainImage] : [],
    media: compact<string>([str(info.virtualTourUrl), ...gallery.map((m) => str(m?.videoUrl))]),
  };
}

function mapComment(c: Raw): Review | null {
  const text = str(c?.body);
  if (!text) return null;
  const reply = (c.replies ?? []).find((r: Raw) => r?.isFromHost === true) ?? c.replies?.[0];
  return {
    date: str(c.creationDateTime)?.slice(0, 10) ?? null,
    rating: num(c.point),
    text,
    positives: compact<string>((c.positivePoints ?? []).map(itemText)),
    negatives: compact<string>((c.negativePoints ?? []).map(itemText)),
    recommended: c.recomendationType === 'Recommended' ? true : c.recomendationType === 'NotRecommended' ? false : null,
    stayInfo: null,
    hostReply: str(reply?.body),
  };
}

export function createOtaghakAdapter(http: HttpJson = httpJson): PlatformAdapter {
  const fetchPdp = (id: string): Promise<Raw> => http(`${API}/api/v3/Rooms/GetRoomPdp`, { query: { roomId: ensureNumericId(id) } });
  /** Rating breakdown; optional, so failures degrade to null. */
  const fetchPoints = (id: string): Promise<Raw> =>
    http(`${API}/api/v2/Points/GetRoomPointsV2`, { query: { roomId: ensureNumericId(id) } }).catch(() => null);

  async function resolveLocation(query: string): Promise<LocationMatch[]> {
    const res: Raw = await http(`${API}/api/v1/Search/GetSearchResult`, { query: { input: query } });
    return compact<LocationMatch>(
      (Array.isArray(res) ? res : []).map((r: Raw): LocationMatch | null => {
        const name = str(r?.name);
        if (!name) return null;
        if (r.typeCode === 'city' && str(r.cityCode)) {
          return { platform: 'otaghak', id: r.cityCode, name, parent: str(r.state), kind: 'city', count: num(r.count) };
        }
        if ((r.typeCode === 'state' || r.typeCode === 'province') && str(r.stateCode)) {
          return { platform: 'otaghak', id: STATE_PREFIX + r.stateCode, name, parent: null, kind: 'province', count: num(r.count) };
        }
        return null;
      }),
    );
  }

  async function getCalendar(id: string, from: string, to: string): Promise<CalendarDay[]> {
    const res: Raw = await http(
      `${API}/odata/Otaghak/RoomCalendarDetail/GetRoomCalendarDetails(roomId=${ensureNumericId(id)},startDate=${from},endDate=${to})`,
    );
    return compact<CalendarDay>(
      (res?.value ?? []).map((d: Raw): CalendarDay | null => {
        const date = str(d?.date)?.slice(0, 10);
        if (!date) return null;
        return { date, available: d.isBlocked !== true, price: pos(d.price), weekend: d.eventDateType === 'Weekend', holiday: d.isPublicHoliday === true };
      }),
    );
  }

  return {
    platform: 'otaghak',
    resolveLocation,
    getCalendar,

    async search(params) {
      const [loc] = await resolveLocation(params.location);
      if (!loc) throw new PlatformError('otaghak', `Location "${params.location}" not found`);
      const isState = loc.id.startsWith(STATE_PREFIX);
      const nights = params.checkIn && params.checkOut ? nightsBetween(params.checkIn, params.checkOut) : null;
      const res: Raw = await http(`${API}/api/v3/RoomSearch/SearchRooms`, {
        method: 'POST',
        body: {
          cities: isState ? [] : [loc.id],
          stateCodes: isState ? [loc.id.slice(STATE_PREFIX.length)] : [],
          checkIn: params.checkIn ?? null,
          checkOut: params.checkOut ?? null,
          person: params.guests ?? null,
          minPrice: params.minPrice ?? null,
          maxPrice: params.maxPrice ?? null,
          sortingType: SORTS[params.sort],
          aroundLocations: false,
          skip: 0,
          take: Math.min(params.limit, MAX_PAGE),
        },
      });
      const ctx: DateCtx = { checkIn: params.checkIn, checkOut: params.checkOut, nights };
      return { total: num(res?.count), stays: compact<Stay>((res?.rooms ?? []).map((r: Raw) => mapOtaghakSearchItem(r, ctx))) };
    },

    async getStay(id) {
      const [pdp, attributes, points] = await Promise.all([
        fetchPdp(id),
        http(`${API}/api/v3/Rooms/GetRoomPdpAttributes`, { query: { roomId: id } }).catch(() => []),
        fetchPoints(id),
      ]);
      return mapOtaghakDetail(pdp, attributes, points);
    },

    async getReviews(id, limit) {
      const [comments, points] = await Promise.all([
        http(`${API}/api/v2/Comments/GetAllByRoomId`, { query: { roomId: ensureNumericId(id), take: limit, skip: 0 } }),
        fetchPoints(id),
      ]);
      const ratings = mapOtaghakRatings(points);
      return {
        id: formatStayId('otaghak', id),
        platform: 'otaghak',
        url: roomUrl(id),
        total: ratings?.count ?? null,
        ratings,
        reviews: compact<Review>((Array.isArray(comments) ? comments : []).map(mapComment)).slice(0, limit),
      };
    },

    async getQuote(id, checkIn, checkOut, guests) {
      const [days, pdp] = await Promise.all([getCalendar(id, checkIn, addDays(checkOut, -1)), fetchPdp(id)]);
      const byDate = new Map(days.map((d) => [d.date, d]));
      const wanted = eachNight(checkIn, checkOut);
      const missing = wanted.filter((date) => {
        const day = byDate.get(date);
        return !day || !day.available || day.price === null;
      });
      if (missing.length > 0) throw new PlatformError('otaghak', `Not available on ${missing.join(', ')}`);
      const baseGuests = num(pdp?.roomInfo?.personCount) ?? guests;
      const capacity = baseGuests + (num(pdp?.roomInfo?.extraPersonCount) ?? 0);
      if (guests > capacity) throw new PlatformError('otaghak', `Capacity is ${capacity} guests`);
      const nightly = wanted.map((date) => ({ date, price: byDate.get(date)!.price! }));
      const extraGuestsCost = Math.max(0, guests - baseGuests) * (pos(pdp?.price?.extraPersonPrice) ?? 0) * wanted.length;
      return {
        id: formatStayId('otaghak', id),
        platform: 'otaghak',
        checkIn,
        checkOut,
        guests,
        nights: wanted.length,
        nightly,
        extraGuestsCost,
        fees: null,
        total: nightly.reduce((s, n) => s + n.price, 0) + extraGuestsCost,
        estimated: true,
        url: roomUrl(id, checkIn, checkOut),
      };
    },
  };
}
