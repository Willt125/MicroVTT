/**
 * Our parser against the browser's own: every input is loaded into a real `<track>`, and the
 * browser's `VTTCue`/`VTTRegion` objects are compared with what @microvtt/core produces for the
 * same bytes (exposed the same way the WPT harness exposes them).
 *
 * Inputs: the WPT file-parsing tests, our committed fixtures, seeded fuzz documents, and those
 * fuzz documents after export (so the model → exported file → browser path is covered too).
 *
 * Where the browser and we disagree on a WPT input, the WPT test's own assertions are run on the
 * browser's cues: if they fail, the browser is the one deviating from the spec, and the
 * difference is reported as an annotation rather than a failure. Any other difference fails,
 * unless it is listed in `native-deviations.ts` with the reason.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { exportDocument, importDocument, parseBytes } from '@microvtt/core';
import {
  cueList,
  listFiles,
  readFileParsingTest,
  readWptBytes,
  runAssertions,
  type CueView,
} from '../../../packages/core/test/wpt-support.ts';
import { Gen, generateDocument, rng } from '../../../packages/core/test/fuzz/generate.ts';
import { DEVIATIONS, knownDeviation, type BrowserName } from './native-deviations.ts';

interface Input {
  name: string;
  bytes: Uint8Array;
  /** WPT assertions, for telling browser bugs from ours. */
  js?: string;
}

interface NativeResult {
  /** True when the track loaded (false when the browser rejected the file). */
  loaded: boolean;
  cues: CueView[];
}

/** `VTTCue` attributes this browser doesn't implement: not compared, but reported. */
async function unsupportedAttributes(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    ['region', 'lineAlign', 'positionAlign'].filter((name) => !(name in VTTCue.prototype)),
  );
}

const FIXTURES = new URL('../../../packages/core/test/fixtures/', import.meta.url);
const FUZZ_SEED = 0x3c;
const FUZZ_COUNT = 150;

function wptInputs(): Input[] {
  return [
    ...listFiles('file-parsing', '.test').map((file) => {
      const t = readFileParsingTest(`file-parsing/${file}`);
      return { name: `wpt/${file}`, bytes: t.vtt, js: t.js };
    }),
    ...listFiles('file-parsing', '.vtt').map((file) => ({
      name: `wpt/${file}`,
      bytes: readWptBytes(`file-parsing/${file}`),
    })),
  ];
}

function fixtureInputs(): Input[] {
  return ['autocaption-sample.vtt', 'autocaption-translated-sample.vtt'].map((name) => ({
    name: `fixtures/${name}`,
    bytes: readFileSync(new URL(name, FIXTURES)),
  }));
}

function fuzzInputs(): { generated: Input[]; exported: Input[] } {
  const g = new Gen(rng(FUZZ_SEED));
  const encoder = new TextEncoder();
  const generated: Input[] = [];
  const exported: Input[] = [];
  for (let i = 0; i < FUZZ_COUNT; i++) {
    const text = generateDocument(g);
    generated.push({ name: `fuzz/${i}`, bytes: encoder.encode(text) });
    const imported = importDocument(text);
    if (imported.ok)
      exported.push({
        name: `fuzz/${i}/exported`,
        bytes: encoder.encode(exportDocument(imported.document).text),
      });
  }
  return { generated, exported };
}

