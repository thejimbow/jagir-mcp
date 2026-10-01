import { nightsBetween } from '../core/dates.js';
import { httpJson, type HttpJson } from '../core/http.js';
import { formatStayId } from '../core/ids.js';
import {
  PlatformError, type CalendarDay, type LocationMatch, type PlatformAdapter, type SortOrder, type Stay, type StayDetail,
} from '../core/types.js';
import { compact, num, pos, str, type Raw } from '../core/util.js';

const API = 'https://api.jajiga.com/api';
const WEB = 'https://www.jajiga.com';
const PICTURES = 'https://storage.jajiga.com/public/pictures/medium/';
const MAX_PAGE = 36;

const ORDERS: Record<SortOrder, string> = {
  relevance: 'popularity',
  price_asc: 'low_price',
  price_desc: 'high_price',
  rating: 'rating',
};

// Labels from jajiga.com's own UI strings (ssrLangData.roomUtils).
const RULES: Record<string, string> = {
  foreign_guest: 'مهمان خارجی (کلیه ملیت‌های غیر ایرانی) در این اقامتگاه پذیرش نمی شود.',
  party: 'برگزاری مهمانی و پخش موزیک ممنوع است.',
  pet: 'همراه داشتن حیوان خانگی ممنوع است.',
  smoke: 'استعمال دخانیات (سیگار، قلیان و ...) در داخل اقامتگاه ممنوع است.',
  unmarried: 'ارائه مدرک محرمیت و کارت ملی هوشمند الزامیست.',
};

const FEATURES: Record<string, string> = {
  barbecue: 'کباب پز', bathroom: 'حمام', billiard: 'میز بیلیارد', breakfast: 'صبحانه رایگان', coldWaterPool: 'استخر آب سرد',
  cooler: 'سیستم سرمایش', coveredRoofPool: 'استخر سرپوشیده', drawer: 'کمد / دراور', electricity: 'برق و روشنایی',
  elevator: 'آسانسور', essentials: 'اقلام بهداشتی', food: 'سرو غذا', foosball: 'فوتبال دستی', furniture: 'مبلمان',
  hairdryer: 'سشوار', heating: 'سیستم گرمایشی', hotWaterPool: 'استخر آب گرم', iron: 'اتو', islamictoilet: 'توالت ایرانی',
  jacuzzi: 'جکوزی', janitor: 'سرایدار/نگهبان', kitchen: 'وسایل آشپزخانه', microwave: 'مایکروفر', parking: 'پارکینگ',
  phone: 'تلفن ثابت', pool: 'استخر', refrigerator: 'یخچال', sauna: 'سونا', stave: 'اجاق گاز', table: 'میز غذاخوری',
  toilet: 'توالت فرنگی', tv: 'تلویزیون', uncoveredRoofPool: 'استخر روباز', vacuumcleaner: 'جارو برقی',
  washer: 'ماشین لباسشویی', water: 'آب لوله‌کشی', wifi: 'اینترنت',
};

const CANCELLATION: Record<string, string> = {
  easy: 'سیاست سهلگیرانه',
  middle: 'سیاست متعادل',
  hard: 'سیاست سختگیرانه',
  no_refund: 'سیاست لغو بدون عودت وجه',
  noRefund: 'سیاست لغو بدون عودت وجه',
  long: 'رزرو بلند مدت',
  peak: 'تعطیلات پیک',
};

function picture(p: Raw): string | null {
  const u = str(p?.url);
  return u ? PICTURES + u : null;
}

function latLng(g: Raw): { lat: number; lng: number } | null {
  const lat = num(g?.lat);
  const lng = num(g?.lng);
  return lat !== null && lng !== null ? { lat, lng } : null;
}

function roomUrl(path: unknown, id: number): string {
  const p = str(path);
  return p?.startsWith('/room/') ? WEB + p : `${WEB}/room/${id}`;
}

function hour(h: unknown): string | null {
  const n = num(h);
  return n === null ? null : `${String(n).padStart(2, '0')}:00`;
}

function ensureNumericId(id: string): string {
  if (!/^\d+$/.test(id)) throw new PlatformError('jajiga', `Jajiga ids are numeric, got "${id}"`);
  return id;
}

export function mapJajigaSearchItem(item: Raw, nights: number | null): Stay | null {
  const id = num(item?.id);
  const title = str(item?.title);
  if (id === null || !title) return null;
  let perNight: number | null;
  let total: number | null = null;
  if (nights) {
    total = pos(item.invoice?.final) ?? pos(item.price_after_discount);
    perNight = total !== null ? Math.round(total / nights) : null;
  } else {
    perNight = pos(item.price_after_discount) ?? pos(item.price);
  }
  return {
    id: formatStayId('jajiga', id),
    platform: 'jajiga',
    title,
    city: str(item.city_name),
    province: str(item.province_name),
    type: null,
    url: roomUrl(item.url, id),
    image: picture(item.pictures?.items?.[0]),
    rating: pos(item.rating?.total),
    reviewsCount: num(item.rating?.count),
    capacity: { base: num(item.guest_number), max: num(item.max_guest_number) },
    bedrooms: num(item.bedrooms),
    instantBooking: Array.isArray(item.properties) ? item.properties.includes('is_instant') : null,
    price: { perNight, total, nights: total !== null ? nights : null },
    location: latLng(item.geo),
  };
}

