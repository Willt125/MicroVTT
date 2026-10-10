/**
 * Text in other scripts through the whole pipeline: import, validation, export, language hints,
 * splitting and the style checks.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Cue, VttDocument } from '../src/index.ts';
import {
  RULESETS,
  checkQuality,
  guessLanguage,
  importDocument,
  languageHint,
  sampleText,
  serialize,
  splitCue,
  validate,
} from '../src/index.ts';

const DIR = new URL('./fixtures/multilingual/', import.meta.url);
const files = readdirSync(DIR).filter((name) => name.endsWith('.vtt'));
const read = (name: string): string => readFileSync(new URL(name, DIR), 'utf8');
const cuesOf = (doc: VttDocument): [Cue, number][] =>
  doc.body.flatMap((item, i): [Cue, number][] => (item.type === 'cue' ? [[item, i]] : []));
const visible = (text: string): string => text.replace(/<[^>]*>/g, '').replace(/\s+/g, '');

/** The language each fixture should get, and where from. */
const EXPECTED: Record<string, [string, 'header' | 'markup' | 'file-name' | 'guess']> = {
  'ar.vtt': ['ar', 'header'],
  'he.vtt': ['he', 'markup'],
  'hi.vtt': ['hi', 'header'],
  'ja.vtt': ['ja', 'header'],
  'ko.vtt': ['ko', 'guess'],
  'talk.zh-Hant.vtt': ['zh-Hant', 'file-name'],
  'th.vtt': ['th', 'header'],
};

describe.each(files)('%s', (name) => {
  const source = read(name);
  const doc = importDocument(source).document;

  it('imports and validates without errors, and exports the same text', () => {
    // YouTube's Language: header line is not WebVTT, and is reported as such.
    const errors = validate(source).diagnostics.filter((d) => d.severity === 'error');
    expect(errors.map((d) => d.code)).toEqual(
      source.includes('\nLanguage:') ? ['header-text'] : [],
    );
    // Export keeps those lines, in a NOTE.
    expect(serialize(doc)).toBe(source.replace(/^WEBVTT\n(?=\S)/, 'WEBVTT\n\nNOTE\n'));
  });

  it('gets its language from the file, or a confident guess', () => {
    const [tag, from] = EXPECTED[name] as [string, string];
    const hint = languageHint(doc, name);
    if (from === 'guess') {
      expect(hint).toBeNull();
      expect(guessLanguage(sampleText(doc))?.tag).toBe(tag);
    } else {
      expect(hint).toEqual({ tag, source: from });
    }
  });

  it('splits a cue without losing or changing text', () => {
    const [cue, index] = cuesOf(doc).at(-1) as [Cue, number];
    const offset = cue.text.indexOf('\n') > 0 ? cue.text.indexOf('\n') : cue.text.length >> 1;
    const split = splitCue(doc, index, (cue.startMs + cue.endMs) / 2, offset);
    const halves = cuesOf(split)
      .slice(-2)
      .map(([c]) => c.text);
    expect(visible(halves.join(''))).toBe(visible(cue.text));
  });

  // Thai, which separates phrases with spaces, joins lines with one.
  it('runs every ruleset, and its fixes add no spaces to Chinese or Japanese', () => {
    for (const ruleset of RULESETS) {
      for (const finding of checkQuality(doc, ruleset)) {
        const change = finding.fix?.change;
        if (change?.kind !== 'text' || !/^(ja|talk\.zh)/.test(name)) continue;
        expect(change.text.replace(/\n/g, '')).not.toMatch(/[^\x20-\x7e] [^\x20-\x7e]/);
      }
    }
  });
});
