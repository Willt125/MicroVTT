/**
 * Property tests for the export guarantee (docs/PLAN.md, Phase 2):
 *
 * - any input exports with zero errors (adversarial documents, random garbage, API-built models
 *   with out-of-range values);
 * - export is idempotent: exporting an export changes nothing and reports nothing;
 * - parse(serialize(doc)) equals doc for every repaired document;
 * - cue text repair never changes the text a viewer reads.
 */
import { describe, expect, it } from 'vitest';
import type { CueNode, VttDocument } from '../../src/index.ts';
import {
  checkCueText,
  createCue,
  createDocument,
  createRegion,
  exportDocument,
  importDocument,
  parseCueText,
  repair,
  repairCueText,
  serialize,
} from '../../src/index.ts';
import { Gen, generateDocument, rng } from './generate.ts';

const CASES = Number(process.env['FUZZ_CASES'] ?? 2000);
const SEED = Number(process.env['FUZZ_SEED'] ?? 20261006);
const TIMEOUT = 30_000 + CASES * 5;

const errorsOf = (doc: VttDocument): string[] =>
  exportDocument(doc)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.code}: ${d.message}`);

/** Random text over the characters that matter to WebVTT syntax. */
function garbage(g: Gen, length: number): string {
  const alphabet = [
    'a',
    'b',
    'i',
    'v',
    'c',
    'u',
    'rt',
    'ruby',
    'lang',
    ' ',
    ' ',
    '\t',
    '\n',
    '\n',
    '\r',
    '\u0000',
    '<',
    '<',
    '>',
    '/',
    '.',
    '&',
    '&amp;',
    '&lt',
    '#',
    ';',
    ':',
    '-',
    '-->',
    '%',
    ',',
    '0',
    '1',
    '5',
    '9',
    '00:00.500',
    '00:00:01.000',
    'NOTE',
    'STYLE',
    'REGION',
    'id:',
    'region:',
    'line:',
    'é',
    '😀',
    '\ufeff',
  ];
  let s = '';
  for (let i = 0; i < length; i++) s += g.pick(alphabet);
  return s;
}

/** A document built through the model with hostile values. */
export function hostileDocument(g: Gen): VttDocument {
  const doc = createDocument();
  const anyNumber = (): number =>
    g.pick([NaN, Infinity, -Infinity, -1, 0, 0.5, 1.5, 50, 100, 150, 1e300, -0, 2 ** 60]);
  const anyString = (): string => garbage(g, g.int(0, 6));
  doc.title = anyString();
  for (let i = g.int(0, 3); i > 0; i--) {
    const kind = g.pick(['note', 'style', 'region'] as const);
    if (kind === 'note') doc.head.push({ type: 'note', text: anyString() });
    else if (kind === 'style')
      doc.head.push({
        type: 'style',
        css: g.pick(['::cue { color: red', '}{', anyString(), '::cue {}\n\n::cue(b) { x: y }']),
      });
    else {
      const r = createRegion(g.pick(['r', 'r', '', 'a b', 'x-->y', anyString()]));
      r.width = anyNumber();
      r.lines = anyNumber();
      r.regionAnchorX = anyNumber();
      r.viewportAnchorY = anyNumber();
      r.scroll = g.pick(['', 'up', 'down']) as '' | 'up';
      doc.head.push(r);
    }
  }
  for (let i = g.int(0, 5); i > 0; i--) {
    if (g.chance(0.2)) {
      doc.body.push({ type: 'note', text: anyString() });
      continue;
    }
    const cue = createCue(
      g.pick([anyNumber(), g.int(0, 5000)]),
      g.pick([anyNumber(), g.int(0, 5000)]),
      garbage(g, g.int(0, 12)),
    );
    cue.id = g.pick(['', '', 'a', 'a', anyString()]);
    cue.region = g.pick([null, 'r', 'x-->y', 'missing']);
    cue.vertical = g.pick(['', 'rl', 'lr', 'xx']) as '';
    cue.snapToLines = g.chance(0.5);
    cue.line = g.pick(['auto', anyNumber()]) as number | 'auto';
    cue.lineAlign = g.pick(['start', 'center', 'end', 'bogus']) as 'start';
    cue.position = g.pick(['auto', anyNumber()]) as number | 'auto';
    cue.positionAlign = g.pick(['auto', 'line-left', 'center', 'line-right', 'bogus']) as 'auto';
    cue.size = anyNumber();
    cue.align = g.pick(['start', 'center', 'end', 'left', 'right', 'bogus']) as 'start';
    doc.body.push(cue);
  }
  return doc;
}

/** Strips fields that serialization does not carry (source ranges, provenance). */
export function comparable(doc: VttDocument): unknown {
  const strip = <T extends object>(item: T): T => {
    const {
      source: _s,
      preserved: _p,
      ...rest
    } = item as T & { source?: unknown; preserved?: unknown };
    return rest as T;
  };
  return { title: doc.title, head: doc.head.map(strip), body: doc.body.map(strip) };
}

/** All text a viewer reads, in order (including ruby text). */
function readableText(nodes: CueNode[]): string {
  return nodes
    .map((n) =>
      n.type === 'text' ? n.value : n.type === 'timestamp' ? '' : readableText(n.children),
    )
    .join('');
}

describe('export guarantee', () => {
  it(
    `exports ${CASES} generated documents with zero errors, idempotently`,
    () => {
      const g = new Gen(rng(SEED));
      for (let i = 0; i < CASES; i++) {
        const text = generateDocument(g);
        const first = exportDocument(importDocument(text).document);
        expect(
          first.diagnostics.filter((d) => d.severity === 'error'),
          JSON.stringify(text),
        ).toEqual([]);
        const second = exportDocument(importDocument(first.text).document);
        expect(second.text, JSON.stringify(text)).toBe(first.text);
        expect(second.report, JSON.stringify(text)).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    `exports ${CASES} random garbage inputs with zero errors`,
    () => {
      const g = new Gen(rng(SEED + 1));
      for (let i = 0; i < CASES; i++) {
        const text = `WEBVTT\n\n${garbage(g, g.int(0, 60))}`;
        expect(errorsOf(importDocument(text).document), JSON.stringify(text)).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    `exports ${CASES} hostile API-built documents with zero errors`,
    () => {
      const g = new Gen(rng(SEED + 2));
      for (let i = 0; i < CASES; i++) {
        const doc = hostileDocument(g);
        expect(errorsOf(doc), JSON.stringify(doc)).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'round-trips every repaired document through serialize and parse',
    () => {
      const g = new Gen(rng(SEED + 3));
      for (let i = 0; i < CASES; i++) {
        const source = g.chance(0.5)
          ? importDocument(generateDocument(g)).document
          : hostileDocument(g);
        const repaired = repair(source).document;
        const reparsed = importDocument(serialize(repaired)).document;
        expect(comparable(reparsed)).toEqual(comparable(repaired));
      }
    },
    TIMEOUT,
  );
});

describe('cue text repair', () => {
  it(
    `keeps the readable text of ${CASES} random cue texts and makes them valid`,
    () => {
      const g = new Gen(rng(SEED + 4));
      for (let i = 0; i < CASES; i++) {
        // Cue text never contains blank lines or arrows (the block structure prevents it).
        const text = garbage(g, g.int(0, 30))
          // eslint-disable-next-line no-control-regex
          .replace(/\r|\u0000/g, '')
          .replace(/-->/g, '')
          .replace(/\n{2,}/g, '\n')
          .replace(/^\n+|\n+$/g, '');
        const fixed = repairCueText(text, 0, 2000);
        expect(checkCueText(fixed, 0, 0, 2000), JSON.stringify(text)).toEqual([]);
        // Line breaks left empty by removed markup are dropped (they would split the cue).
        const lines = (s: string): string => s.replace(/\n+/g, '\n').replace(/^\n|\n$/g, '');
        expect(lines(readableText(parseCueText(fixed).children)), JSON.stringify(text)).toBe(
          lines(readableText(parseCueText(text).children)),
        );
      }
    },
    TIMEOUT,
  );
});