export function mapJajigaDetail(room: Raw): StayDetail {
  const id = num(room?.id);
  const title = str(room?.title);
  if (id === null || !title) throw new PlatformError('jajiga', 'Unexpected room payload');
  const pictures: Raw[] = Array.isArray(room.pictures) ? room.pictures : (room.pictures?.items ?? []);
  const images = compact<string>(pictures.map(picture)).slice(0, 10);
  const checkInFrom = hour(room.entrance_time_min);
  const checkInTo = hour(room.entrance_time_max);
  const cancellation = str(room.cancellation_policy);
  return {
    id: formatStayId('jajiga', id),
    platform: 'jajiga',
    title,
    city: str(room.city?.name),
    province: str(room.province?.name),
    type: str(room.types?.[0]),
    url: `${WEB}/room/${id}`,
    image: images[0] ?? null,
    rating: pos(room.ratings?.total),
    reviewsCount: num(room.ratings?.count),
    capacity: { base: num(room.guest_number), max: num(room.max_guest_number) },
    bedrooms: num(room.bedrooms),
    instantBooking: typeof room.is_instant === 'boolean' ? room.is_instant : null,
    price: { perNight: pos(room.min_price), total: null, nights: null },
    location: latLng(room.geo),
    description: str(room.description),
    amenities: compact<string>(
      (room.features ?? []).map((f: Raw) => {
        const key = str(f?.name);
        if (!key) return null;
        const label = FEATURES[key] ?? key;
        const description = str(f.description);
        return description ? `${label}: ${description}` : label;
      }),
    ),
    rules: compact<string>([...(room.rules ?? []).map((r: Raw) => (str(r) ? (RULES[r] ?? r) : null)), str(room.additional_rule)]),
    checkInTime: checkInFrom && checkInTo ? `${checkInFrom} تا ${checkInTo}` : checkInFrom,
    checkOutTime: hour(room.leaving_time),
    minNights: num(room.stays_min),
    cancellationPolicy: cancellation ? (CANCELLATION[cancellation] ?? cancellation) : null,
    basePrices: { normal: pos(room.min_price), weekend: null, holiday: null, extraPerson: pos(room.extra_price) },
    images,
  };
}

export function createJajigaAdapter(http: HttpJson = httpJson): PlatformAdapter {
  async function resolveLocation(query: string): Promise<LocationMatch[]> {
    const res: Raw = await http(`${API}/autocomplete`, { query: { phrase: query } });
    return compact<LocationMatch>(
      (res?.items ?? []).map((i: Raw): LocationMatch | null => {
        const id = i?.id != null ? String(i.id) : null;
        const name = str(i?.label);
        if (!id || !name || i.type === 'room') return null;
        return { platform: 'jajiga', id, name, parent: str(i.sub_label), kind: str(i.type) ?? 'unknown', count: num(i.rooms_count) };
      }),
    );
  }

  return {
    platform: 'jajiga',
    resolveLocation,

    async search(params) {
      const [loc] = await resolveLocation(params.location);
      if (!loc) throw new PlatformError('jajiga', `Location "${params.location}" not found`);
      const nights = params.checkIn && params.checkOut ? nightsBetween(params.checkIn, params.checkOut) : null;
      const res: Raw = await http(`${API}/search`, {
        query: {
          'locations[]': [loc.id],
          checkin: params.checkIn,
          checkout: params.checkOut,
          min_capacity: params.guests,
          min_price: params.minPrice,
          max_price: params.maxPrice,
          order: ORDERS[params.sort],
          page: 1,
          per_page: Math.min(params.limit, MAX_PAGE),
          'with[]': ['rooms'],
        },
      });
      return {
        total: num(res?.rooms?.pagination?.total),
        stays: compact<Stay>((res?.rooms?.items ?? []).map((i: Raw) => mapJajigaSearchItem(i, nights))),
      };
    },

    async getStay(id) {
      return mapJajigaDetail(await http(`${API}/room/${ensureNumericId(id)}`));
    },

    async getCalendar(id, from, to) {
      const res: Raw = await http(`${API}/nights`, { query: { room_id: ensureNumericId(id) } });
      return compact<CalendarDay>(
        (res?.nights ?? []).map((n: Raw): CalendarDay | null => {
          const date = str(n?.date);
          if (!date) return null;
          return { date, available: n.is_unavailable !== true, price: pos(n.price), weekend: n.is_weekend === true, holiday: n.is_holiday === true };
        }),
      ).filter((d) => d.date >= from && d.date <= to);
    },

    async getQuote(id, checkIn, checkOut, guests) {
      const res: Raw = await http(`${API}/invoice`, {
        query: { room_id: ensureNumericId(id), guests, checkin: checkIn, checkout: checkOut },
      });
      const bill = res?.bill;
      const total = pos(bill?.payable) ?? pos(bill?.total);
      if (!bill || total === null) throw new PlatformError('jajiga', 'No price available for these dates');
      const fees = (num(bill.guest_service_fee) ?? 0) + (num(bill.guest_arzeshafzodeh) ?? 0);
      return {
        id: formatStayId('jajiga', id),
        platform: 'jajiga',
        checkIn,
        checkOut,
        guests,
        nights: nightsBetween(checkIn, checkOut),
        nightly: compact(
          (bill.nights ?? []).map((n: Raw) =>
            str(n?.date) ? { date: n.date as string, price: num(n.price_after_discount) ?? num(n.price) ?? 0 } : null,
          ),
        ),
        extraGuestsCost: num(bill.extra),
        fees,
        total,
        estimated: false,
        url: `${WEB}/room/${id}`,
      };
    },
  };
}
