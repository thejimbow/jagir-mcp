import { describe, expect, it } from 'vitest';
import { addDays, todayTehran } from '../src/core/dates.js';
import { PLATFORMS } from '../src/core/types.js';
import { createAdapters } from '../src/platforms/index.js';

const adapters = createAdapters();
const checkIn = addDays(todayTehran(), 14);
const checkOut = addDays(checkIn, 2);

describe.skipIf(!process.env.LIVE)('live platforms', () => {
  for (const platform of PLATFORMS) {
    it(`${platform}: search → detail → calendar → reviews`, { timeout: 90_000 }, async () => {
      const adapter = adapters[platform];
      const res = await adapter.search({ location: 'رامسر', checkIn, checkOut, guests: 2, sort: 'rating', limit: 100 });
      expect(res.stays.length).toBeGreaterThan(0);
      const first = res.stays.find((s) => (s.reviewsCount ?? 0) >= 5) ?? res.stays[0]!;
      expect(first.price.total ?? first.price.perNight).toBeGreaterThan(0);
      const id = first.id.split(':')[1]!;
      const detail = await adapter.getStay(id);
      expect(detail.title.length).toBeGreaterThan(0);
      expect(detail.ratings?.breakdown.length).toBeGreaterThan(0);
      const days = await adapter.getCalendar(id, checkIn, addDays(checkIn, 7));
      expect(days.length).toBeGreaterThan(0);
      const reviews = await adapter.getReviews(id, 15);
      expect(reviews.reviews.length).toBeGreaterThan(0);
      expect(reviews.reviews.every((r) => r.text.length > 0)).toBe(true);
    });
  }
});
