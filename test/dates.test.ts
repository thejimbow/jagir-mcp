import { describe, expect, it } from 'vitest';
import {
  addDays, compactDate, eachNight, nightsBetween, normalizeDate, toJalaliString, todayTehran, validateStayDates,
} from '../src/core/dates.js';

describe('normalizeDate', () => {
  it('keeps Gregorian dates', () => expect(normalizeDate('2026-10-15')).toBe('2026-10-15'));
  it('pads single digits', () => expect(normalizeDate('2026-1-5')).toBe('2026-01-05'));
  it('converts Jalali dates', () => expect(normalizeDate('1405-07-23')).toBe('2026-10-15'));
  it('accepts Persian digits and slashes', () => expect(normalizeDate('۱۴۰۵/۰۷/۲۳')).toBe('2026-10-15'));
  it('rejects impossible Gregorian dates', () => expect(() => normalizeDate('2026-02-30')).toThrow(/Invalid date/));
  it('rejects impossible Jalali dates', () => expect(() => normalizeDate('1405-07-31')).toThrow(/Invalid Jalali/));
  it('rejects garbage', () => expect(() => normalizeDate('next friday')).toThrow(/YYYY-MM-DD/));
});

describe('date helpers', () => {
  it('toJalaliString', () => expect(toJalaliString('2026-10-15')).toBe('1405-07-23'));
  it('addDays crosses years', () => expect(addDays('2026-12-31', 1)).toBe('2027-01-01'));
  it('addDays negative', () => expect(addDays('2026-10-01', -1)).toBe('2026-09-30'));
  it('nightsBetween', () => expect(nightsBetween('2026-10-15', '2026-10-18')).toBe(3));
  it('eachNight excludes checkout', () =>
    expect(eachNight('2026-10-15', '2026-10-17')).toEqual(['2026-10-15', '2026-10-16']));
  it('compactDate', () => expect(compactDate('2026-10-15')).toBe(20261015));
  it('todayTehran uses UTC+3:30', () => expect(todayTehran(new Date('2026-10-01T21:00:00Z'))).toBe('2026-10-02'));
});

describe('validateStayDates', () => {
  const today = '2026-10-01';
  it('returns normalized dates and nights', () =>
    expect(validateStayDates('1405-07-23', '2026-10-17', today)).toEqual({ checkIn: '2026-10-15', checkOut: '2026-10-17', nights: 2 }));
  it('rejects past check-in', () => expect(() => validateStayDates('2026-09-30', '2026-10-02', today)).toThrow(/past/));
  it('rejects checkout before checkin', () => expect(() => validateStayDates('2026-10-05', '2026-10-05', today)).toThrow(/after/));
  it('rejects stays over 60 nights', () => expect(() => validateStayDates('2026-10-05', '2026-12-10', today)).toThrow(/60/));
});
