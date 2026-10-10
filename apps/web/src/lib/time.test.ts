import { describe, expect, it } from 'vitest';
import { formatDuration, formatShift, parseSignedTime, parseTimeInput } from './time.ts';

describe('parseTimeInput', () => {
  it.each([
    ['01:02:03.456', 3_723_456],
    ['00:00:00.000', 0],
    ['2:03.4', 123_400],
    ['83.5', 83_500],
    ['83,5', 83_500],
    ['1:5', 65_000],
    ['100:00:00', 360_000_000],
    [' 7 ', 7000],
  ])('%j → %d ms', (input, ms) => expect(parseTimeInput(input)).toBe(ms));

  it.each(['', 'abc', '1:60', '1:60:00', '1.2345', '-1', '1::2'])('rejects %j', (input) =>
    expect(parseTimeInput(input)).toBeNull(),
  );
});

describe('formatDuration', () => {
  it('shows seconds with milliseconds', () => expect(formatDuration(1234)).toBe('1.234 s'));
});

describe('parseSignedTime', () => {
  it('reads an optional sign', () => {
    expect(parseSignedTime('-1.5')).toBe(-1500);
    expect(parseSignedTime('− 0:02.25')).toBe(-2250);
    expect(parseSignedTime('+3')).toBe(3000);
    expect(parseSignedTime('3')).toBe(3000);
    expect(parseSignedTime('--3')).toBeNull();
    expect(formatShift(-40)).toBe('−0.040 s');
    expect(formatShift(1500)).toBe('+1.500 s');
  });
});
