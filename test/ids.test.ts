import { describe, expect, it } from 'vitest';
import { formatStayId, parseStayId } from '../src/core/ids.js';

describe('stay ids', () => {
  it('round-trips', () => expect(parseStayId(formatStayId('jajiga', 3237270))).toEqual({ platform: 'jajiga', id: '3237270' }));
  it('accepts mongo-style ids', () =>
    expect(parseStayId(' jabama:69c979975b6e82d43096dcb9 ')).toEqual({ platform: 'jabama', id: '69c979975b6e82d43096dcb9' }));
  it('rejects unknown platforms', () => expect(() => parseStayId('airbnb:1')).toThrow(/Invalid stay id/));
  it('rejects missing ids', () => expect(() => parseStayId('otaghak:')).toThrow(/Invalid stay id/));
});
