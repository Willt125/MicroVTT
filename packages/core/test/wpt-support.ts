/**
 * Helpers that reproduce how web-platform-tests builds and runs its WebVTT tests, so the vendored
 * sources in tests/wpt can be executed against @microvtt/core in Node.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CueNode, ParseResult, ParsedCue, ParsedRegion } from '../src/index.ts';
import { formatTimestamp, parseCueText, sortCues } from '../src/index.ts';

export const WPT_DIR = fileURLToPath(new URL('../../../tests/wpt/', import.meta.url));

export const listFiles = (dir: string, ext: string): string[] =>
  readdirSync(WPT_DIR + dir)
    .filter((name) => name.endsWith(ext))
    .sort();

export const readWpt = (path: string): string => readFileSync(WPT_DIR + path, 'utf8');
export const readWptBytes = (path: string): Uint8Array => readFileSync(WPT_DIR + path);

/**
 * Python's `bytes(s, 'utf-8').decode('unicode_escape')`, which the WPT build scripts apply to
 * test sources: UTF-8 bytes become Latin-1 characters and backslash escapes are interpreted.
 */
export function pythonUnicodeEscape(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);

  const simple: Record<string, string> = {
    '\\': '\\',
    "'": "'",
    '"': '"',
    a: '\x07',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
  };
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (ch !== '\\' || i + 1 >= s.length) {
      out += ch;
      continue;
    }
    const next = s[i + 1] as string;
    if (next in simple) {
      out += simple[next];
      i++;
    } else if (next === '\n') {
      i++; // Line continuation.
    } else if (next === 'x' || next === 'u' || next === 'U') {
      const width = next === 'x' ? 2 : next === 'u' ? 4 : 8;
      const hex = s.slice(i + 2, i + 2 + width);
      if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(hex)) {
        throw new Error(`Truncated \\${next} escape at ${i}`);
      }
      out += String.fromCodePoint(parseInt(hex, 16));
      i += 1 + width;
    } else if (next >= '0' && next <= '7') {
      const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1))?.[0] as string;
      out += String.fromCharCode(parseInt(oct, 8));
      i += oct.length;
    } else {
      out += ch; // Unknown escapes are kept verbatim.
    }
  }
  return out;
}

export interface FileParsingTest {
  name: string;
  js: string;
  /** The VTT file as the build script writes it (UTF-8 encoded). */
  vtt: Uint8Array;
}

/** Splits a `.test` source the way `tools/build.py` does. */
export function readFileParsingTest(path: string): FileParsingTest {
  const source = readWpt(path);
  const headerSplit = source.indexOf('\n\n');
  if (headerSplit === -1) throw new Error(`${path}: missing blank line after header`);
  const header = source.slice(0, headerSplit);
  const body = source.slice(headerSplit + 2);
  const jsSplit = body.indexOf('\n===\n');
  if (jsSplit === -1) throw new Error(`${path}: missing ===`);
  return {
    name: header.split('\n', 1)[0] as string,
    js: body.slice(0, jsSplit),
    vtt: new TextEncoder().encode(pythonUnicodeEscape(body.slice(jsSplit + 5))),
  };
}

/** The subset of the VTTRegion interface the tests read. */
export interface RegionView {
  id: string;
  width: number;
  lines: number;
  regionAnchorX: number;
  regionAnchorY: number;
  viewportAnchorX: number;
  viewportAnchorY: number;
  scroll: string;
}

/** The subset of the VTTCue interface the tests read. */
export interface CueView {
  id: string;
  startTime: number;
  endTime: number;
  pauseOnExit: boolean;
  region: RegionView | null;
  vertical: string;
  snapToLines: boolean;
  line: number | 'auto';
  lineAlign: string;
  position: number | 'auto';
  positionAlign: string;
  size: number;
  align: string;
  text: string;
}

/** Exposes parsed cues as a TextTrackCueList would: VTTCue-shaped and in text track cue order. */
export function cueList(result: ParseResult): CueView[] {
  const regions = new Map<ParsedRegion, RegionView>();
  const regionView = (region: ParsedRegion | null): RegionView | null => {
    if (!region) return null;
    let view = regions.get(region);
    if (!view) {
      const { range: _range, ...rest } = region;
      view = rest;
      regions.set(region, view);
    }
    return view;
  };
  return sortCues(result.cues).map((cue: ParsedCue) => {
    const { range: _range, startMs, endMs, region, ...rest } = cue;
    return {
      ...rest,
      startTime: startMs / 1000,
      endTime: endMs / 1000,
      region: regionView(region),
    };
  });
}

