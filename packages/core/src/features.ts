/**
 * A catalogue of WebVTT features, used three ways:
 *
 * - to report which features a document uses (the YouTube upload check lists those a platform
 *   may drop);
 * - to build a test file whose cues each exercise one feature and say what a viewer should see,
 *   for checking a player or platform by eye;
 * - as minimal inputs for comparing other players' parsers with ours.
 */
import type { CompatibilityId } from './compat.ts';
import { COMPATIBILITY_FIXES } from './compat.ts';
import type { CueNode, CueSpanType } from './cuetext.ts';
import { parseCueText } from './cuetext.ts';
import type { Cue, VttDocument } from './document.ts';
import { formatTimestamp } from './timestamp.ts';

export type FeatureId =
  | 'italic-bold-underline'
  | 'class'
  | 'voice'
  | 'language'
  | 'ruby'
  | 'timestamps'
  | 'character-references'
  | 'multiple-lines'
  | 'cue-id'
  | 'line'
  | 'line-percent'
  | 'position'
  | 'size'
  | 'align'
  | 'alignment-suffix'
  | 'vertical'
  | 'region'
  | 'style'
  | 'note'
  | 'overlap'
  | 'whitespace-line';

/** One feature's example: blocks it needs in the head, and its cue at `start` (4 s long). */
export interface FeatureExample {
  head?: string;
  /** Cue blocks (timing lines included), given a function that formats a time offset. */
  cues: (at: (offsetMs: number) => string) => string;
}

export interface Feature {
  id: FeatureId;
  name: string;
  /** Number of cues (or blocks) in the document that use it. */
  count: (doc: VttDocument) => number;
  example: FeatureExample;
}

const cuesOf = (doc: VttDocument): Cue[] =>
  doc.body.filter((item): item is Cue => item.type === 'cue');

/** Which span types (and timestamps) a cue uses; `c` only counts when it has classes. */
function cueSpans(cue: Cue): Set<CueSpanType | 'timestamp'> {
  const found = new Set<CueSpanType | 'timestamp'>();
  const walk = (nodes: CueNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'timestamp') found.add('timestamp');
      else if (node.type !== 'text') {
        if (node.type !== 'c' || node.classes.length > 0) found.add(node.type);
        walk(node.children);
      }
    }
  };
  walk(parseCueText(cue.text).children);
  return found;
}

const countCues = (doc: VttDocument, test: (cue: Cue) => boolean): number =>
  cuesOf(doc).filter(test).length;

const usesSpan =
  (...types: (CueSpanType | 'timestamp')[]) =>
  (doc: VttDocument): number =>
    countCues(doc, (cue) => {
      const found = cueSpans(cue);
      return types.some((t) => found.has(t));
    });

/** One cue from `start` to `start + 4 s`, with optional settings. */
const cue =
  (text: string, settings = '', id = '') =>
  (at: (offsetMs: number) => string): string =>
    `${id ? `${id}\n` : ''}${at(0)} --> ${at(4000)}${settings ? ` ${settings}` : ''}\n${text}`;

