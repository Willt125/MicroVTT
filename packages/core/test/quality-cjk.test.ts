/** Chinese, Japanese and Korean: width-aware measuring and the language rules. */
import { describe, expect, it } from 'vitest';
import type { Cue, QualityRuleId, Ruleset, VttDocument } from '../src/index.ts';
import {
  checkQuality,
  createCue,
  createDocument,
  displayLength,
  languageMatches,
} from '../src/index.ts';

const doc = (...cues: Cue[]): VttDocument => ({ ...createDocument(), body: cues });
const only = (id: QualityRuleId, params?: Record<string, number>): Ruleset => ({
  id: 'test',
  name: 'test',
  description: '',
  sources: [],
  notChecked: [],
  rules: { [id]: { severity: 'warning', ...(params ? { params } : {}) } },
});
const check = (
  text: string,
  id: QualityRuleId,
  params?: Record<string, number>,
  cue?: Partial<Cue>,
) => checkQuality(doc({ ...createCue(0, 3000, text), ...cue }), only(id, params));
const fixOf = (text: string, id: QualityRuleId, params?: Record<string, number>) => {
  const change = check(text, id, params)[0]?.fix?.change;
  return change?.kind === 'text' ? change.text : undefined;
};

describe('measuring', () => {
  it('counts half-width characters as half where a guide says so', () => {
    expect(displayLength('한국어 OK', 0.5)).toBe(4.5); // 3 + space, O and K at 0.5 each
    expect(displayLength('ＢＢＣは', 0.5)).toBe(4); // Full-width letters count one each.
    expect(displayLength('ｶﾀｶﾅ', 0.5)).toBe(2);
    expect(displayLength('한국어 OK', 1)).toBe(6);
  });

  it('applies the half-width count and the vertical limit to line length', () => {
    // 14 Hangul characters and 4 spaces: 18 at full width, 16 with spaces counting half.
    const line = '가나다 라마바 사아자 차카타 파하';
    expect(check(line, 'line-length', { max: 16 })).toHaveLength(1);
    expect(check(line, 'line-length', { max: 16, halfWidth: 0.5 })).toHaveLength(0);
    const ja = '今日はいい天気ですね散歩に'; // 13 characters
    expect(check(ja, 'line-length', { max: 13, maxVertical: 11 })).toHaveLength(0);
    const [vertical] = check(ja, 'line-length', { max: 13, maxVertical: 11 }, { vertical: 'rl' });
    expect(vertical?.message).toBe('Line 1 has 13 characters; the limit is 11 (vertical).');
  });

  it('matches Chinese rulesets by script', () => {
    expect(languageMatches('zh-Hant', 'zh-TW')).toBe(true);
    expect(languageMatches('zh-Hant', 'zh-Hant-HK')).toBe(true);
    expect(languageMatches('zh-Hans', 'zh-TW')).toBe(false);
    expect(languageMatches('zh-Hans', 'zh-CN')).toBe(true);
    expect(languageMatches('zh-Hans', 'zh')).toBe(true);
    expect(languageMatches('zh-Hant', 'zh')).toBe(true);
    expect(languageMatches('ja', 'ja-JP')).toBe(true);
    expect(languageMatches('ko', 'ja')).toBe(false);
  });
});

describe('Chinese', () => {
  it('Simplified: spaces for commas and full stops, full-width marks, curly quotes', () => {
    expect(fixOf('我最爱海滩了，因为在海里游泳最好了。', 'zh-hans-punctuation')).toBe(
      '我最爱海滩了 因为在海里游泳最好了',
    );
    expect(fixOf('日期:1976年', 'zh-hans-punctuation')).toBe('日期：1976年');
    expect(fixOf('他说"你好"', 'zh-hans-punctuation')).toBe('他说“你好”');
    expect(fixOf('A、B、\nC', 'zh-hans-punctuation')).toBe('A、B\nC');
    expect(check('真的吗？？', 'zh-hans-punctuation')[0]?.message).toContain('doubled marks');
    // Numbers and abbreviations keep their points; ellipses are another rule's.
    expect(check('他有225.5万 我…我', 'zh-hans-punctuation')).toEqual([]);
  });

  it('Traditional: no full stops, no comma at a line end, hook-bracket quotes', () => {
    expect(fixOf('我最愛海灘了，因為\n我喜歡游泳。', 'zh-hant-punctuation')).toBe(
      '我最愛海灘了，因為\n我喜歡游泳',
    );
    expect(fixOf('我問：“你有什麼？”', 'zh-hant-punctuation')).toBe('我問：「你有什麼？」');
    expect(fixOf('真的?', 'zh-hant-punctuation')).toBe('真的？');
    expect(check('他是M.B.A.畢業', 'zh-hant-punctuation')).toEqual([]);
    expect(check('她過來這裡….', 'zh-hant-punctuation')[0]?.message).toContain('full stops');
  });

  it('numbers: half-width digits, no comma in four digits, days of the week in words', () => {
    expect(fixOf('１８００美元', 'zh-numbers')).toBe('1800美元');
    expect(fixOf('1,800美元', 'zh-numbers')).toBe('1800美元');
    expect(fixOf('星期2见', 'zh-numbers')).toBe('星期二见');
    expect(fixOf('禮拜7', 'zh-numbers')).toBe('禮拜日');
    expect(check('五千2百', 'zh-numbers')[0]?.message).toContain('mixed');
    expect(check('1199萬，12、11、10', 'zh-numbers')).toEqual([]);
  });

  it('ellipses and italics', () => {
    expect(fixOf('但你说⋯', 'ellipsis-character')).toBe('但你说…');
    expect(fixOf('<i>你好</i>', 'no-italics')).toBe('你好');
  });
});

