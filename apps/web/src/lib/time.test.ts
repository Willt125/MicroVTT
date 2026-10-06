import { describe, expect, it } from 'vitest';
import { formatDuration, parseTimeInput } from './time.ts';

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
