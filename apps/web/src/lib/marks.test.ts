import { describe, expect, it } from 'vitest';
import { INSERTS, insertAround, marksIn, withoutMark } from './marks.ts';

describe('invisible marks', () => {
  it('lists the marks in text with their counts', () => {
    const found = marksIn('‏שלום‏ abc⁧x⁩');
    expect(found.map(({ mark, count }) => [mark.abbr, count])).toEqual([
      ['RLM', 2],
      ['RLI', 1],
      ['PDI', 1],
    ]);
    expect(marksIn('plain')).toEqual([]);
  });

  it('removes one kind of mark', () => {
    expect(withoutMark('‏a‏b‎', '‏')).toBe('ab‎');
  });

  it('inserts at the caret or around the selection', () => {
    const rli = INSERTS.find((i) => i.before === '⁧')!;
    expect(insertAround('say hello now', 4, 9, rli.before, rli.after)).toEqual({
      text: 'say ⁧hello⁩ now',
      start: 5,
      end: 10,
    });
    expect(insertAround('ab', 1, 1, '‏', '')).toEqual({ text: 'a‏b', start: 2, end: 2 });
  });
});
