import { describe, expect, it } from 'vitest';
import { formatTimestamp, parseTimestamp } from '../src/index.ts';

describe('parseTimestamp', () => {
  it.each([
    ['00:00.000', 0],
    ['01:02.003', 62_003],
    ['00:01:02.003', 62_003],
    ['1:00:00.000', 3_600_000],
    ['100:00:00.000', 360_000_000],
    // Two-digit leading component greater than 59 is interpreted as hours.
    ['60:00:00.000', 216_000_000],
  ])('parses %s', (input, ms) => {
    expect(parseTimestamp(input)).toEqual({ ok: true, ms, end: input.length });
  });

  it.each([
    '',
    'a',
    '00:00',
    '00:00.00',
    '00:00.0000',
    '0:00.000',
    '00:60.000',
    '00:00:60.000',
    '60:00.000',
    '00:00,000',
  ])('rejects %j', (input) => {
    expect(parseTimestamp(input).ok).toBe(false);
  });

  it('stops at the first character after the timestamp', () => {
    const input = '00:00:01.000 --> 00:00:02.000';
    expect(parseTimestamp(input)).toEqual({ ok: true, ms: 1000, end: 12 });
    expect(parseTimestamp(input, 17)).toEqual({ ok: true, ms: 2000, end: input.length });
  });
});

describe('formatTimestamp', () => {
  it('formats with hours by default', () => {
    expect(formatTimestamp(0)).toBe('00:00:00.000');
    expect(formatTimestamp(3_723_004)).toBe('01:02:03.004');
    expect(formatTimestamp(360_000_000)).toBe('100:00:00.000');
  });

  it('can omit zero hours', () => {
    expect(formatTimestamp(62_003, true)).toBe('01:02.003');
    expect(formatTimestamp(3_600_000, true)).toBe('01:00:00.000');
  });

  it('round-trips through parseTimestamp', () => {
    for (const ms of [0, 1, 999, 59_999, 3_599_999, 3_600_000, 86_399_999]) {
      const parsed = parseTimestamp(formatTimestamp(ms));
      expect(parsed.ok && parsed.ms).toBe(ms);
    }
  });

  it('rejects invalid input', () => {
    expect(() => formatTimestamp(-1)).toThrow(RangeError);
    expect(() => formatTimestamp(1.5)).toThrow(RangeError);
    expect(() => formatTimestamp(Number.NaN)).toThrow(RangeError);
    expect(() => formatTimestamp(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('formats hours beyond the safe-integer range exactly', () => {
    // The syntax puts no bound on hours; a garbled file must not crash formatting.
    const parsed = parseTimestamp('99999999999999999999:00:00.000');
    expect(parsed.ok).toBe(true);
    const ms = (parsed as { ms: number }).ms;
    // The double nearest to 10^20 hours is not a whole number of hours; only the shape is fixed.
    expect(formatTimestamp(ms)).toMatch(/^[0-9]{20}:[0-5][0-9]:[0-5][0-9]\.[0-9]{3}$/);
    expect(formatTimestamp(2 ** 60)).toBe('320255973501:54:06.976');
  });
});