describe('Japanese', () => {
  it('punctuation: spaces for 、 and 。, full-width ？！ with a space after', () => {
    expect(fixOf('正直なところ、分からない。そうだね。', 'ja-punctuation')).toBe(
      '正直なところ 分からない\u3000そうだね',
    );
    expect(fixOf('まさか?そんな!', 'ja-punctuation')).toBe('まさか？\u3000そんな！');
    expect(fixOf('ビル・ゲイツ', 'ja-punctuation')).toBe('ビル･ゲイツ');
    // Official titles keep their punctuation.
    expect(check('映画「食べて、祈って、恋をして」', 'ja-punctuation')).toEqual([]);
  });

  it('numbers: one digit full-width, more half-width, 万 above four digits', () => {
    expect(fixOf('3人と１２人', 'ja-numbers')).toBe('３人と12人');
    expect(fixOf('1,500円', 'ja-numbers')).toBe('1500円');
    expect(fixOf('12345人', 'ja-numbers')).toBe('１万2345人');
    expect(check('2008年12月31日', 'ja-numbers')).toEqual([]);
    expect(check('3人', 'ja-numbers', undefined, { vertical: 'rl' })).toEqual([]);
  });

  it('Latin letters: full-width acronyms, half-width long words, no mixing with ！？', () => {
    expect(fixOf('BBCの記者', 'ja-latin')).toBe('ＢＢＣの記者');
    expect(fixOf('ＮＡＳＤＡＱは', 'ja-latin')).toBe('NASDAQは'); // Over five letters: half-width.
    expect(fixOf('ＮＥＴＦＬＩＸで', 'ja-latin')).toBe('NETFLIXで');
    expect(check('Charlieは？', 'ja-latin')[0]?.message).toContain('！ ？ on one line');
    expect(check('This is English', 'ja-latin')).toEqual([]);
  });

  it('half-width katakana, except the nakaguro', () => {
    expect(fixOf('ｶﾀｶﾅとｶﾞ', 'half-width-katakana')).toBe('カタカナとガ');
    expect(check('ビル･ゲイツ', 'half-width-katakana')).toEqual([]);
  });
});

describe('Korean', () => {
  it('no full stop or comma at a line end, commas between sentences, ?! not !?', () => {
    expect(fixOf('사랑해.\n그게 내가 하고 싶은 말이었어', 'ko-punctuation')).toBe(
      '사랑해\n그게 내가 하고 싶은 말이었어',
    );
    expect(fixOf('사랑해. 그게 내가', 'ko-punctuation')).toBe('사랑해, 그게 내가');
    expect(fixOf('뭐!?', 'ko-punctuation')).toBe('뭐?!');
    expect(check('호머 J. 심슨', 'ko-punctuation')).toEqual([]);
    expect(check('오늘 날씨는 아주…', 'ko-punctuation')).toEqual([]);
  });

  it('dual-speaker hyphens take a space', () => {
    expect(fixOf('-하지만 왜요?\n-미국에요', 'speaker-hyphen', { space: 1 })).toBe(
      '- 하지만 왜요?\n- 미국에요',
    );
    expect(check('- 하지만 왜요?\n- 미국에요', 'speaker-hyphen', { space: 1 })).toEqual([]);
  });
});