export const FEATURES: readonly Feature[] = [
  {
    id: 'italic-bold-underline',
    name: 'Italic, bold and underline (<i>, <b>, <u>)',
    count: usesSpan('i', 'b', 'u'),
    example: { cues: cue('This is <i>italic</i>, <b>bold</b> and <u>underlined</u>.') },
  },
  {
    id: 'class',
    name: 'Class spans (<c.yellow>), styled by CSS',
    count: usesSpan('c'),
    example: {
      cues: cue('These words are <c.yellow>yellow</c> (a class, coloured only by a player style).'),
    },
  },
  {
    id: 'voice',
    name: 'Voice spans (<v Name>)',
    count: usesSpan('v'),
    example: { cues: cue('<v Alice>Alice speaks this line (a voice span named Alice).') },
  },
  {
    id: 'language',
    name: 'Language spans (<lang fi>)',
    count: usesSpan('lang'),
    example: { cues: cue('In Finnish, <lang fi>kiitos</lang> means thank you.') },
  },
  {
    id: 'ruby',
    name: 'Ruby annotations (<ruby>, <rt>)',
    count: usesSpan('ruby'),
    example: {
      cues: cue('Small text should sit above: <ruby>漢字<rt>kanji</rt></ruby>.'),
    },
  },
  {
    id: 'timestamps',
    name: 'Word timings (karaoke timestamps)',
    count: usesSpan('timestamp'),
    example: {
      cues: (at) =>
        `${at(0)} --> ${at(4000)}\nWords <${at(1000)}>appear <${at(2000)}>one <${at(3000)}>by one.`,
    },
  },
  {
    id: 'character-references',
    name: 'Character references other than &amp; &lt; &gt;',
    count: (doc) =>
      countCues(doc, (c) =>
        /&(?!(?:amp|lt|gt);)(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z0-9]+);/.test(c.text),
      ),
    example: {
      cues: cue(
        'Fish &amp; chips, 5 &lt; 6, caf&eacute;, &copy; 2026, and a&nbsp;non-breaking space.',
      ),
    },
  },
  {
    id: 'multiple-lines',
    name: 'More than two lines in a cue',
    count: (doc) => countCues(doc, (c) => c.text.split('\n').length > 2),
    example: { cues: cue('This cue\nhas exactly\nthree lines.') },
  },
  {
    id: 'cue-id',
    name: 'Cue identifiers',
    count: (doc) => countCues(doc, (c) => c.id !== ''),
    example: { cues: cue('This cue has the id "intro" (ids are never shown).', '', 'intro') },
  },
  {
    id: 'line',
    name: 'Line position by line number (line:0)',
    count: (doc) => countCues(doc, (c) => c.line !== 'auto' && c.snapToLines),
    example: { cues: cue('I should be at the TOP of the video (line:0).', 'line:0') },
  },
  {
    id: 'line-percent',
    name: 'Line position by percentage (line:50%)',
    count: (doc) => countCues(doc, (c) => c.line !== 'auto' && !c.snapToLines),
    example: { cues: cue('I should be in the MIDDLE, top to bottom (line:50%).', 'line:50%') },
  },
  {
    id: 'position',
    name: 'Horizontal position (position:10%)',
    count: (doc) => countCues(doc, (c) => c.position !== 'auto'),
    example: {
      cues: cue('I should start near the LEFT edge (position:10%).', 'position:10% align:start'),
    },
  },
  {
    id: 'size',
    name: 'Cue box width (size:40%)',
    count: (doc) => countCues(doc, (c) => c.size !== 100),
    example: {
      cues: cue('I should wrap within a narrow box, 40% of the video wide (size:40%).', 'size:40%'),
    },
  },
  {
    id: 'align',
    name: 'Text alignment other than centre (align:start, end, left, right)',
    count: (doc) => countCues(doc, (c) => c.align !== 'center'),
    example: { cues: cue('My lines should be\nRIGHT-aligned (align:end).', 'align:end') },
  },
  {
    id: 'alignment-suffix',
    name: 'Line or position alignment (line:0,end; position:90%,line-right)',
    count: (doc) => countCues(doc, (c) => c.lineAlign !== 'start' || c.positionAlign !== 'auto'),
    example: {
      cues: cue(
        'My box should END at 90% across, at the top (position:90%,line-right).',
        'line:0 position:90%,line-right size:40%',
      ),
    },
  },
  {
    id: 'vertical',
    name: 'Vertical text (vertical:rl)',
    count: (doc) => countCues(doc, (c) => c.vertical !== ''),
    example: { cues: cue('縦書き (vertical text, right side)', 'vertical:rl') },
  },
  {
    id: 'region',
    name: 'Regions (REGION blocks, region:)',
    count: (doc) =>
      doc.head.filter((h) => h.type === 'region').length + countCues(doc, (c) => c.region !== null),
    example: {
      head: 'REGION\nid:test width:50% lines:3 regionanchor:0%,100% viewportanchor:5%,95% scroll:up',
      cues: cue('I should be in a box at the LOWER LEFT (a region).', 'region:test'),
    },
  },
  {
    id: 'style',
    name: 'Style sheets (STYLE blocks)',
    count: (doc) => doc.head.filter((h) => h.type === 'style').length,
    example: {
      head: 'STYLE\n::cue(.styled) { color: lime; }',
      cues: cue('These words are <c.styled>green</c> (a STYLE block in the file).'),
    },
  },
  {
    id: 'note',
    name: 'Comments (NOTE blocks)',
    count: (doc) =>
      doc.head.filter((h) => h.type === 'note').length +
      doc.body.filter((b) => b.type === 'note').length,
    example: {
      cues: (at) =>
        `NOTE This comment must never be shown.\n\n${cue('A comment came just before me.')(at)}`,
    },
  },
  {
    id: 'overlap',
    name: 'Overlapping cues (shown at the same time)',
    count: (doc) => {
      const cues = cuesOf(doc);
      let n = 0;
      let end = -1;
      for (const c of cues) {
        if (c.startMs < end) n++;
        end = Math.max(end, c.endMs);
      }
      return n;
    },
    example: {
      cues: (at) =>
        `${at(0)} --> ${at(4000)} line:0\nI am on screen together with the cue below…\n\n${at(1000)} --> ${at(4000)}\n…and I appear one second later.`,
    },
  },
  {
    id: 'whitespace-line',
    name: 'Lines of only spaces in cue text',
    count: (doc) =>
      countCues(doc, (c) => c.text.split('\n').some((l) => l !== '' && l.trim() === '')),
    example: { cues: cue('Above an empty-looking line…\n \n…and below it, in the same cue.') },
  },
];

