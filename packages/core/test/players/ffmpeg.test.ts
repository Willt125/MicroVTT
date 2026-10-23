/**
 * ffmpeg's WebVTT demuxer (libavformat), which mpv and many media servers and converters read
 * subtitles with: each input goes through `ffmpeg -c copy -f webvtt` and the cues it keeps are
 * compared with ours. Runs where `ffmpeg` is installed, or the binary named by $FFMPEG (CI runs
 * it with the distribution's 6.1 and with 7.0).
 *
 * Known differences are listed below with what triggers them, the versions that show them and
 * a minimal example. Each example is checked to show its difference on those versions and not
 * on others, so an ffmpeg that fixes one (or brings one back) fails the test.
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

const FFMPEG = process.env['FFMPEG'] ?? 'ffmpeg';
const version = spawnSync(FFMPEG, ['-version']);
const hasFfmpeg = version.status === 0;
/**
 * The binary's version as major * 100 + minor ("ffmpeg version 6.1.1-3ubuntu5" is 601). Builds
 * from the development branch ("N-…" or a commit) count as newer than any release.
 */
const ffmpegVersion = ((): number => {
  const m = /ffmpeg version n?(\d+)\.(\d+)/.exec(version.stdout?.toString() ?? '');
  return m ? Number(m[1]) * 100 + Number(m[2]) : Infinity;
})();

interface Deviation {
  /** Whether the input can show it (a RegExp, or a check of the parsed file). */
  trigger: { test: (text: string) => boolean };
  difference: RegExp;
  reason: string;
  example: string;
  /** The export compatibility fix that avoids it, if any. */
  fixedBy?: CompatibilityId;
  /** The versions that show it, as major * 100 + minor: from (inclusive) and before. */
  versions?: { from?: number; before?: number };
}

const DEVIATIONS: Deviation[] = [
  {
    // libavformat skips NOTE blocks, but stops reading at any other block without "-->".
    trigger: /(?:^|\n)(?:STYLE|REGION)[ \t]*\n/,
    difference: /^\d+ cues, expected \d+$/,
    reason: 'reads no cues after a STYLE or REGION block (the whole rest of the file is lost)',
    example: 'WEBVTT\n\nSTYLE\n::cue { color: lime }\n\n00:00.000 --> 00:01.000\nhello\n',
    fixedBy: 'styles-and-regions',
    // 7.0 skips STYLE and REGION blocks as it does NOTE blocks.
    versions: { before: 700 },
  },
  {
    // Since 7.0 any block starting with "STYLE" or "REGION" is skipped, even a cue's id.
    trigger: /(?:^|\n)(?:STYLE|REGION)[^\n]*\n[^\n]*-->/,
    difference: /^\d+ cues, expected \d+$/,
    reason: 'drops a cue whose id starts with "STYLE" or "REGION" (it skips the cue as a block)',
    example: 'WEBVTT\n\nSTYLE1\n00:00.000 --> 00:01.000\nhello\n\n00:01.000 --> 00:02.000\nworld\n',
    fixedBy: 'keyword-ids',
    versions: { from: 700 },
  },
  {
    // Since 7.0 REGION blocks are skipped, so their definitions are gone (the cue setting stays).
    // Before 7.0 the block stopped reading altogether (above).
    trigger: /(?:^|\n)REGION[ \t]*\n/,
    difference: /^cue \d+ region: null, expected "/,
    reason: 'drops REGION blocks, so cues lose their region',
    example: 'WEBVTT\n\nREGION\nid:r\n\n00:00.000 --> 00:01.000 region:r\nhello\n',
    fixedBy: 'styles-and-regions',
    versions: { from: 700 },
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

/** Whether the ffmpeg under test shows a deviation. */
const shown = (d: Deviation): boolean =>
  ffmpegVersion >= (d.versions?.from ?? 0) && ffmpegVersion < (d.versions?.before ?? Infinity);
const ACTIVE = DEVIATIONS.filter(shown);

function roundTrip(text: string): string {
  const run = spawnSync(
    FFMPEG,
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
  diffs.every((d) => ACTIVE.some((x) => x.trigger.test(input) && x.difference.test(d)));

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

const versionName = Number.isFinite(ffmpegVersion)
  ? `${Math.floor(ffmpegVersion / 100)}.${ffmpegVersion % 100}`
  : 'development build';

describe.skipIf(!hasFfmpeg)(`ffmpeg ${versionName} (libavformat) reads our files as we do`, () => {
  it('on fixtures, feature examples and exported files', () => {
    const failures = inputs().flatMap(({ name, text }) => {
      const diffs = differences(text);
      return diffs.length === 0 || explained(text, diffs) ? [] : [`${name}: ${diffs.join('; ')}`];
    });
    expect(failures).toEqual([]);
  }, 60_000);

  it.each(ACTIVE.map((d) => [d.reason, d] as const))('documented: %s', (_reason, d) => {
    expect(d.trigger.test(d.example)).toBe(true);
    const diffs = differences(d.example);
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.every((x) => d.difference.test(x))).toBe(true);
  });

  it.each(DEVIATIONS.filter((d) => !shown(d)).map((d) => [d.reason, d] as const))(
    'not shown by this version: %s',
    (_reason, d) => {
      // Its example may still differ in another documented way (a REGION block before 7.0).
      expect(differences(d.example).filter((x) => d.difference.test(x))).toEqual([]);
    },
  );

  it.each(ACTIVE.flatMap((d) => (d.fixedBy ? [[d.fixedBy, d] as const] : [])))(
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
      const unfixed = ACTIVE.filter((d) => !d.fixedBy);
      return diffs.every((x) => unfixed.some((d) => d.trigger.test(fixed) && d.difference.test(x)))
        ? []
        : [`${name}: ${diffs.join('; ')}`];
    });
    expect(failures).toEqual([]);
  }, 60_000);
});
