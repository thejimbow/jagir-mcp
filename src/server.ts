import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { resolveAll, searchAll } from './core/aggregator.js';
import { addDays, nightsBetween, normalizeDate, todayTehran, validateStayDates } from './core/dates.js';
import { parseStayId } from './core/ids.js';
import { PLATFORMS, type Platform, type PlatformAdapter, type SearchParams } from './core/types.js';
import { errorMessage } from './core/util.js';
import { ICONS } from './icon.js';

export const VERSION = '0.1.0';
const DEFAULT_LIMIT = 30;
const DEFAULT_CALENDAR_DAYS = 30;
const MAX_CALENDAR_DAYS = 120;
const DEFAULT_REVIEWS = 50;
const MAX_REVIEWS = 200;
const ANNOTATIONS = { readOnlyHint: true, openWorldHint: true } as const;

export interface ServerOptions {
  today?: () => string;
}

const ok = (data: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown): CallToolResult => ({ content: [{ type: 'text', text: `Error: ${errorMessage(e)}` }], isError: true });
const run = (fn: () => Promise<unknown>): Promise<CallToolResult> => fn().then(ok, fail);

const stayId = z.string().describe('Stay id from search results, "<platform>:<id>", e.g. "jajiga:3237270" or "jabama:800749".');
const date = (what: string) =>
  z.string().describe(`${what} as YYYY-MM-DD. Gregorian (2026-10-15) or Jalali/Shamsi (1405-07-23) both work.`);