/** How a platform treats a feature: shown as written, shown differently, or dropped. */
export type PlatformStatus = 'kept' | 'changed' | 'dropped' | 'untested';

export interface PlatformSupport {
  status: PlatformStatus;
  note?: string;
  /** The platform reports an error for it on upload (even if what viewers see is right). */
  uploadError?: boolean;
  /** The export compatibility fix that avoids the problem there. */
  fixedBy?: CompatibilityId;
}

const kept: PlatformSupport = { status: 'kept' };

/**
 * What YouTube does with each feature when a WebVTT file is uploaded as captions, found by
 * uploading `featureTestFile()` and watching on the web player (docs/YOUTUBE-TEST.md records the
 * results and how to repeat it).
 */
export const YOUTUBE: Readonly<Record<FeatureId, PlatformSupport>> = {
  'italic-bold-underline': kept,
  class: kept,
  voice: kept,
  language: kept,
  ruby: {
    status: 'changed',
    note: 'the annotation is shown in brackets after its base text, as 漢字(kanji)',
  },
  timestamps: kept,
  'character-references': kept,
  'multiple-lines': kept,
  'cue-id': kept,
  line: kept,
  'line-percent': kept,
  position: kept,
  size: { status: 'dropped', note: 'the text is not wrapped to the narrower box' },
  align: kept,
  'alignment-suffix': {
    status: 'kept',
    note: 'placed as written, but YouTube Studio reports an error on the timing line',
    uploadError: true,
  },
  vertical: { status: 'dropped', note: 'shown horizontally, in the default place' },
  region: {
    status: 'dropped',
    note: 'YouTube Studio reports an error at the REGION block and at each region setting; the cues show in the default place',
    uploadError: true,
    fixedBy: 'styles-and-regions',
  },
  style: {
    status: 'dropped',
    note: 'the style sheet is ignored',
    fixedBy: 'styles-and-regions',
  },
  note: kept,
  overlap: kept,
  'whitespace-line': {
    status: 'dropped',
    note: 'the caption ends at that line and the text after it is lost (YouTube Studio reports an error there)',
    uploadError: true,
    fixedBy: 'trim-whitespace',
  },
};

/** Export compatibility fixes for YouTube: the recommended ones plus those that avoid its problems. */
export const YOUTUBE_FIXES: readonly CompatibilityId[] = COMPATIBILITY_FIXES.filter(
  (f) => f.recommended || Object.values(YOUTUBE).some((s) => s.fixedBy === f.id),
).map((f) => f.id);

/**
 * The upload check: features a document uses that YouTube does not show as written, or reports
 * as an error on upload. Warnings only; the file is valid either way.
 */
export function youtubeCheck(
  doc: VttDocument,
): { feature: Feature; count: number; support: PlatformSupport }[] {
  return usedFeatures(doc)
    .map((u) => ({ ...u, support: YOUTUBE[u.feature.id] }))
    .filter((u) => u.support.status !== 'kept' || u.support.uploadError === true);
}

/** Features a document uses, with how many cues or blocks use each. */
export function usedFeatures(doc: VttDocument): { feature: Feature; count: number }[] {
  return FEATURES.map((feature) => ({ feature, count: feature.count(doc) })).filter(
    (u) => u.count > 0,
  );
}

/** A minimal WebVTT file showing one feature. */
export function featureDocument(feature: Feature): string {
  const at = (offset: number): string => formatTimestamp(offset);
  return `WEBVTT\n\n${feature.example.head ? `${feature.example.head}\n\n` : ''}${feature.example.cues(at)}\n`;
}

/**
 * A test file showing every feature in turn (or every one not in `omit`), `spacingMs` apart, after
 * an introduction. Each cue says what a viewer should see, so a platform or player can be checked
 * by eye. A feature keeps its number and time when others are left out.
 */
export function featureTestFile(spacingMs = 6000, omit: readonly FeatureId[] = []): string {
  const features = FEATURES.filter((f) => !omit.includes(f.id));
  const heads = features.flatMap((f) => (f.example.head ? [f.example.head] : []));
  const blocks = [
    `${formatTimestamp(0)} --> ${formatTimestamp(spacingMs - 1000)}\nMicroVTT feature test: each caption says what you should see.`,
  ];
  // Numbered and timed by catalogue position, so files that leave features out line up.
  FEATURES.forEach((f, i) => {
    if (omit.includes(f.id)) return;
    const start = (i + 1) * spacingMs;
    const at = (offset: number): string => formatTimestamp(start + offset);
    blocks.push(`NOTE ${i + 1}. ${f.name}`, f.example.cues(at));
  });
  return `WEBVTT\n\n${heads.map((h) => `${h}\n\n`).join('')}${blocks.join('\n\n')}\n`;
}
