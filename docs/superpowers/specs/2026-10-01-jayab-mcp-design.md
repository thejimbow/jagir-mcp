# jayab-mcp — Design

**Date:** 2026-10-01
**Status:** Approved (user: "بزن کامل" — proceed end to end)

## Goal

A read-only MCP server that lets Claude (and other MCP clients) search, inspect and compare short-term rental stays across three Iranian platforms — **Jabama**, **Jajiga**, **Otaghak** — through one unified tool set. No login, no booking, no payment.

## Decisions

| Topic | Decision |
|---|---|
| Scope | Read-only: location lookup, search, detail, calendar, price quote |
| Language / runtime | TypeScript, Node ≥ 20 (native `fetch`), official `@modelcontextprotocol/sdk` |
| Distribution | Public npm package, `npx jayab-mcp`, stdio transport, runs on the user's machine |
| Tool shape | Unified tools that fan out to all platforms and return normalized results |
| Price quotes | Separate `get_quote` tool using read-only quote endpoints (Jabama `orders/preview`, Jajiga `invoice`); Otaghak computed from calendar |
| Currency | Everything normalized to **Toman** (Jabama raw values are Rial ÷ 10) |
| Dates in tool input | Gregorian `YYYY-MM-DD`; Jalali `YYYY-MM-DD` with year 1300–1499 accepted and converted |

## Platform APIs (verified 2026-10-01, no auth, works from non-Iranian IP)

### Jabama — base `https://gw.jabama.com`
All responses wrapped `{ result, success, error }`. **Prices in Rial.**
- Location: `GET /api/taraaz/v1/area/cities/search?q=<fa|en>&page=1` → `result.items[]{nameFa,nameEn,provinceNameFa}`; slug = `city-${nameEn}`. Fallback `GET /api/taraaz/v2/search/fts?query=<fa>` → `result.items[]{type:"plp",title,url}` (url is slug, Persian-only).
- Search: `POST /api/taraaz/v3/search/merchandising/legacy-plp/{slug}?platform=desktop&allowEmptyCity=true&hasUnitRoom=true&guarantees=false`, JSON body:
  `{"page-size":N,"page-number":1,"date":{"start":YYYYMMDD,"end":YYYYMMDD},"capacity":N,"sort":"price","sort-direction":"false","price":{"start":rial,"end":rial},"types":["villa"]}`
  Sort map: relevance → `booking_probability`/`"true"`; price_asc → `price`/`"false"`; price_desc → `price`/`"true"`; rating → `rate`/`"true"`. Price filter applies to stay total when dates given.
  Item: `id` (mongo), `code` (numeric), `name`, `type`, `image`, `location{city,province,geo{lat,long}}`, `rate_review{score,count}`, `capacity{base,extra}`, `accommodationMetrics.bedroomsCount`, `reservation_type`, `price{mainPrice,perNight,discountPercent,nights_count,isDefaultDate}`. With dates `mainPrice` = stay total; without dates `mainPrice == perNight`.
- Detail + calendar: `GET /api/v1/accommodations/{code}` → `result.item`: `title, description, type, checkIn, checkOut, minNight, reservationType, capacity{beds,guests{base,extra}}, price{base,weekend,holiday,extraPeople{base}}, accommodationMetrics{areaSize,bedroomsCount,bathroomsCount}, amenitiesV2[]{state,title{fa}}, restrictedRules[]{name,positive,negative}, negativeRestrictedRules[]{name}, cancellationPolicyText, placeOfResidence{city.name.fa, city.province.name.fa, location{lat,lng}}, placeImages[]{url}, rateAndReview{score,count}, calendar[]{date,status:"available"|"disabled",price,extraPeople,minNight,isHoliday}` (≈76 days).
- Quote: `POST /api/v1/accommodations/orders/preview` body `{"accommodationId":"<mongo id>","checkIn":"YYYY-MM-DD","checkOut":"YYYY-MM-DD","passengers":{"adults":N,"children":0}}` → `result{totalPrice, id:null}` and `lineItems[0]{pricePerDay.days[]{date,price,extraPeople,totalDayPrice},vat,cancellationPolicyText}`. Returns `id:null` (no order created). Requires mongo id → adapter fetches detail first when given numeric code.
- Public URL: `https://www.jabama.com/stay/{type}-{code}` (+ `?checkIn=<jalali>&checkOut=<jalali>` zero-padded `1405-07-23`).

