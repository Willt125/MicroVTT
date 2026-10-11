/**
 * Rules for Chinese, Japanese and Korean subtitles, from Netflix's Chinese (Simplified and
 * Traditional), Japanese and Korean Timed Text Style Guides. Fixes change only the text outside
 * tags, and are offered where the right change is clear.
 */
import type { CueInfo, RuleDefinition } from './rules.ts';

const plain = (info: CueInfo): string => info.lines.join('\n');

/** Chinese and Japanese characters (Han, kana and the prolonged sound mark). */
const CJ = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー';
const HAS_CJ = new RegExp(`[${CJ}]`, 'u');

/** Applies `fn` to the text between tags, leaving tags as they are. */
const outsideTags = (raw: string, fn: (text: string) => string): string =>
  raw
    .split(/(<[^>]*>)/)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('');

/** ASCII to full-width forms (A → Ａ, 1 → １, ? → ？), and back. */
const toFullWidth = (s: string): string =>
  s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
const toHalfWidth = (s: string): string =>
  s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** Repeated or mixed question and exclamation marks (?!, !?, ??, !!), half- or full-width. */
const DOUBLED_MARKS = /[!！][?？!！]|[?？][!！?？]/;

/** Half-width ? ! : , ; next to Chinese or Japanese text. */
const HALF_MARK_BY_CJ = new RegExp(`(?<=[${CJ}])[?!:;,]|[?!:;,](?=[${CJ}])`, 'gu');

