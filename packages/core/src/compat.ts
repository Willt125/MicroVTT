/**
 * Export options for players that misread valid WebVTT. Each one works around deviations found by
 * comparing parsers with ours (see docs/SPEC-NOTES.md, "Player-compatibility export options"): browsers, ffmpeg, video.js's
 * vtt.js and Shaka Player. The output stays conforming; only how it is written changes, or, for
 * the options marked lossy, what it keeps.
 */
import { parseCueText } from './cuetext.ts';
import type { CueNode } from './cuetext.ts';
import type { BodyItem, Cue, HeadItem, VttDocument } from './document.ts';
import { serializeCueText } from './serialize.ts';

export type CompatibilityId =
  | 'keyword-ids'
  | 'regions-first'
  | 'character-references'
  | 'trim-whitespace'
  | 'lang-spans'
  | 'styles-and-regions';

export interface CompatibilityFix {
  id: CompatibilityId;
  label: string;
  /** The players it helps and what they do wrong. */
  why: string;
  /** Changes what a conforming player shows or keeps (not just how the file is written). */
  lossy: boolean;
  /** Whether to offer it ticked. */
  recommended: boolean;
  /** How many cues or blocks it would change. */
  count: (doc: VttDocument) => number;
  apply: (doc: VttDocument) => VttDocument;
}

const isCue = (item: BodyItem): item is Cue => item.type === 'cue';
const cuesOf = (doc: VttDocument): Cue[] => doc.body.filter(isCue);

const mapCues = (doc: VttDocument, f: (cue: Cue) => Cue): VttDocument => ({
  ...doc,
  body: doc.body.map((item) => (isCue(item) ? f(item) : item)),
});

/** Cue ids that parsers take for a NOTE, STYLE or REGION block. */
export const KEYWORD_ID = /^(?:NOTE|STYLE|REGION)/;

/** Named references Shaka Player decodes (it shows any other as written). */
const SHAKA_NAMED = new Set(['amp', 'lt', 'gt', 'quot', 'apos', 'nbsp', 'lrm', 'rlm']);
const NAMED_REFERENCE = /&([A-Za-z][A-Za-z0-9]*);/g;

function decodeNamed(text: string): string {
  return text.replace(NAMED_REFERENCE, (ref: string, name: string) => {
    if (SHAKA_NAMED.has(name)) return ref;
    const decoded = parseCueText(ref).children.map((n) => (n.type === 'text' ? n.value : ''));
    const value = decoded.join('');
    // Not a reference after all, or one standing for markup (&AMP;, &LT;, &GT;).
    if (value === ref) return ref;
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });
}
const countNamed = (text: string): number =>
  [...text.matchAll(NAMED_REFERENCE)].filter((m) => decodeNamed(m[0]) !== m[0]).length;

/** Whitespace (not line feeds) as JavaScript's trim() sees it, which is what Shaka uses. */
const isBlankLine = (line: string): boolean => line !== '' && line.trim() === '';

function trimText(text: string): string {
  const lines = text.split('\n').filter((line) => !isBlankLine(line));
  return lines.join('\n').trim();
}

function withoutLang(nodes: CueNode[]): CueNode[] {
  return nodes.flatMap((n) =>
    n.type === 'lang'
      ? withoutLang(n.children)
      : n.type === 'text' || n.type === 'timestamp'
        ? [n]
        : [{ ...n, children: withoutLang(n.children) }],
  );
}
const LANG_TAG = /<lang[\t\n\f >.]/;

export const COMPATIBILITY_FIXES: readonly CompatibilityFix[] = [
  {
    id: 'keyword-ids',
    label: 'Remove cue ids that start with NOTE, STYLE or REGION',
    why: 'Browsers may drop such an id; ffmpeg, video.js and Shaka Player may drop the whole cue.',
    lossy: false,
    recommended: true,
    count: (doc) => cuesOf(doc).filter((c) => KEYWORD_ID.test(c.id)).length,
    apply: (doc) => mapCues(doc, (c) => (KEYWORD_ID.test(c.id) ? { ...c, id: '' } : c)),
  },
  {
    id: 'regions-first',
    label: 'Write REGION blocks before comments and style sheets',
    why: 'Firefox ignores REGION blocks that do not come straight after the WEBVTT line.',
    lossy: false,
    recommended: true,
    count: (doc) => {
      const first = doc.head.findIndex((h) => h.type !== 'region');
      return first === -1 ? 0 : doc.head.slice(first).filter((h) => h.type === 'region').length;
    },
    apply: (doc) => ({
      ...doc,
      head: [
        ...doc.head.filter((h) => h.type === 'region'),
        ...doc.head.filter((h) => h.type !== 'region'),
      ],
    }),
  },
  {
    id: 'character-references',
    label: 'Write characters instead of named references such as &eacute;',
    why: 'Shaka Player shows named references other than &amp; &lt; &gt; &quot; &apos; &nbsp; &lrm; &rlm; as written.',
    lossy: false,
    recommended: true,
    count: (doc) => cuesOf(doc).filter((c) => countNamed(c.text) > 0).length,
    apply: (doc) => mapCues(doc, (c) => ({ ...c, text: decodeNamed(c.text) })),
  },
  {
    id: 'trim-whitespace',
    label: 'Remove lines of only spaces, and spaces at the start and end of cue text',
    why: 'Firefox ends a cue at a line of only spaces; Shaka Player trims them. YouTube auto-captions have one in most cues.',
    lossy: true,
    recommended: false,
    count: (doc) => cuesOf(doc).filter((c) => trimText(c.text) !== c.text).length,
    apply: (doc) => mapCues(doc, (c) => ({ ...c, text: trimText(c.text) })),
  },
  {
    id: 'lang-spans',
    label: 'Remove <lang> spans (keeping their text)',
    why: 'Shaka Player cannot read a cue with a <lang> span and shows its markup as text.',
    lossy: true,
    recommended: false,
    count: (doc) => cuesOf(doc).filter((c) => LANG_TAG.test(c.text)).length,
    apply: (doc) =>
      mapCues(doc, (c) =>
        LANG_TAG.test(c.text)
          ? { ...c, text: serializeCueText(withoutLang(parseCueText(c.text).children)) }
          : c,
      ),
  },
  {
    id: 'styles-and-regions',
    label: 'Remove STYLE and REGION blocks',
    why: 'ffmpeg (used by mpv and many media servers and converters) reads no cues after a STYLE or REGION block.',
    lossy: true,
    recommended: false,
    count: (doc) => doc.head.filter((h) => h.type === 'style' || h.type === 'region').length,
    apply: (doc) => ({
      ...mapCues(doc, (c) => (c.region === null ? c : { ...c, region: null })),
      head: doc.head.filter((h): h is HeadItem => h.type === 'note'),
    }),
  },
];

/** The fixes that would change this document, with how many cues or blocks each changes. */
export function compatibilityIssues(doc: VttDocument): { fix: CompatibilityFix; count: number }[] {
  return COMPATIBILITY_FIXES.map((fix) => ({ fix, count: fix.count(doc) })).filter(
    (x) => x.count > 0,
  );
}

/** Applies the chosen fixes, in catalogue order. */
export function applyCompatibility(doc: VttDocument, ids: readonly CompatibilityId[]): VttDocument {
  return COMPATIBILITY_FIXES.filter((f) => ids.includes(f.id)).reduce((d, f) => f.apply(d), doc);
}
