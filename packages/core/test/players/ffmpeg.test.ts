/**
 * ffmpeg's WebVTT demuxer (libavformat), which mpv and many media servers and converters read
 * subtitles with: each input goes through `ffmpeg -c copy -f webvtt` and the cues it keeps are
 * compared with ours. Runs where `ffmpeg` is installed (CI installs it).
 *
 * Known differences are listed below with what triggers them and a minimal example; each
 * example is checked to still show its difference, so an ffmpeg that fixes one fails the test.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompatibilityId, ParseResult, VttDocument } from '../../src/index.ts';
import {
  COMPATIBILITY_FIXES,
  FEATURES,
  exportDocument,
  featureDocument,
  importDocument,
  parse,
} from '../../src/index.ts';
import { Gen, generateDocument, rng } from '../fuzz/generate.ts';

const version = spawnSync('ffmpeg', ['-version']);
const hasFfmpeg = version.status === 0;

interface Deviation {
  /** Whether the input can show it (a RegExp, or a check of the parsed file). */
  trigger: { test: (text: string) => boolean };
  difference: RegExp;
  reason: string;
  example: string;
  /** The export compatibility fix that avoids it, if any. */
  fixedBy?: CompatibilityId;
}

const DEVIATIONS: Deviation[] = [
  {
    // libavformat skips NOTE blocks, but stops reading at any other block without "-->".
    trigger: /(?:^|\n)(?:STYLE|REGION)[ \t]*\n/,
    difference: /^\d+ cues, expected \d+$/,
    reason: 'reads no cues after a STYLE or REGION block (the whole rest of the file is lost)',
    example: 'WEBVTT\n\nSTYLE\n::cue { color: lime }\n\n00:00.000 --> 00:01.000\nhello\n',
    fixedBy: 'styles-and-regions',
  },
  {
    // The block starts with "NOTE", so it is skipped as a comment; later cues are kept.
    trigger: /(?:^|\n)NOTE[^\n]*\n[^\n]*-->/,
    difference: /^\d+ cues, expected \d+$/,
    reason: 'drops a cue whose id starts with "NOTE" (it reads the cue as a comment)',
    example: 'WEBVTT\n\nNOTES\n00:00.000 --> 00:01.000\nhello\n\n00:01.000 --> 00:02.000\nworld\n',
    fixedBy: 'keyword-ids',
  },
  {
    // Its subtitle queue removes events with the same time and text.
    trigger: {
      test: (text) => {
        const seen = new Set<string>();
        return parse(text).cues.some((c) => {
          const key = `${c.startMs} ${c.endMs} ${c.text}`;
          return seen.has(key) || !seen.add(key);
        });
      },
    },
    difference: /^\d+ cues, expected \d+$/,
    reason: 'keeps one of several cues with the same times and text, even with different ids',
    example: 'WEBVTT\n\na\n00:00.000 --> 00:01.000\nhello\n\nb\n00:00.000 --> 00:01.000\nhello\n',
  },
];

function roundTrip(text: string): string {
  const run = spawnSync(
    'ffmpeg',
    ['-loglevel', 'error', '-f', 'webvtt', '-i', '-', '-c', 'copy', '-f', 'webvtt', '-'],
    { input: text },
  );
  return run.stdout.toString();
}

const view = (result: ParseResult) =>
  result.cues.map((c) => ({
    id: c.id,
    start: c.startMs,
    end: c.endMs,
    text: c.text,
    line: c.line,
    snapToLines: c.snapToLines,
    lineAlign: c.lineAlign,
    position: c.position,
    positionAlign: c.positionAlign,
    size: c.size,
    align: c.align,
    vertical: c.vertical,
    region: c.region?.id ?? null,
  }));

function differences(input: string): string[] {
  const ours = view(parse(input));
  const theirs = view(parse(roundTrip(input)));
  if (ours.length !== theirs.length) return [`${theirs.length} cues, expected ${ours.length}`];
  const out: string[] = [];
  ours.forEach((cue, i) => {
    for (const key of Object.keys(cue) as (keyof typeof cue)[]) {
      const a = JSON.stringify((theirs[i] as typeof cue)[key]);
      const b = JSON.stringify(cue[key]);
      if (a !== b) out.push(`cue ${i} ${key}: ${a}, expected ${b}`);
    }
  });
  return out;
}

const explained = (input: string, diffs: string[]): boolean =>
  diffs.every((d) => DEVIATIONS.some((x) => x.trigger.test(input) && x.difference.test(d)));

const load = (text: string): VttDocument => {
  const r = importDocument(text);
  if (!r.ok) throw new Error('not WebVTT');
  return r.document;
};

function inputs(): { name: string; text: string }[] {
  const fixtures = ['autocaption-sample.vtt', 'autocaption-translated-sample.vtt'].map((name) => ({
    name,
    text: readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'),
  }));
  const features = FEATURES.map((f) => ({ name: `feature ${f.id}`, text: featureDocument(f) }));
  // Files we export: valid by construction, so every difference matters.
  const g = new Gen(rng(0x4c));
  const exported = Array.from({ length: 100 }, (_, i) => {
    const doc = importDocument(generateDocument(g));
    return { name: `fuzz ${i}`, text: doc.ok ? exportDocument(doc.document).text : '' };
  }).filter((x) => x.text !== '');
  return [...fixtures, ...features, ...exported];
}

it.runIf(process.env['CI'])('ffmpeg is installed in CI, so the comparison runs', () => {
  expect(hasFfmpeg).toBe(true);
});

describe.skipIf(!hasFfmpeg)('ffmpeg (libavformat) reads our files as we do', () => {
  it('on fixtures, feature examples and exported files', () => {
    const failures = inputs().flatMap(({ name, text }) => {
      const diffs = differences(text);
      return diffs.length === 0 || explained(text, diffs) ? [] : [`${name}: ${diffs.join('; ')}`];
    });
    expect(failures).toEqual([]);
  }, 60_000);

  it.each(DEVIATIONS.map((d) => [d.reason, d] as const))('documented: %s', (_reason, d) => {
    expect(d.trigger.test(d.example)).toBe(true);
    const diffs = differences(d.example);
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.every((x) => d.difference.test(x))).toBe(true);
  });

  it.each(DEVIATIONS.flatMap((d) => (d.fixedBy ? [[d.fixedBy, d] as const] : [])))(
    'avoided by export fix %s',
    (id, d) => {
      expect(differences(exportDocument(load(d.example), { compatibility: [id] }).text)).toEqual(
        [],
      );
    },
  );

  it('reads exported files exactly when every compatibility fix is on', () => {
    const all = COMPATIBILITY_FIXES.map((f) => f.id);
    const failures = inputs().flatMap(({ name, text }) => {
      const fixed = exportDocument(load(text), { compatibility: all }).text;
      const diffs = differences(fixed);
      const unfixed = DEVIATIONS.filter((d) => !d.fixedBy);
      return diffs.every((x) => unfixed.some((d) => d.trigger.test(fixed) && d.difference.test(x)))
        ? []
        : [`${name}: ${diffs.join('; ')}`];
    });
    expect(failures).toEqual([]);
  }, 60_000);
});