/** testharness.js `same_value`: like `===`, but NaN equals NaN and +0 differs from -0. */
function sameValue(x: unknown, y: unknown): boolean {
  if (y !== y) return x !== x;
  if (x === 0 && y === 0) return 1 / (x as number) === 1 / (y as number);
  return x === y;
}

const show = (v: unknown): string => (typeof v === 'string' ? JSON.stringify(v) : String(v));

export const asserts = {
  assert_equals(actual: unknown, expected: unknown, description = ''): void {
    if (!sameValue(actual, expected)) {
      throw new Error(
        `assert_equals: expected ${show(expected)} but got ${show(actual)} ${description}`,
      );
    }
  },
  assert_not_equals(actual: unknown, expected: unknown, description = ''): void {
    if (sameValue(actual, expected)) {
      throw new Error(`assert_not_equals: got disallowed value ${show(actual)} ${description}`);
    }
  },
  assert_true(actual: unknown, description = ''): void {
    if (actual !== true) throw new Error(`assert_true: got ${show(actual)} ${description}`);
  },
  assert_false(actual: unknown, description = ''): void {
    if (actual !== false) throw new Error(`assert_false: got ${show(actual)} ${description}`);
  },
};

/** Runs a test's JS assertions with the globals the generated HTML page provides. */
export function runAssertions(js: string, cues: CueView[]): void {
  const names = Object.keys(asserts);
  const fn = new Function('cues', 'document', ...names, js) as (...args: unknown[]) => void;
  // No STYLE block ever becomes a document style sheet: it styles cues, not the page.
  fn(cues, { styleSheets: [] }, ...names.map((n) => asserts[n as keyof typeof asserts]));
}

export interface CueTextTest {
  input: string;
  expected: string;
}

/** Reads a `.dat` file the way `buildtests.py` does. */
export function readCueTextTests(path: string): CueTextTest[] {
  const tests: CueTextTest[] = [];
  let state = '';
  let input = '';
  let expected = '';
  const flush = (): void => {
    tests.push({ input: input.slice(0, -1), expected: expected.slice(0, -1) });
    input = '';
    expected = '';
    state = '';
  };
  for (const line of readWpt(path).split(/(?<=\n)/)) {
    if (line.startsWith('#')) {
      state = line;
      if (line === '#document-fragment\n') expected += pythonUnicodeEscape(line);
    } else if (state === '#data\n') {
      input += pythonUnicodeEscape(line);
    } else if (state === '#errors\n') {
      // Ignored.
    } else if (state === '#document-fragment\n') {
      if (line === '\n') flush();
      else expected += pythonUnicodeEscape(line);
    } else {
      throw new Error(`${path}: unexpected line ${JSON.stringify(line)} in state ${state}`);
    }
  }
  if (state !== '') flush();
  return tests;
}

/**
 * Serializes a cue's node tree as `getCueAsHTML()` + WPT's `test_serializer` would, applying the
 * cue text DOM construction rules (§6.5).
 */
export function serializeCueFragment(text: string): string {
  const lines = ['#document-fragment'];
  const visit = (nodes: CueNode[], indent: number): void => {
    const pad = ' '.repeat(indent - 1);
    for (const node of nodes) {
      if (node.type === 'text') {
        lines.push(`|${pad}"${node.value}"`);
        continue;
      }
      if (node.type === 'timestamp') {
        lines.push(`|${pad}<?timestamp ${formatTimestamp(node.ms)}>`);
        continue;
      }
      const isSpan = node.type === 'c' || node.type === 'v' || node.type === 'lang';
      lines.push(`|${pad}<${isSpan ? 'span' : node.type}>`);
      const attributes: [string, string][] = [];
      if (node.classes.length > 0) attributes.push(['class', node.classes.join(' ')]);
      if (node.type === 'lang') attributes.push(['lang', node.language ?? '']);
      if (node.type === 'v') attributes.push(['title', node.annotation]);
      attributes.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      for (const [name, value] of attributes) {
        lines.push(`|${' '.repeat(indent + 1)}${name}="${value}"`);
      }
      visit(node.children, indent + 2);
    }
  };
  visit(parseCueText(text).children, 2);
  return lines.join('\n');
}