### Jajiga — base `https://api.jajiga.com/api`
**Prices in Toman.** Array params `key[]=v`. Send browser-like User-Agent.
- Location: `GET /autocomplete?phrase=<fa|en>` → `items[]{id,label,sub_label,type:"city"|"district"|...,url,rooms_count}`. Any `id` usable in search.
- Search: `GET /search?locations[]=<id>&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&min_capacity=N&min_price=&max_price=&order=<o>&page=1&per_page=N&with[]=rooms`.
  Order map: relevance → `popularity`; price_asc → `low_price`; price_desc → `high_price`; rating → `rating`.
  Response `rooms{pagination{total},items[]}`; item: `id,title,url,city_name,province_name,guest_number,max_guest_number,bedrooms,rating{total,count},pictures.items[0].url,geo{lat,lng},properties[],price,price_after_discount,invoice{final,prices{<nightly>:<count>}}`.
  **With dates:** total = `invoice.final`; nightly = `invoice.final / nights`. `price` is NOT the dated nightly rate. **Without dates:** nightly = `price_after_discount`.
  Image URL: `https://storage.jajiga.com/public/pictures/medium/{url}`.
- Detail: `GET /room/{id}` → `title, description, types[], city{name}, province{name}, geo{lat,lng}, bedrooms, floor_area, guest_number, max_guest_number, extra_price, min_price, stays_min, entrance_time_min, leaving_time, features[]{name,description}, rules[], additional_rule, cancellation_policy, is_instant, ratings{total,count}, pictures[]{url}`.
- Calendar: `GET /nights?room_id={id}` → `nights[]{date,price,is_unavailable?,is_weekend?,is_holiday?}` (fixed ≈113-day window; from/to filtered client-side).
- Quote: `GET /invoice?room_id={id}&guests=N&checkin=&checkout=` → `bill{nights[]{date,price_after_discount},sum,extra,total,guest_service_fee,guest_arzeshafzodeh,payable}`, `cancellation_policy`.
- Public URL: `https://www.jajiga.com/room/{id}`.
- Risk: client-side request signing exists (`x-request-*` headers) but is not enforced; `/search` returns `x-straxico: 400`. Fallback if enforced: parse `__NEXT_DATA__` from `www.jajiga.com/s/{slug}` (out of scope for v1, documented).

### Otaghak — base `https://core.otaghak.com`
**Prices in Toman.**
- Location: `GET /api/v1/Search/GetSearchResult?input=<fa|en>` → `[]{typeCode:"city"|..., name, state, cityCode, stateCode, count}`. Use entries with `typeCode=="city"` → `cities:[cityCode]`; `typeCode=="state"` → `stateCodes:[stateCode]`.
- Search: `POST /api/v3/RoomSearch/SearchRooms` JSON `{"cities":[code],"checkIn":"YYYY-MM-DD"|null,"checkOut":...,"person":N|null,"minPrice":..,"maxPrice":..,"sortingType":"<s>","aroundLocations":false,"skip":0,"take":N}`.
  Sort map: relevance → `OtaghakSuggestions`; price_asc → `MinPricePriority`; price_desc → `MaxPricePriority`; rating → `MostRated`.
  Response `{count, rooms[]}`; room: `roomId, roomName, roomTypeName, cityFaName, stateFaName, rate, commentsCount, personCapacity, extraPersonCapacity, basePersonCount, bedRoom, basePrice, afterDiscountAverage, totalPrice, totalNights, totalPriceWithExtraPerson, isInstantBook, latitude, longitude, roomMediaTitles.mainImageTitle`. **Contains `hostPhoneNumber` — must be dropped.**
  With dates: total = `totalPriceWithExtraPerson` (falls back to `totalPrice`), nightly = `afterDiscountAverage`. Without: nightly = `basePrice`, total null.
  Image: `https://cdn.otaghak.com/otg-images-new/X500/{mainImageTitle}`.
- Detail: `GET /api/v3/Rooms/GetRoomPdp?roomId={id}` → `roomInfo{roomName,description,personCount,extraPersonCount}`, `breadCrumb{roomType,cityName,stateName}`, `price{basePrice,extraPersonPrice}`, `seoInfo{rate,rateCount,area,bedRoomCount,isInstant,rentType}`, `pdpSections[]` by `sectionType`: `RoomTime.items[]{name,description}`, `RoomRules.items[]{name}`, `RoomCancelRuleType{cancelRuleTitle,cancelRuleDescription}`, `Map{latitude,longitude}`. Amenities: `GET /api/v3/Rooms/GetRoomPdpAttributes?roomId={id}` → `[]{name, items[]{name,description}}`.
- Calendar: `GET /odata/Otaghak/RoomCalendarDetail/GetRoomCalendarDetails(roomId={id},startDate=YYYY-MM-DD,endDate=YYYY-MM-DD)` → `value[]{date:"YYYY-MM-DDT00:00:00+03:30",price,isBlocked,eventDateType,isPublicHoliday,minNights}`.
- Quote: computed — sum calendar `price` for each night in [checkIn, checkOut) + extra persons × `price.extraPersonPrice` × nights (extra = max(0, guests − `roomInfo.personCount`)). Marked `estimated: true`. Otaghak's `PreviewBooking` is part of the booking flow and is **not used**.
- Public URL: `https://www.otaghak.com/room/{id}/`.

