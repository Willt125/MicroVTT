/**
 * Player-compatibility export fixes: each one removes what it targets, the export still conforms,
 * and fixes that are not lossy leave what a conforming player shows unchanged. The players
 * themselves are checked in apps/web/e2e/players.e2e.ts, native.e2e.ts and test/players.
 */
import { describe, expect, it } from 'vitest';
import type { CompatibilityId, VttDocument } from '../src/index.ts';
import {
  COMPATIBILITY_FIXES,
  applyCompatibility,
  compatibilityIssues,
  exportDocument,
  KEYWORD_ID,
  importDocument,
  parse,
  parseCueText,
} from '../src/index.ts';
import { Gen, generateDocument, rng } from './fuzz/generate.ts';

const H = 'WEBVTT\n\n';
const CUE = '00:00:00.000 --> 00:00:01.000';

const load = (text: string): VttDocument => {
  const r = importDocument(text);
  if (!r.ok) throw new Error('not WebVTT');
  return r.document;
};
const ALL = COMPATIBILITY_FIXES.map((f) => f.id);
const exported = (text: string, ids: readonly CompatibilityId[]): string =>
  exportDocument(load(text), { compatibility: ids }).text;

const EXAMPLES: Record<CompatibilityId, { input: string; output: string }> = {
  'keyword-ids': {
    input: `${H}NOTES\n${CUE}\nx\n`,
    output: `${H}${CUE}\nx\n`,
  },
  'regions-first': {
    input: `WEBVTT\nLanguage: en\n\nREGION\nid:r\n\n${CUE} region:r\nx\n`,
    output: `${H}REGION\nid:r\n\nNOTE\nLanguage: en\n\n${CUE} region:r\nx\n`,
  },
  'character-references': {
    input: `${H}${CUE}\ncaf&eacute; &AMP; &nbsp;&#233;\n`,
    output: `${H}${CUE}\ncafé &amp; &nbsp;&#233;\n`,
  },
  'trim-whitespace': {
    input: `${H}${CUE}\n \n  one\n\t\ntwo \n`,
    output: `${H}${CUE}\none\ntwo\n`,
  },
  'lang-spans': {
    input: `${H}${CUE}\n<i>Kiitos, <lang fi>kiitos</lang></i>\n`,
    output: `${H}${CUE}\n<i>Kiitos, kiitos</i>\n`,
  },
  'styles-and-regions': {
    input: `${H}STYLE\n::cue { color: red }\n\nREGION\nid:r\n\nNOTE kept\n\n${CUE} region:r\nx\n`,
    output: `${H}NOTE kept\n\n${CUE}\nx\n`,
  },
};

describe('compatibility fixes', () => {
  it.each(COMPATIBILITY_FIXES.map((f) => [f.id, f] as const))('%s', (id, fix) => {
    const { input, output } = EXAMPLES[id];
    expect(fix.count(load(input))).toBeGreaterThan(0);
    const text = exported(input, [id]);
    expect(text).toBe(output);
    expect(fix.count(load(text))).toBe(0);
    expect(exportDocument(load(text)).diagnostics.filter((d) => d.severity === 'error')).toEqual(
      [],
    );
  });

  it('reports only what applies', () => {
    expect(compatibilityIssues(load(`${H}${CUE}\nplain\n`))).toEqual([]);
    expect(compatibilityIssues(load(EXAMPLES['keyword-ids'].input)).map((x) => x.fix.id)).toEqual([
      'keyword-ids',
    ]);
  });

  it('keeps fuzz documents conforming, and lossless fixes keep what a player shows', () => {
    const g = new Gen(rng(0xc0));
    const lossless = COMPATIBILITY_FIXES.filter((f) => !f.lossy).map((f) => f.id);
    for (let i = 0; i < 300; i++) {
      const imp = importDocument(generateDocument(g));
      if (!imp.ok) continue;
      const plain = exportDocument(imp.document);
      const all = exportDocument(imp.document, { compatibility: ALL });
      expect(all.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(compatibilityIssues(all.document).map((x) => x.fix.id)).toEqual([]);

      // Lossless fixes keep every cue, setting, region and cue text tree; only keyword ids go.
      const view = (text: string) =>
        parse(text).cues.map((c) => ({
          id: KEYWORD_ID.test(c.id) ? '' : c.id,
          start: c.startMs,
          end: c.endMs,
          settings: [c.vertical, c.line, c.snapToLines, c.lineAlign, c.position],
          more: [c.positionAlign, c.size, c.align, c.region?.id ?? null],
          tree: parseCueText(c.text),
        }));
      const kept = exportDocument(imp.document, { compatibility: lossless });
      expect(view(kept.text)).toEqual(view(plain.text));
    }
  });

  it('applies fixes in catalogue order whatever order they are given in', () => {
    const doc = load(EXAMPLES['styles-and-regions'].input);
    expect(applyCompatibility(doc, ['styles-and-regions', 'regions-first'])).toEqual(
      applyCompatibility(doc, ['regions-first', 'styles-and-regions']),
    );
  });
});
