export const PLATFORMS = ['jabama', 'jajiga', 'otaghak'] as const;
export type Platform = (typeof PLATFORMS)[number];

export type SortOrder = 'relevance' | 'price_asc' | 'price_desc' | 'rating';

/** Dates are already validated Gregorian YYYY-MM-DD; prices are Toman per night. */
export interface SearchParams {
  location: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  minPrice?: number;
  maxPrice?: number;
  sort: SortOrder;
  limit: number;
}

export interface Stay {
  id: string;
  platform: Platform;
  title: string;
  city: string | null;
  province: string | null;
  type: string | null;
  url: string;
  image: string | null;
  rating: number | null;
  reviewsCount: number | null;
  capacity: { base: number | null; max: number | null };
  bedrooms: number | null;
  instantBooking: boolean | null;
  price: { perNight: number | null; total: number | null; nights: number | null };
  location: { lat: number; lng: number } | null;
}

/** Platform rating summary; `breakdown` holds sub-scores such as cleanliness, labelled as the platform labels them. */
export interface RatingSummary {
  overall: number | null;
  count: number | null;
  breakdown: { label: string; score: number }[];
  /** Number of reviews per star ("1"–"5"). */
  distribution: Record<string, number> | null;
}

/** A labelled fact that has no dedicated field (view, distances, host response time, child pricing…). */
export interface Fact {
  label: string;
  value: string;
}

export interface StayDetail extends Stay {
  description: string | null;
  amenities: string[];
  missingAmenities: string[];
  rules: string[];
  checkInTime: string | null;
  checkOutTime: string | null;
  minNights: number | null;
  cancellationPolicy: string | null;
  basePrices: { normal: number | null; weekend: number | null; holiday: number | null; extraPerson: number | null };
  ratings: RatingSummary | null;
  areaM2: number | null;
  bathrooms: number | null;
  floor: number | null;
  beds: string[];
  privacy: string | null;
  successfulBookings: number | null;
  discounts: string[];
  facts: Fact[];
  images: string[];
  media: string[];
}

export interface Review {
  date: string | null;
  rating: number | null;
  text: string;
  positives: string[];
  negatives: string[];
  recommended: boolean | null;
  stayInfo: string | null;
  hostReply: string | null;
}

export interface ReviewsResult {
  id: string;
  platform: Platform;
  url: string;
  total: number | null;
  ratings: RatingSummary | null;
  reviews: Review[];
}

export interface CalendarDay {
  date: string;
  available: boolean;
  price: number | null;
  holiday?: boolean;
  weekend?: boolean;
}

export interface Quote {
  id: string;
  platform: Platform;
  checkIn: string;
  checkOut: string;
  guests: number;
  nights: number;
  nightly: { date: string; price: number }[];
  extraGuestsCost: number | null;
  fees: number | null;
  total: number;
  estimated: boolean;
  url: string;
}

export interface LocationMatch {
  platform: Platform;
  id: string;
  name: string;
  parent: string | null;
  kind: string;
  count: number | null;
}

export interface SearchResult {
  total: number | null;
  stays: Stay[];
}

export interface PlatformAdapter {
  readonly platform: Platform;
  resolveLocation(query: string): Promise<LocationMatch[]>;
  search(params: SearchParams): Promise<SearchResult>;
  getStay(id: string): Promise<StayDetail>;
  getCalendar(id: string, from: string, to: string): Promise<CalendarDay[]>;
  getQuote(id: string, checkIn: string, checkOut: string, guests: number): Promise<Quote>;
  getReviews(id: string, limit: number): Promise<ReviewsResult>;
}

export class PlatformError extends Error {
  constructor(
    readonly platform: Platform,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}