## Architecture

```
src/
  index.ts              # bin entry: create server, connect StdioServerTransport
  server.ts             # createServer(adapters): registers the 5 tools
  core/
    types.ts            # Platform, SearchParams, Stay, StayDetail, CalendarDay, Quote, LocationMatch, PlatformError
    adapter.ts          # PlatformAdapter interface
    aggregator.ts       # fan-out with Promise.allSettled, merge, sort, limit
    dates.ts            # normalizeDate (Jalali→Gregorian), nightsBetween, eachNight, toJalali, compact YYYYMMDD
    http.ts             # httpJson(url, {method, body, timeoutMs, headers}) with UA, timeout, HttpError
    ids.ts              # parseStayId("jabama:800749") / formatStayId
    format.ts           # tool result rendering (JSON text content)
  platforms/
    jabama.ts
    jajiga.ts
    otaghak.ts
test/
  fixtures/{jabama,jajiga,otaghak}/*.json   # real responses captured during recon
  *.test.ts                                  # vitest; adapters tested with mocked fetch
  live.test.ts                               # only when LIVE=1
```

Each platform file exports `create<Name>Adapter(http = httpJson): PlatformAdapter`. Mapping functions (`mapSearchItem`, `mapDetail`, ...) are exported for unit tests against fixtures.

### Adapter interface

```ts
type Platform = 'jabama' | 'jajiga' | 'otaghak';

interface PlatformAdapter {
  readonly platform: Platform;
  resolveLocation(query: string): Promise<LocationMatch[]>;
  search(params: SearchParams): Promise<{ total: number | null; stays: Stay[] }>;
  getStay(id: string): Promise<StayDetail>;
  getCalendar(id: string, from: string, to: string): Promise<CalendarDay[]>;
  getQuote(id: string, checkIn: string, checkOut: string, guests: number): Promise<Quote>;
}
```

`search` receives the raw location string and resolves it internally (first match of `resolveLocation`); if no match, it throws `PlatformError('location_not_found')`.

### Normalized types (all money in Toman, integers)

```ts
interface Stay {
  id: string;               // "jabama:800749"
  platform: Platform;
  title: string;
  city: string | null;
  province: string | null;
  type: string | null;
  url: string;              // public page
  image: string | null;
  rating: number | null;    // 0–5
  reviewsCount: number | null;
  capacity: { base: number | null; max: number | null };
  bedrooms: number | null;
  instantBooking: boolean | null;
  price: { perNight: number | null; total: number | null; nights: number | null };
  location: { lat: number; lng: number } | null;
}

interface StayDetail extends Stay {
  description: string | null;
  amenities: string[];
  rules: string[];           // human readable, Persian as provided
  checkInTime: string | null;
  checkOutTime: string | null;
  minNights: number | null;
  cancellationPolicy: string | null;
  basePrices: { normal: number | null; weekend: number | null; holiday: number | null; extraPerson: number | null };
  images: string[];          // up to 10
}

interface CalendarDay { date: string; available: boolean; price: number | null; holiday?: boolean; weekend?: boolean }

interface Quote {
  id: string; platform: Platform; checkIn: string; checkOut: string; guests: number; nights: number;
  nightly: { date: string; price: number }[];
  extraGuestsCost: number | null;
  fees: number | null;        // service fee + VAT when platform reports them
  total: number;              // payable
  estimated: boolean;         // true for Otaghak
  url: string;
}

interface LocationMatch { platform: Platform; id: string; name: string; parent: string | null; kind: string; count: number | null }
```

## Tools