/** Straight or curly quotes as the Traditional Chinese guide's hook brackets. */
function hookQuotes(text: string): string | null {
  if ((text.match(/"/g)?.length ?? 0) % 2 !== 0) return null;
  let open = true;
  return text
    .replace(/"/g, () => {
      open = !open;
      return open ? '」' : '「';
    })
    .replace(/“/g, '「')
    .replace(/”/g, '」')
    .replace(/‘/g, '『')
    .replace(/’/g, '』');
}

/** Straight double quotes as full-width curly ones (“”), in pairs. */
function curlyQuotes(text: string): string | null {
  if ((text.match(/"/g)?.length ?? 0) % 2 !== 0) return null;
  let open = true;
  return text.replace(/"/g, () => {
    open = !open;
    return open ? '”' : '“';
  });
}

/** Tidies spaces left by removing punctuation: single spaces, none at line ends. */
const tidySpaces = (text: string): string => text.replace(/ {2,}/g, ' ').replace(/^ +| +$/gm, '');

/** Emits one finding listing the problems, with a fix when it changes anything. */
function report(
  info: CueInfo,
  problems: string[],
  fixed: string,
  label: string,
  emit: Parameters<NonNullable<RuleDefinition['cue']>>[2],
): void {
  if (problems.length === 0) return;
  emit({
    index: info.index,
    message: `${problems.join('; ')}.`,
    ...(fixed !== info.cue.text ? { fix: { label, change: { kind: 'text', text: fixed } } } : {}),
  });
}

/** Commas and full stops (not inside numbers, abbreviations or "..."). */
const COMMA_PERIOD = /[，。]|(?<![\p{L}\p{N}.])[.,]|[.,](?![\p{L}\p{N}.])/gu;
/** Full stops of any kind, except in numbers, after Latin letters (M.B.A.) and in "...". */
const ANY_PERIOD = /[。．]|(?<![A-Za-z\p{N}.])\.(?![\p{N}.])/gu;

const WEEKDAY_NUMERALS = ['', '一', '二', '三', '四', '五', '六', '日'];
const WEEKDAY_DIGIT = /(星期|禮拜|礼拜)([1-7１-７])(?![0-9０-９])/g;

/** Splits a number of 5–8 digits with 万, the leading part full-width if a single digit. */
function withMan(n: number): string {
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  const head = man < 10 ? toFullWidth(String(man)) : String(man);
  return `${head}万${rest === 0 ? '' : String(rest)}`;
}

export const CJK_RULES: RuleDefinition[] = [
  {
    id: 'no-italics',
    category: 'text',
    title: 'No italics',
    description: 'Italic tags (<i>), which the guide does not use.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      if (!/<i[\s.>]/.test(info.cue.text)) return;
      emit({
        index: info.index,
        message: 'Italics are not used.',
        fix: {
          label: 'Remove the italics',
          change: { kind: 'text', text: info.cue.text.replace(/<\/?i(?:[\s.][^>]*)?>/g, '') },
        },
      });
    },
  },
  {
    id: 'zh-hans-punctuation',
    category: 'text',
    title: 'Punctuation (Simplified Chinese)',
    description:
      'Commas and full stops (a space is used instead), an enumeration comma (、) at a line end, half-width ? ! : next to Chinese, doubled marks (?? !! ?!) and straight quotes.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const text = plain(info);
      const problems: string[] = [];
      if (new RegExp(COMMA_PERIOD.source, 'u').test(text))
        problems.push('commas and full stops are not used (a space instead)');
      if (/、\s*$/m.test(text)) problems.push('an enumeration comma (、) at the end of a line');
      if (new RegExp(HALF_MARK_BY_CJ.source, 'u').test(text))
        problems.push('half-width punctuation next to Chinese (use ？ ！ ：)');
      if (DOUBLED_MARKS.test(text)) problems.push('doubled marks (?? !! ?! !?) are not used');
      if (/"/.test(text)) problems.push('straight quotes (use “” and ‘’)');
      let fixed = outsideTags(info.cue.text, (t) =>
        tidySpaces(
          t
            .replace(COMMA_PERIOD, ' ')
            .replace(/、(?=\s*$)/gm, '')
            .replace(HALF_MARK_BY_CJ, (m) => toFullWidth(m)),
        ),
      );
      fixed = curlyQuotes(fixed) ?? fixed;
      report(info, problems, fixed, 'Fix the punctuation', emit);
    },
  },
  {
    id: 'zh-hant-punctuation',
    category: 'text',
    title: 'Punctuation (Traditional Chinese)',
    description:
      'Full stops of any kind, a comma or enumeration comma at a line end, half-width punctuation next to Chinese, doubled marks (?? !! ?!) and quotes other than 「」 and 『』.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const text = plain(info);
      const problems: string[] = [];
      if (new RegExp(ANY_PERIOD.source, 'u').test(text)) problems.push('full stops are not used');
      if (/[、，,]\s*$/m.test(text)) problems.push('a comma at the end of a line');
      if (new RegExp(HALF_MARK_BY_CJ.source, 'u').test(text))
        problems.push('half-width punctuation next to Chinese (use full-width)');
      if (DOUBLED_MARKS.test(text)) problems.push('doubled marks (?? !! ?! !?) are not used');
      if (/["“”‘’]/.test(text)) problems.push('quotes are written 「」, and 『』 inside them');
      let fixed = outsideTags(info.cue.text, (t) =>
        tidySpaces(
          t
            .replace(/(?:[。．]|(?<![A-Za-z\p{N}.])\.(?![\p{N}.]))(?=\s*$)/gmu, '')
            .replace(/[、，,](?=\s*$)/gm, '')
            .replace(HALF_MARK_BY_CJ, (m) => toFullWidth(m)),
        ),
      );
      fixed = hookQuotes(fixed) ?? fixed;
      report(info, problems, fixed, 'Fix the punctuation', emit);
    },
  },
  {
    id: 'zh-numbers',
    category: 'text',
    title: 'Numbers (Chinese)',
    description:
      'Full-width digits, a thousands comma in a four-digit number, a digit for a day of the week (星期2), and Arabic digits mixed with Chinese numerals (五千2百).',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const text = plain(info);
      const problems: string[] = [];
      if (/[０-９]/.test(text)) problems.push('full-width digits (use 1, 2, 3)');
      if (/(?<![\d,.])\d,\d{3}(?![\d,])/.test(text))
        problems.push('a comma in a four-digit number');
      if (new RegExp(WEEKDAY_DIGIT.source).test(text))
        problems.push('a digit for a day of the week (星期二, not 星期2)');
      if (/[一二三四五六七八九十百千][0-9]|[0-9][十百千]/.test(text))
        problems.push('Arabic digits mixed with Chinese numerals');
      const fixed = outsideTags(info.cue.text, (t) =>
        t
          .replace(/[０-９]/g, (c) => toHalfWidth(c))
          .replace(/(?<![\d,.])(\d),(\d{3})(?![\d,])/g, '$1$2')
          .replace(
            WEEKDAY_DIGIT,
            (_m, day: string, d: string) => day + WEEKDAY_NUMERALS[Number(toHalfWidth(d))],
          ),
      );
      report(info, problems, fixed, 'Fix the numbers', emit);
    },
  },
  {
    id: 'ja-punctuation',
    category: 'text',
    title: 'Punctuation (Japanese)',
    description:
      '、 and 。 (a half-width and a full-width space are used instead), half-width ? and ! next to Japanese, no full-width space after ？ or ！ before the next sentence, and a full-width nakaguro (・) between names.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      // Official titles in hook brackets keep their punctuation.
      const text = plain(info).replace(/「[^」]*」/g, '「」');
      const problems: string[] = [];
      if (/[、。]/.test(text)) problems.push('、 and 。 are not used (spaces instead)');
      if (new RegExp(`(?<=[${CJ}])[?!]|[?!](?=[${CJ}])`, 'u').test(text))
        problems.push('half-width ? or ! (use ？ ！)');
      if (new RegExp(`[？！](?=[${CJ}「])`, 'u').test(text))
        problems.push('a full-width space follows ？ and ！ before the next sentence');
      if (/(?<=\p{Script=Katakana})・(?=\p{Script=Katakana})/u.test(text))
        problems.push('foreign names are separated with a half-width nakaguro (･)');
      const fixed = outsideTags(info.cue.text, (t) =>
        t
          .split(/(「[^」]*」)/)
          .map((part, i) =>
            i % 2 === 1
              ? part
              : part
                  .replace(/[、。](?=\s*$)/gm, '')
                  .replace(/、/g, ' ')
                  .replace(/。/g, '\u3000')
                  .replace(new RegExp(`(?<=[${CJ}])[?!]|[?!](?=[${CJ}])`, 'gu'), (m) =>
                    toFullWidth(m),
                  )
                  .replace(new RegExp(`([？！])(?=[${CJ}「])`, 'gu'), '$1\u3000')
                  .replace(/(?<=\p{Script=Katakana})・(?=\p{Script=Katakana})/gu, '･'),
          )
          .join(''),
      );
      report(info, problems, fixed, 'Fix the punctuation', emit);
    },
  },
  {
    id: 'ja-numbers',
    category: 'text',
    title: 'Numbers (Japanese)',
    description:
      'In horizontal cues: a single digit in half-width (３人), two or more digits in full-width (12人), thousands commas, and numbers over four digits without 万.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      if (info.cue.vertical) return; // Vertical numbers follow other rules (tate-chū-yoko).
      const text = plain(info);
      const single = /(?<![0-9０-９A-Za-zＡ-Ｚａ-ｚ.,:/])[0-9](?![0-9０-９A-Za-zＡ-Ｚａ-ｚ.,:/])/g;
      const wide = /[０-９]{2,}/g;
      const commas = /(?<![\d.])\d{1,3}(?:,\d{3})+(?![\d.])/g;
      const long = /(?<![\d.,])\d{5,8}(?![\d.,])/g;
      const problems: string[] = [];
      if (new RegExp(single.source).test(text)) problems.push('a single digit is full-width (３)');
      if (new RegExp(wide.source).test(text)) problems.push('two or more digits are half-width');
      if (new RegExp(commas.source).test(text)) problems.push('numbers take no commas');
      if (new RegExp(long.source).test(text) || /\d{9,}/.test(text))
        problems.push('numbers over four digits use 万 (１万2345)');
      const fixed = outsideTags(info.cue.text, (t) =>
        t
          .replace(commas, (m) => m.replace(/,/g, ''))
          .replace(long, (m) => withMan(Number(m)))
          .replace(wide, (m) => toHalfWidth(m))
          .replace(single, (m) => toFullWidth(m)),
      );
      report(info, problems, fixed, 'Fix the numbers', emit);
    },
  },
  {
    id: 'ja-latin',
    category: 'text',
    title: 'Latin letters (Japanese)',
    description:
      'Acronyms of up to five letters in half-width (use full-width, ＢＢＣ), words of more than five letters in full-width (use half-width), and half-width English with full-width ！ or ？ on one line.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const acronym = /(?<![A-Za-z0-9])[A-Z]{2,5}(?![A-Za-z0-9])/g;
      const wideWord = /[Ａ-Ｚａ-ｚ]{6,}/g;
      const problems: string[] = [];
      for (const line of info.lines) {
        if (!HAS_CJ.test(line)) continue;
        if (new RegExp(acronym.source).test(line))
          problems.push('acronyms are full-width (ＢＢＣ)');
        if (new RegExp(wideWord.source).test(line))
          problems.push('words of more than five letters are half-width');
        if (/[A-Za-z]/.test(line) && /[！？]/.test(line))
          problems.push('half-width English and full-width ！ ？ on one line');
      }
      if (problems.length === 0) return;
      const fixed = info.cue.text
        .split('\n')
        .map((line) =>
          HAS_CJ.test(line)
            ? outsideTags(line, (t) =>
                t.replace(acronym, (m) => toFullWidth(m)).replace(wideWord, (m) => toHalfWidth(m)),
              )
            : line,
        )
        .join('\n');
      report(info, [...new Set(problems)], fixed, 'Fix the letters', emit);
    },
  },
  {
    id: 'half-width-katakana',
    category: 'text',
    title: 'Half-width katakana',
    description:
      'Half-width katakana (ｶﾀｶﾅ) and half-width Japanese punctuation, except the nakaguro (･).',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const halfKana = /[｡-､ｦ-ﾟ]+/g;
      if (!new RegExp(halfKana.source).test(plain(info))) return;
      emit({
        index: info.index,
        message: 'Half-width katakana; use full-width.',
        fix: {
          label: 'Use full-width',
          change: {
            kind: 'text',
            text: outsideTags(info.cue.text, (t) =>
              t.replace(halfKana, (m) => m.normalize('NFKC')),
            ),
          },
        },
      });
    },
  },
  {
    id: 'ko-punctuation',
    category: 'text',
    title: 'Punctuation (Korean)',
    description:
      'A full stop or comma at the end of a line, a full stop between sentences in one subtitle (a comma is used), and !? (written ?!).',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const text = plain(info);
      const lineEnd = /(?<![.…])[.,](?=\s*$)/gm;
      const between = /(?<![A-Z.])\.(?=[ \t]+\p{Script=Hangul})/gu;
      const problems: string[] = [];
      if (new RegExp(lineEnd.source, 'm').test(text))
        problems.push('no full stop or comma at the end of a line');
      if (new RegExp(between.source, 'u').test(text))
        problems.push('sentences in one subtitle are separated with a comma');
      if (/!\?/.test(text)) problems.push('?! is preferred to !?');
      const fixed = outsideTags(info.cue.text, (t) =>
        t.replace(lineEnd, '').replace(between, ',').replace(/!\?/g, '?!'),
      );
      report(info, problems, fixed, 'Fix the punctuation', emit);
    },
  },
];
