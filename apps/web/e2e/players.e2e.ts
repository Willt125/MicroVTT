/**
 * Web video players with their own WebVTT parsers, compared with ours on files we write: the
 * catalogue's feature examples, our fixtures, and exported fuzz documents. These parsers are
 * plain JavaScript, so they run once (in Chromium).
 *
 * - videojs-vtt.js: video.js's parser (a maintained fork of Mozilla's vtt.js). It creates
 *   VTTCue-shaped objects, so every attribute is compared.
 * - Shaka Player's VttTextParser. Its cues have their own shape (markup becomes nested cues,
 *   `size: 0` means the default), so both sides are mapped to the attributes they share.
 *
 * hls.js keeps its WebVTT parser internal (no public API), so it is not covered.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import type { CompatibilityId, CueNode, VttDocument } from '@microvtt/core';
import {
  COMPATIBILITY_FIXES,
  FEATURES,
  exportDocument,
  featureDocument,
  importDocument,
  parse,
  parseCueText,
} from '@microvtt/core';
import { cueList, type CueView } from '../../../packages/core/test/wpt-support.ts';
import { Gen, generateDocument, rng } from '../../../packages/core/test/fuzz/generate.ts';
import { differences } from './compare.ts';

const require = createRequire(import.meta.url);

const load = (text: string): VttDocument => {
  const r = importDocument(text);
  if (!r.ok) throw new Error('not WebVTT');
  return r.document;
};
/** The examples of deviations an export fix should avoid, exported with that fix. */
const fixedExamples = (list: Deviation[]): { reason: string; text: string }[] =>
  list.flatMap((d) =>
    d.fixedBy
      ? [
          {
            reason: d.reason,
            text: exportDocument(load(d.example), { compatibility: [d.fixedBy] }).text,
          },
        ]
      : [],
  );

interface Input {
  name: string;
  text: string;
}

function inputs(): Input[] {
  const fixtures = ['autocaption-sample.vtt', 'autocaption-translated-sample.vtt'].map((name) => ({
    name,
    text: readFileSync(
      new URL(`../../../packages/core/test/fixtures/${name}`, import.meta.url),
      'utf8',
    ),
  }));
  const features = FEATURES.map((f) => ({ name: `feature ${f.id}`, text: featureDocument(f) }));
  const g = new Gen(rng(0x4c));
  const exported = Array.from({ length: 100 }, (_, i) => {
    const doc = importDocument(generateDocument(g));
    return { name: `fuzz ${i}`, text: doc.ok ? exportDocument(doc.document).text : '' };
  }).filter((x) => x.text !== '');
  return [...fixtures, ...features, ...exported];
}

interface Deviation {
  trigger: RegExp;
  difference: RegExp;
  reason: string;
  example: string;
  /** The export compatibility fix that avoids it, if any. */
  fixedBy?: CompatibilityId;
}

const VTTJS_DEVIATIONS: Deviation[] = [
  {
    trigger: /(?:^|\n)NOTE[^\n]*\n[^\n]*-->/,
    difference: /^\d+ cues, expected \d+$/,
    reason: 'drops a cue whose id starts with "NOTE" (it reads the cue as a comment)',
    example: 'WEBVTT\n\nNOTE\n00:00.000 --> 00:01.000\nhello\n',
    fixedBy: 'keyword-ids',
  },
  {
    // vtt.js knows an older draft's regions (a "Region:" header line), not REGION blocks.
    trigger: /(?:^|\n)REGION[ \t]*\n/,
    difference: /^cue \d+ region: null, expected /,
    reason: 'ignores REGION blocks',
    example: 'WEBVTT\n\nREGION\nid:r\n\n00:00.000 --> 00:01.000 region:r\nhello\n',
  },
  {
    trigger: /\bposition:[^\s,]*,line-(?:left|right)\b/,
    difference: /^cue \d+ positionAlign: /,
    reason: 'ignores the position alignments line-left and line-right (it knows start and end)',
    example: 'WEBVTT\n\n00:00.000 --> 00:01.000 position:90%,line-right\nhello\n',
  },
];

