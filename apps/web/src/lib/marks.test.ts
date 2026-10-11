import { describe, expect, it } from 'vitest';
import { INSERTS, insertAround, marksIn, withoutMark } from './marks.ts';

describe('invisible marks', () => {
  it('lists the marks in text with their counts', () => {
    const found = marksIn('\u200fשלום\u200f abc\u2067x\u2069');
    expect(found.map(({ mark, count }) => [mark.abbr, count])).toEqual([
      ['RLM', 2],
      ['RLI', 1],
      ['PDI', 1],
    ]);
    expect(marksIn('plain')).toEqual([]);
  });

  it('removes one kind of mark', () => {
    expect(withoutMark('\u200fa\u200fb\u200e', '\u200f')).toBe('ab\u200e');
  });

  it('inserts at the caret or around the selection', () => {
    const rli = INSERTS.find((i) => i.before === '\u2067')!;
    expect(insertAround('say hello now', 4, 9, rli.before, rli.after)).toEqual({
      text: 'say \u2067hello\u2069 now',
      start: 5,
      end: 10,
    });
    expect(insertAround('ab', 1, 1, '\u200f', '')).toEqual({ text: 'a\u200fb', start: 2, end: 2 });
  });
});
