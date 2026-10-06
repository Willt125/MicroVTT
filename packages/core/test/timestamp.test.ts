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
  });
});