async function vttjsParse(page: Page, texts: string[]): Promise<CueView[][]> {
  await page.goto('/');
  await page.addScriptTag({ path: require.resolve('videojs-vtt.js/dist/vtt.js') });
  return page.evaluate((all: string[]) => {
    const w = window as unknown as {
      WebVTT: {
        Parser: new (
          win: Window,
          vttjs: unknown,
          decoder: unknown,
        ) => {
          oncue: (cue: VTTCue) => void;
          onparsingerror: (e: unknown) => void;
          parse: (text: string) => void;
          flush: () => void;
        };
        StringDecoder: () => unknown;
      };
      vttjs: unknown;
    };
    return all.map((text) => {
      const cues: VTTCue[] = [];
      // As video.js calls it.
      const parser = new w.WebVTT.Parser(window, w.vttjs, w.WebVTT.StringDecoder());
      parser.oncue = (cue) => cues.push(cue);
      parser.onparsingerror = () => {};
      parser.parse(text);
      parser.flush();
      return cues.map((cue) => {
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
    });
  }, texts) as Promise<CueView[][]>;
}

/**
 * The computed position alignment (§7.2, left-to-right text): `auto` follows `align`. vtt.js
 * stores the computed value, with an older draft's names (`start`, `end`).
 */
function computedPositionAlign(c: CueView): string {
  const old: Record<string, string> = { start: 'line-left', end: 'line-right', middle: 'center' };
  if (c.positionAlign !== 'auto') return old[c.positionAlign] ?? c.positionAlign;
  if (c.align === 'left' || c.align === 'start') return 'line-left';
  if (c.align === 'right' || c.align === 'end') return 'line-right';
  return 'center';
}
/** Computed alignment, in text track cue order (vtt.js reports cues in file order). */
const comparable = (cues: CueView[]): CueView[] =>
  cues
    .map((c) => ({ ...c, positionAlign: computedPositionAlign(c) }))
    .sort((a, b) => a.startTime - b.startTime || b.endTime - a.endTime);

/** The attributes Shaka's cues share with VTTCue, in comparable form. */
interface SharedView {
  id: string;
  start: number;
  end: number;
  text: string;
  line: number | 'auto';
  snapToLines: boolean;
  lineAlign: string;
  position: number | 'auto';
  positionAlign: string;
  size: number;
  align: string;
  vertical: string;
  region: string | null;
}

const plain = (nodes: CueNode[]): string =>
  nodes
    .map((n) => (n.type === 'text' ? n.value : n.type === 'timestamp' ? '' : plain(n.children)))
    .join('');

function oursShared(text: string): SharedView[] {
  return parse(text)
    .cues.map((c) => ({
      id: c.id,
      start: c.startMs / 1000,
      end: c.endMs / 1000,
      text: plain(parseCueText(c.text).children),
      line: c.line,
      snapToLines: c.line === 'auto' ? true : c.snapToLines,
      lineAlign: c.lineAlign,
      position: c.position,
      positionAlign: c.positionAlign,
      size: c.size,
      align: c.align,
      vertical: c.vertical,
      region: c.region?.id ?? null,
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
}

async function shakaParse(page: Page, texts: string[]): Promise<SharedView[][]> {
  await page.goto('/');
  await page.addScriptTag({ path: require.resolve('shaka-player/dist/shaka-player.compiled.js') });
  return page.evaluate((all: string[]) => {
    interface ShakaCue {
      id: string;
      startTime: number;
      endTime: number;
      payload: string;
      lineBreak: boolean;
      line: number | null;
      lineInterpretation: number;
      lineAlign: string;
      position: number | null;
      positionAlign: string;
      size: number;
      textAlign: string;
      writingMode: string;
      region: { id: string } | null;
      nestedCues: ShakaCue[];
    }
    const shaka = (
      window as unknown as {
        shaka: {
          text: {
            VttTextParser: new () => {
              parseMedia: (
                data: Uint8Array,
                time: object,
                uri: string,
                images: string[],
              ) => ShakaCue[];
            };
          };
        };
      }
    ).shaka;
    const text = (c: ShakaCue): string =>
      c.lineBreak ? '\n' : c.nestedCues.length > 0 ? c.nestedCues.map(text).join('') : c.payload;
    const modes: Record<string, string> = {
      'horizontal-tb': '',
      'vertical-rl': 'rl',
      'vertical-lr': 'lr',
    };
    return all.map((t) => {
      let cues: ShakaCue[];
      try {
        cues = new shaka.text.VttTextParser().parseMedia(
          new TextEncoder().encode(t),
          { periodStart: 0, segmentStart: 0, segmentEnd: 0, vttOffset: 0 },
          'test.vtt',
          [],
        );
      } catch {
        cues = []; // Shaka throws on files it rejects.
      }
      return cues
        .map((c) => ({
          id: c.id,
          start: c.startTime,
          end: c.endTime,
          text: text(c),
          line: c.line ?? ('auto' as const),
          snapToLines: c.lineInterpretation === 0,
          lineAlign: c.lineAlign,
          position: c.position ?? ('auto' as const),
          positionAlign: c.positionAlign,
          size: c.size === 0 ? 100 : c.size,
          align: c.textAlign,
          vertical: modes[c.writingMode] ?? c.writingMode,
          region: c.region?.id || null,
        }))
        .sort((a, b) => a.start - b.start || b.end - a.end);
    });
  }, texts);
}

function sharedDifferences(theirs: SharedView[], ours: SharedView[]): string[] {
  if (theirs.length !== ours.length) return [`${theirs.length} cues, expected ${ours.length}`];
  const out: string[] = [];
  ours.forEach((o, i) => {
    const t = theirs[i] as SharedView;
    for (const key of Object.keys(o) as (keyof SharedView)[]) {
      const a = t[key];
      const b = o[key];
      const same =
        typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b;
      if (!same) out.push(`cue ${i} ${key}: ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
    }
  });
  return out;
}

const SHAKA_DEVIATIONS: Deviation[] = [
  {
    // Shaka's cue.size 0 means "auto", so a 0% size cannot be told from no size at all.
    trigger: /\bsize:0(?:\.0+)?%/,
    difference: /^cue \d+ size: 100, expected 0$/,
    reason: 'treats size:0% as the default size',
    example: 'WEBVTT\n\n00:00.000 --> 00:01.000 size:0%\nhello\n',
  },
  {
    trigger: /(?:^|\n)(?:NOTE(?:[ \t][^\n]*)?|STYLE|REGION)\n[^\n]*-->/,
    difference: /^\d+ cues, expected \d+$/,
    reason:
      'drops a cue whose id is "STYLE" or "REGION", or starts with "NOTE " (it skips the block)',
    example: 'WEBVTT\n\nSTYLE\n00:00.000 --> 00:01.000\nhello\n',
    fixedBy: 'keyword-ids',
  },
  {
    // Shaka knows an older draft's regions (a "Region:" header line), not REGION blocks.
    trigger: /(?:^|\n)REGION[ \t]*\n/,
    difference: /^cue \d+ region: null, expected /,
    reason: 'ignores REGION blocks',
    example: 'WEBVTT\n\nREGION\nid:r\n\n00:00.000 --> 00:01.000 region:r\nhello\n',
  },
  {
    // YouTube auto-captions put a " " line in most cues, which keeps their text on one row.
    trigger: /-->[^\n]*\n[^\S\n]|[^\S\n](?:\n\n|\n?$)/,
    difference: /^cue \d+ text: /,
    reason: 'trims whitespace, lines of only spaces included, from the start and end of cue text',
    example: 'WEBVTT\n\n00:00.000 --> 00:01.000\n \nhello\n',
    fixedBy: 'trim-whitespace',
  },
  {
    trigger: /<lang[ \t\f]/,
    difference: /^cue \d+ text: "[^"]*<lang /,
    reason:
      'cannot read a <lang> span, so shows the whole cue as plain text with its tags (<i> and the rest included)',
    example: 'WEBVTT\n\n00:00.000 --> 00:01.000\n<i>Kiitos</i>, <lang fi>kiitos</lang>\n',
    fixedBy: 'lang-spans',
  },
  {
    trigger: /&(?!(?:amp|lt|gt|quot|apos|nbsp|lrm|rlm);)[A-Za-z][A-Za-z0-9]*;/,
    difference: /^cue \d+ text: /,
    reason:
      'shows named character references other than &amp; &lt; &gt; &quot; &apos; &nbsp; &lrm; &rlm; as written ("caf&eacute;")',
    example: 'WEBVTT\n\n00:00.000 --> 00:01.000\ncaf&eacute;\n',
    fixedBy: 'character-references',
  },
];

/** An example shows its deviation: it triggers it and differs, only in the way described. */
const reproduces = (d: Deviation, diffs: string[]): boolean =>
  d.trigger.test(d.example) && diffs.length > 0 && diffs.every((x) => d.difference.test(x));

const explained = (list: Deviation[], text: string, diffs: string[]): boolean =>
  diffs.every((d) => list.some((x) => x.trigger.test(text) && x.difference.test(d)));

test.describe('web player parsers read our files as we do', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Plain JavaScript: run once');

  test('videojs-vtt.js (video.js)', async ({ page }) => {
    const all = inputs();
    const parsed = await vttjsParse(
      page,
      all.map((i) => i.text),
    );
    const failures = all.flatMap(({ name, text }, i) => {
      const result = parse(text);
      const diffs = differences(
        { loaded: true, cues: comparable(parsed[i] as CueView[]) },
        comparable(cueList(result)),
        true,
        [],
      );
      return diffs.length === 0 || explained(VTTJS_DEVIATIONS, text, diffs)
        ? []
        : [`${name}:\n    ${diffs.slice(0, 6).join('\n    ')}`];
    });
    expect(failures).toEqual([]);
  });

  test('Shaka Player', async ({ page }) => {
    const all = inputs();
    const parsed = await shakaParse(
      page,
      all.map((i) => i.text),
    );
    const failures = all.flatMap(({ name, text }, i) => {
      const diffs = sharedDifferences(parsed[i] as SharedView[], oursShared(text));
      return diffs.length === 0 || explained(SHAKA_DEVIATIONS, text, diffs)
        ? []
        : [`${name}:\n    ${diffs.slice(0, 6).join('\n    ')}`];
    });
    expect(failures).toEqual([]);
  });

  test('Shaka Player: documented deviations still reproduce', async ({ page }) => {
    const parsed = await shakaParse(
      page,
      SHAKA_DEVIATIONS.map((d) => d.example),
    );
    const problems = SHAKA_DEVIATIONS.flatMap((d, i) => {
      const diffs = sharedDifferences(parsed[i] as SharedView[], oursShared(d.example));
      return reproduces(d, diffs) ? [] : [`${d.reason}: ${diffs.join('; ') || 'no differences'}`];
    });
    expect(problems).toEqual([]);
  });

  test('export compatibility fixes avoid the deviations they target', async ({ page }) => {
    const vttjs = fixedExamples(VTTJS_DEVIATIONS);
    const shaka = fixedExamples(SHAKA_DEVIATIONS);
    const fromVttjs = await vttjsParse(
      page,
      vttjs.map((x) => x.text),
    );
    const fromShaka = await shakaParse(
      page,
      shaka.map((x) => x.text),
    );
    const problems = [
      ...vttjs.flatMap(({ reason, text }, i) => {
        const diffs = differences(
          { loaded: true, cues: comparable(fromVttjs[i] as CueView[]) },
          comparable(cueList(parse(text))),
          true,
          [],
        );
        return diffs.length === 0 ? [] : [`vtt.js, ${reason}: ${diffs.join('; ')}`];
      }),
      ...shaka.flatMap(({ reason, text }, i) => {
        const diffs = sharedDifferences(fromShaka[i] as SharedView[], oursShared(text));
        return diffs.length === 0 ? [] : [`Shaka, ${reason}: ${diffs.join('; ')}`];
      }),
    ];
    expect(problems).toEqual([]);
  });

  test('Shaka Player reads exported files exactly when every compatibility fix is on', async ({
    page,
  }) => {
    const all = COMPATIBILITY_FIXES.map((f) => f.id);
    const texts = inputs().map(({ name, text }) => ({
      name,
      text: exportDocument(load(text), { compatibility: all }).text,
    }));
    const parsed = await shakaParse(
      page,
      texts.map((x) => x.text),
    );
    const failures = texts.flatMap(({ name, text }, i) => {
      const diffs = sharedDifferences(parsed[i] as SharedView[], oursShared(text));
      return diffs.length === 0 ? [] : [`${name}: ${diffs.slice(0, 6).join('; ')}`];
    });
    expect(failures).toEqual([]);
  });

  test('videojs-vtt.js: documented deviations still reproduce', async ({ page }) => {
    const parsed = await vttjsParse(
      page,
      VTTJS_DEVIATIONS.map((d) => d.example),
    );
    const problems = VTTJS_DEVIATIONS.flatMap((d, i) => {
      const diffs = differences(
        { loaded: true, cues: comparable(parsed[i] as CueView[]) },
        comparable(cueList(parse(d.example))),
        true,
        [],
      );
      return reproduces(d, diffs) ? [] : [`${d.reason}: ${diffs.join('; ') || 'no differences'}`];
    });
    expect(problems).toEqual([]);
  });
});