/** Loads each input into a `<track>` and reads back the browser's cues. */
async function nativeParse(page: Page, inputs: Input[]): Promise<NativeResult[]> {
  return page.evaluate(
    async (files: number[][]) => {
      const video = document.createElement('video');
      document.body.append(video);
      const results: { loaded: boolean; cues: unknown[] }[] = [];
      for (const bytes of files) {
        const track = document.createElement('track');
        track.kind = 'metadata';
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'text/vtt' }));
        track.src = url;
        video.append(track);
        const done = new Promise<boolean>((resolve) => {
          track.addEventListener('load', () => resolve(true), { once: true });
          track.addEventListener('error', () => resolve(false), { once: true });
        });
        track.track.mode = 'hidden';
        const loaded = await done;
        const cues = [...(track.track.cues ?? [])].map((c) => {
          const cue = c as VTTCue;
          const r = (cue as { region?: VTTRegion | null }).region ?? null;
          return {
            id: cue.id,
            startTime: cue.startTime,
            endTime: cue.endTime,
            pauseOnExit: cue.pauseOnExit,
            region: r && {
              id: r.id,
              width: r.width,
              lines: r.lines,
              regionAnchorX: r.regionAnchorX,
              regionAnchorY: r.regionAnchorY,
              viewportAnchorX: r.viewportAnchorX,
              viewportAnchorY: r.viewportAnchorY,
              scroll: r.scroll,
            },
            vertical: cue.vertical,
            snapToLines: cue.snapToLines,
            line: cue.line,
            lineAlign: cue.lineAlign,
            position: cue.position,
            positionAlign: cue.positionAlign,
            size: cue.size,
            align: cue.align,
            text: cue.text,
          };
        });
        results.push({ loaded, cues });
        track.remove();
        URL.revokeObjectURL(url);
      }
      video.remove();
      return results;
    },
    inputs.map((i) => [...i.bytes]),
  ) as Promise<NativeResult[]>;
}

/** Numbers parsed from text may differ in the last bit depending on evaluation order. */
const close = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number'
    ? a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a))
    : a === b;

/** Human-readable differences between the browser's cues and ours. */
function differences(
  native: NativeResult,
  ours: CueView[],
  expectLoaded: boolean,
  skip: readonly string[],
): string[] {
  const out: string[] = [];
  if (native.loaded !== expectLoaded)
    out.push(`track ${native.loaded ? 'loaded' : 'failed to load'}, expected the opposite`);
  if (native.cues.length !== ours.length) {
    out.push(`${native.cues.length} cues, expected ${ours.length}`);
    return out;
  }
  native.cues.forEach((n, i) => {
    const o = ours[i] as CueView;
    for (const key of Object.keys(o) as (keyof CueView)[]) {
      if (skip.includes(key)) continue;
      if (key === 'region') {
        const nr = n.region;
        const or = o.region;
        if (!nr || !or) {
          if (nr !== or)
            out.push(`cue ${i} region: ${nr?.id ?? 'null'}, expected ${or?.id ?? 'null'}`);
          continue;
        }
        for (const rk of Object.keys(or) as (keyof typeof or)[])
          if (!close(nr[rk], or[rk]))
            out.push(
              `cue ${i} region.${rk}: ${JSON.stringify(nr[rk])}, expected ${JSON.stringify(or[rk])}`,
            );
      } else if (!close(n[key], o[key])) {
        out.push(`cue ${i} ${key}: ${JSON.stringify(n[key])}, expected ${JSON.stringify(o[key])}`);
      }
    }
  });
  return out;
}

/**
 * Shrinks an input to a small one that still shows an unexplained difference: whole blocks
 * first, then single lines. The result is a reproduction to read, not necessarily the same
 * construct (removing a blank line can turn a block into header lines, for example).
 */
async function minimize(
  page: Page,
  browser: string,
  text: string,
  skip: readonly string[],
): Promise<{ text: string; diffs: string[] }> {
  const encoder = new TextEncoder();
  const check = async (candidate: string): Promise<string[] | null> => {
    const bytes = encoder.encode(candidate);
    const [native] = await nativeParse(page, [{ name: '', bytes }]);
    const result = parseBytes(bytes);
    const diffs = differences(native as NativeResult, cueList(result), result.ok, skip);
    return diffs.length > 0 && !knownDeviation(browser, candidate, diffs) ? diffs : null;
  };
  let best = { text, diffs: (await check(text)) ?? [] };
  for (const pieces of [/(?<=\r\n\r\n|\n\n|\r\r)/, /(?<=\r\n|\n|\r)/]) {
    let parts = best.text.split(pieces);
    for (let i = 1; i < parts.length; i++) {
      const trial = [...parts.slice(0, i), ...parts.slice(i + 1)];
      const diffs = await check(trial.join(''));
      if (diffs) {
        parts = trial;
        best = { text: trial.join(''), diffs };
        i--;
      }
    }
  }
  return best;
}

/** At most this many unexplained inputs are minimized (each takes a few hundred page calls). */
const MINIMIZE_LIMIT = 20;

