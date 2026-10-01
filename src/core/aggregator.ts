import type { LocationMatch, Platform, PlatformAdapter, SearchParams, SortOrder, Stay } from './types.js';
import { errorMessage } from './util.js';

const MAX_LOCATION_MATCHES = 5;

export interface PlatformFailure {
  platform: Platform;
  message: string;
}

export interface AggregatedSearch {
  stays: Stay[];
  totals: Partial<Record<Platform, number | null>>;
  errors: PlatformFailure[];
}

export async function settle<T>(
  adapters: readonly PlatformAdapter[],
  run: (adapter: PlatformAdapter) => Promise<T>,
): Promise<{ ok: { platform: Platform; value: T }[]; failed: PlatformFailure[] }> {
  const settled = await Promise.allSettled(adapters.map((a) => run(a)));
  const ok: { platform: Platform; value: T }[] = [];
  const failed: PlatformFailure[] = [];
  settled.forEach((s, i) => {
    const platform = adapters[i]!.platform;
    if (s.status === 'fulfilled') ok.push({ platform, value: s.value });
    else failed.push({ platform, message: errorMessage(s.reason) });
  });
  return { ok, failed };
}

export function interleave(lists: readonly Stay[][]): Stay[] {
  const out: Stay[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (i < list.length) out.push(list[i]!);
  return out;
}

const comparablePrice = (s: Stay) => s.price.total ?? s.price.perNight;

export function sortStays(stays: readonly Stay[], sort: SortOrder): Stay[] {
  const copy = [...stays];
  if (sort === 'price_asc' || sort === 'price_desc') {
    const dir = sort === 'price_asc' ? 1 : -1;
    copy.sort((a, b) => {
      const pa = comparablePrice(a);
      const pb = comparablePrice(b);
      if (pa === null || pb === null) return pa === pb ? 0 : pa === null ? 1 : -1;
      return (pa - pb) * dir;
    });
  } else if (sort === 'rating') {
    copy.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.reviewsCount ?? 0) - (a.reviewsCount ?? 0));
  }
  return copy;
}

export async function searchAll(adapters: readonly PlatformAdapter[], params: SearchParams): Promise<AggregatedSearch> {
  const { ok, failed } = await settle(adapters, (a) => a.search(params));
  const lists = ok.map((r) => r.value.stays);
  const merged = params.sort === 'relevance' ? interleave(lists) : sortStays(lists.flat(), params.sort);
  return {
    stays: merged.slice(0, params.limit),
    totals: Object.fromEntries(ok.map((r) => [r.platform, r.value.total])),
    errors: failed,
  };
}

export async function resolveAll(
  adapters: readonly PlatformAdapter[],
  query: string,
): Promise<{ matches: Partial<Record<Platform, LocationMatch[]>>; errors: PlatformFailure[] }> {
  const { ok, failed } = await settle(adapters, (a) => a.resolveLocation(query));
  return {
    matches: Object.fromEntries(ok.map((r) => [r.platform, r.value.slice(0, MAX_LOCATION_MATCHES)])),
    errors: failed,
  };
}