export function createServer(adapters: Record<Platform, PlatformAdapter>, options: ServerOptions = {}): McpServer {
  const today = options.today ?? (() => todayTehran());
  const server = new McpServer({
    name: 'jayab-mcp',
    title: 'jayab',
    version: VERSION,
    description: 'Search and compare stays on Jabama, Jajiga and Otaghak (Iran). Read-only.',
    websiteUrl: 'https://github.com/thejimbow/jayab-mcp',
    icons: ICONS,
  });
  const adapterFor = (id: string) => {
    const parsed = parseStayId(id);
    return { adapter: adapters[parsed.platform], id: parsed.id };
  };

  server.registerTool(
    'resolve_location',
    {
      title: 'Resolve location',
      description:
        'Look up how a city/region name (Persian or English, e.g. "رامسر" or "ramsar") is known on Jabama, Jajiga and Otaghak. ' +
        'Useful to check a destination exists before searching. search_stays resolves locations itself.',
      inputSchema: { query: z.string().min(2).describe('City or region name, Persian or English.') },
      annotations: ANNOTATIONS,
    },
    ({ query }) => run(() => resolveAll(Object.values(adapters), query)),
  );

  server.registerTool(
    'search_stays',
    {
      title: 'Search stays',
      description:
        'Search short-term rentals (villa, suite, apartment, cottage…) in an Iranian city across Jabama, Jajiga and Otaghak at once. ' +
        'All prices are Toman (IRT). With dates, price.total is the full stay price for the guest count; without dates only price.perNight is set. ' +
        'Results from a platform that failed are listed in "errors"; the others are still returned.',
      inputSchema: {
        location: z.string().min(2).describe('City or region, Persian or English, e.g. "رامسر", "کیش", "ramsar".'),
        checkIn: date('Check-in date').optional(),
        checkOut: date('Check-out date').optional(),
        guests: z.number().int().min(1).max(50).optional().describe('Number of guests.'),
        minPrice: z.number().int().min(0).optional().describe('Minimum price per night, Toman.'),
        maxPrice: z.number().int().min(0).optional().describe('Maximum price per night, Toman.'),
        sort: z.enum(['relevance', 'price_asc', 'price_desc', 'rating']).optional().describe('Default "relevance".'),
        platforms: z.array(z.enum(PLATFORMS)).min(1).optional().describe('Restrict to some platforms. Default: all three.'),
        limit: z.number().int().min(1).max(100).optional().describe(`Max results overall. Default ${DEFAULT_LIMIT}.`),
      },
      annotations: ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        if (Boolean(args.checkIn) !== Boolean(args.checkOut)) throw new Error('Provide both checkIn and checkOut, or neither.');
        const dates = args.checkIn && args.checkOut ? validateStayDates(args.checkIn, args.checkOut, today()) : null;
        const params: SearchParams = {
          location: args.location,
          checkIn: dates?.checkIn,
          checkOut: dates?.checkOut,
          guests: args.guests,
          minPrice: args.minPrice,
          maxPrice: args.maxPrice,
          sort: args.sort ?? 'relevance',
          limit: args.limit ?? DEFAULT_LIMIT,
        };
        const selected = (args.platforms ?? PLATFORMS).map((p) => adapters[p]);
        const result = await searchAll(selected, params);
        return { query: { ...params, nights: dates?.nights ?? null }, currency: 'IRT', ...result };
      }),
  );

  server.registerTool(
    'get_stay',
    {
      title: 'Get stay details',
      description:
        'Full details of one stay: description, amenities (and missing ones), house rules, check-in/out times, cancellation policy, ' +
        'base prices (Toman), rating breakdown incl. cleanliness, star distribution, area, beds, privacy (entire/shared), ' +
        'successful bookings, discounts, all photos, and extra facts such as view/setting, distances to sea or city centre, ' +
        'child pricing and host response time.',
      inputSchema: { id: stayId },
      annotations: ANNOTATIONS,
    },
    ({ id }) =>
      run(async () => {
        const target = adapterFor(id);
        return target.adapter.getStay(target.id);
      }),
  );

  server.registerTool(
    'get_reviews',
    {
      title: 'Get guest reviews',
      description:
        'Guest reviews of one stay, newest first: full text, star rating, date or stay info, host reply, and (Otaghak) the ' +
        'positive/negative points and whether the guest recommends it. Also returns the rating breakdown (cleanliness, accuracy, ' +
        'location, value…) and star distribution. Use it to judge cleanliness, noise, view or host behaviour from real guests.',
      inputSchema: {
        id: stayId,
        limit: z.number().int().min(1).max(MAX_REVIEWS).optional().describe(`Max reviews to return. Default ${DEFAULT_REVIEWS}.`),
      },
      annotations: ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const target = adapterFor(args.id);
        return target.adapter.getReviews(target.id, args.limit ?? DEFAULT_REVIEWS);
      }),
  );

  server.registerTool(
    'get_stay_calendar',
    {
      title: 'Get stay calendar',
      description: `Per-night availability and price (Toman) for one stay. Default window: today + ${DEFAULT_CALENDAR_DAYS} days; max ${MAX_CALENDAR_DAYS} days.`,
      inputSchema: { id: stayId, from: date('First day').optional(), to: date('Last day (inclusive)').optional() },
      annotations: ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const target = adapterFor(args.id);
        const from = args.from ? normalizeDate(args.from) : today();
        const to = args.to ? normalizeDate(args.to) : addDays(from, DEFAULT_CALENDAR_DAYS);
        const span = nightsBetween(from, to);
        if (span < 0) throw new Error('"to" must not be before "from".');
        if (span > MAX_CALENDAR_DAYS) throw new Error(`Calendar window is limited to ${MAX_CALENDAR_DAYS} days.`);
        return { id: args.id, from, to, days: await target.adapter.getCalendar(target.id, from, to) };
      }),
  );

  server.registerTool(
    'get_quote',
    {
      title: 'Get price quote',
      description:
        'Exact price (Toman) for one stay, dates and guest count, including extra-guest charges and fees where the platform reports them. ' +
        'Read-only: nothing is booked. Otaghak quotes are estimated from its calendar (estimated: true).',
      inputSchema: {
        id: stayId,
        checkIn: date('Check-in date'),
        checkOut: date('Check-out date'),
        guests: z.number().int().min(1).max(50).describe('Number of guests.'),
      },
      annotations: ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const target = adapterFor(args.id);
        const dates = validateStayDates(args.checkIn, args.checkOut, today());
        return target.adapter.getQuote(target.id, dates.checkIn, dates.checkOut, args.guests);
      }),
  );

  return server;
}