function browserFailsWpt(input: Input, native: NativeResult): string | null {
  if (input.js === undefined) return null;
  try {
    runAssertions(input.js, native.cues);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

async function compare(page: Page, browser: string, inputs: Input[]): Promise<void> {
  await page.goto('/');
  const skip = await unsupportedAttributes(page);
  if (skip.length > 0)
    test.info().annotations.push({
      type: 'not compared',
      description: `${browser} has no VTTCue ${skip.join(', ')}`,
    });
  const natives = await nativeParse(page, inputs);
  const failures: string[] = [];
  /** Reason → inputs it explains. */
  const deviations: Record<string, string[]> = {};
  const note = (reason: string, name: string): void => {
    (deviations[reason] ??= []).push(name);
  };
  const decoder = new TextDecoder();
  let minimized = 0;
  // Files we export matter most, so their differences are minimized first.
  const order = [...inputs.keys()].sort(
    (a, b) =>
      Number(!inputs[a]?.name.endsWith('/exported')) -
      Number(!inputs[b]?.name.endsWith('/exported')),
  );
  for (const i of order) {
    const input = inputs[i] as Input;
    const result = parseBytes(input.bytes);
    const diffs = differences(natives[i] as NativeResult, cueList(result), result.ok, skip);
    if (diffs.length === 0) continue;
    const text = decoder.decode(input.bytes);
    const wpt = browserFailsWpt(input, natives[i] as NativeResult);
    const known = knownDeviation(browser, text, diffs);
    if (wpt) note(`fails the WPT test: ${wpt}`, input.name);
    else if (known) note(known, input.name);
    else {
      let report = `${input.name}:\n    ${diffs.slice(0, 8).join('\n    ')}`;
      if (minimized++ < MINIMIZE_LIMIT) {
        const min = await minimize(page, browser, text, skip);
        report += `\n  minimal: ${JSON.stringify(min.text)}\n    ${min.diffs.slice(0, 4).join('\n    ')}`;
      }
      failures.push(report);
    }
  }
  for (const [reason, names] of Object.entries(deviations))
    test.info().annotations.push({
      type: 'browser deviation',
      description: `${reason} (${names.length}: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''})`,
    });
  expect(failures, `differences from ${browser}'s parser`).toEqual([]);
}

test.describe('native parser agrees with ours', () => {
  // Minimizing unexplained differences can take a while; passing runs take seconds.
  test.setTimeout(300_000);

  test('WPT file-parsing inputs', async ({ page, browserName }) => {
    await compare(page, browserName, wptInputs());
  });

  test('committed fixtures', async ({ page, browserName }) => {
    await compare(page, browserName, fixtureInputs());
  });

  test('documented deviations still reproduce', async ({ page, browserName }) => {
    const entries = DEVIATIONS.filter((d) => d.browsers.includes(browserName as BrowserName));
    test.skip(entries.length === 0, `no documented deviations for ${browserName}`);
    await page.goto('/');
    const skip = await unsupportedAttributes(page);
    const encoder = new TextEncoder();
    const inputs = entries.map((d, i) => ({
      name: `example ${i}`,
      bytes: encoder.encode(d.example),
    }));
    const natives = await nativeParse(page, inputs);
    const problems: string[] = [];
    entries.forEach((d, i) => {
      const result = parseBytes(inputs[i]?.bytes as Uint8Array);
      const diffs = differences(natives[i] as NativeResult, cueList(result), result.ok, skip);
      if (!d.trigger.test(d.example))
        problems.push(`${d.reason}: the example does not match the trigger`);
      else if (!diffs.some((diff) => d.difference.test(diff)))
        problems.push(
          `${d.reason}: no longer reproduces (${diffs.join('; ') || 'no differences'})`,
        );
      else if (!knownDeviation(browserName, d.example, diffs))
        problems.push(`${d.reason}: the example shows other differences too: ${diffs.join('; ')}`);
    });
    expect(problems).toEqual([]);
  });

  test('fuzz documents, as generated and after export', async ({ page, browserName }) => {
    const { generated, exported } = fuzzInputs();
    await compare(page, browserName, [...generated, ...exported]);
  });
});