| Tool | Input (Zod) | Behaviour |
|---|---|---|
| `resolve_location` | `query: string` | Calls all adapters' `resolveLocation`, returns matches grouped by platform (top 5 each) + per-platform errors |
| `search_stays` | `location: string`, `checkIn?`, `checkOut?` (both or neither), `guests?: int 1–50`, `minPrice?`, `maxPrice?` (Toman per night), `sort?: relevance\|price_asc\|price_desc\|rating` (default relevance), `platforms?: Platform[]` (default all), `limit?: int 1–100` (default 30) | Fan-out; each platform fetches one page of `min(limit, 36)`; merge; sort (price sorts use `total ?? perNight`, nulls last; rating desc; relevance = round-robin interleave across platforms); cut to `limit`. Returns `{ query, stays, totals: {platform: n}, errors: [{platform, message}] }` |
| `get_stay` | `id: string` ("platform:id") | Adapter `getStay` |
| `get_stay_calendar` | `id`, `from?` (default today), `to?` (default from + 30 days, max 120) | Adapter `getCalendar` |
| `get_quote` | `id`, `checkIn`, `checkOut`, `guests: int ≥1` | Adapter `getQuote` |

Price filter semantics: user gives Toman **per night**. Jabama filters on stay total in Rial → send `minPrice*nights*10` (or `*10` without dates). Jajiga and Otaghak filter per night in Toman → pass through.

All tool outputs are a single `text` content block containing pretty JSON; tool descriptions are in English with Persian examples. Errors in a single-platform tool return `isError: true` with a clear message.

## Error handling and fragility

- `httpJson`: 15 s timeout (AbortController), browser UA, `Accept: application/json`; non-2xx → `HttpError(status, url)`; JSON parse failure → `HttpError`.
- Aggregator uses `Promise.allSettled`; a failing platform yields an entry in `errors[]`, never fails the whole call.
- Mappers are defensive: every field read through optional chaining with `null` fallback; an item missing id/title is skipped.
- Jabama `{success:false}` → `PlatformError` with `error.message`.
- Input validation: dates must parse; checkOut > checkIn; nights ≤ 60; past dates rejected.
- Privacy: never output host phone numbers, host full names, or host ids.

## Testing

- Vitest. Fixtures copied from recon scratchpad into `test/fixtures/`.
- Unit: `dates`, `ids`, `aggregator` (merge/sort/limit/errors with fake adapters), each platform mapper against fixtures, each adapter method with a fake `http` asserting request URL/body and normalized output (incl. Rial→Toman, Jajiga invoice price semantics, Otaghak phone stripped).
- Server: `createServer` with fake adapters, exercised through the SDK `Client` + `InMemoryTransport`.
- Live smoke (`LIVE=1 npm test`): one real search per platform for رامسر.

## Out of scope (v1)

Booking/login, reviews tool, deep pagination, caching layer, HTTP transport, Jajiga `__NEXT_DATA__` fallback, English titles.

## Resolved during implementation

- Jajiga `rules[]` lists restrictions in force; each key maps to the site's own display text (`ssrLangData.roomUtils.roomRules.<key>.room`, e.g. `pet` → «همراه داشتن حیوان خانگی ممنوع است.»). Feature and cancellation-policy keys map to the site's labels the same way.
- Jabama rules come pre-rendered in `item.rules[].texts[]`; the adapter joins the text fragments («ارائه کارت ملی کافی است.»).
- Otaghak search `perNight` is `total / nights` (includes extra guests), matching Jabama and Jajiga; verified live that Jabama `mainPrice` scales with `capacity`.

## Addendum (2026-10-01): reviews and full detail

- New tool `get_reviews(id, limit=50, max 200)` → `{ id, total, ratings, reviews[] }`; each review: `date, rating, text, positives[], negatives[], recommended, stayInfo, hostReply`. Reviewer and host names are not returned.
  - Jabama `GET /api/v2/reviews/place/{code}?page=N` (10/page); ratings from the listing's `meta.reviews` (`items[].ratingItem.title`, `starsChart`).
  - Jajiga `GET /room/{id}/reviews?page=N&per_page≤50`; ratings from `/room/{id}` `ratings.{cleanliness,accuracy,…}` and `comments_grouped_by_rating`.
  - Otaghak `GET /api/v2/Comments/GetAllByRoomId?roomId&take&skip` (incl. `positivePoints`, `negativePoints`, `recomendationType`); ratings from `GET /api/v2/Points/GetRoomPointsV2?roomId` (`points[]`, `progresses[]`).
- `StayDetail` gains `ratings` (overall, count, breakdown incl. cleanliness, star distribution), `areaM2`, `bathrooms`, `floor`, `beds[]`, `privacy`, `successfulBookings`, `discounts[]`, `missingAmenities[]`, `facts[]` (view/setting, distances, extra descriptions, child pricing, host response time…), all photos (≤50) and `media[]` (video/VR).
- Jajiga search `per_page` is capped at 30 (HTTP 422 above).
