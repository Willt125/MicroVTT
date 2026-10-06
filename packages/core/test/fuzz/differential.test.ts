/**
 * Differential and streaming fuzz tests.
 *
 * 1. Differential: generated documents are parsed by @microvtt/core and by WPT's Python reference
 *    parser (with the spec-cited patches in reference_driver.py), and the results compared.
 * 2. Streaming: the same documents, encoded to UTF-8 and split into random chunks (including
 *    inside multi-byte sequences and CRLF pairs), must parse identically to the whole input.
 *
 * FUZZ_CASES and FUZZ_SEED override the defaults for longer local runs (`pnpm fuzz`).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ParseResult, ParsedRegion } from '../../src/index.ts';
import { WebVTTByteParser, parse } from '../../src/index.ts';
import { Gen, generateDocument, rng } from './generate.ts';

const CASES = Number(process.env['FUZZ_CASES'] ?? 3000);
const SEED = Number(process.env['FUZZ_SEED'] ?? 20261006);
/** Generous: about 0.25 ms per case for each test, plus process start-up. */
const TIMEOUT = 30_000 + CASES * 2;
const DRIVER = fileURLToPath(new URL('./reference_driver.py', import.meta.url));

const python = spawnSync('python3', ['--version']);
const hasPython = python.status === 0;

function documents(seed: number, count: number): string[] {
  const g = new Gen(rng(seed));
  return Array.from({ length: count }, () => generateDocument(g));
}

const regionShape = (r: ParsedRegion): Record<string, unknown> => {
  const { range: _range, ...rest } = r;
  return rest;
};

/** Our result in the reference driver's JSON shape. Times stay in ms; see `compareTimes`. */
function shape(result: ParseResult): unknown {
  return {
    ok: result.ok,
    cues: result.cues.map((c) => ({
      id: c.id,
      start: c.startMs,
      end: c.endMs,
      region: c.region ? regionShape(c.region) : null,
      vertical: c.vertical,
      snapToLines: c.snapToLines,
      line: c.line,
      lineAlign: c.lineAlign,
      position: c.position,
      positionAlign: c.positionAlign,
      size: c.size,
      align: c.align,
      text: c.text,
    })),
    regions: result.regions.map(regionShape),
    stylesheets: result.stylesheets.map((s) => s.css),
  };
}

interface ReferenceCue {
  start: number;
  end: number;
  [key: string]: unknown;
}

/** The reference reports seconds as floats; convert to ms for comparison. */
function referenceInMs(ref: { cues: ReferenceCue[] }): unknown {
  return {
    ...ref,
    cues: ref.cues.map((c) => ({
      ...c,
      start: Math.round(c.start * 1000),
      end: Math.round(c.end * 1000),
    })),
  };
}

describe('differential: core vs WPT reference parser', () => {
  it.skipIf(!hasPython)(
    `agrees on ${CASES} generated documents (seed ${SEED})`,
    () => {
      const docs = documents(SEED, CASES);
      const run = spawnSync('python3', ['-I', DRIVER], {
        input: docs.map((d) => JSON.stringify(d)).join('\n') + '\n',
        encoding: 'utf8',
        maxBuffer: 1 << 28,
      });
      expect(run.stderr).toBe('');
      expect(run.status).toBe(0);
      const outputs = run.stdout.trimEnd().split('\n');
      expect(outputs).toHaveLength(docs.length);

      const failures: string[] = [];
      docs.forEach((doc, i) => {
        const ours = shape(parse(doc));
        const theirs = referenceInMs(JSON.parse(outputs[i] as string));
        try {
          expect(ours).toEqual(theirs);
        } catch (error) {
          if (failures.length < 3) {
            failures.push(`case ${i}: ${JSON.stringify(doc)}\n${(error as Error).message}`);
          } else {
            failures.push(`case ${i}`);
          }
        }
      });
      expect(failures, failures.slice(0, 3).join('\n\n')).toEqual([]);
    },
    TIMEOUT,
  );
});

describe('streaming: chunked input matches whole input', () => {
  it(
    `agrees on ${CASES} generated documents`,
    () => {
      const g = new Gen(rng(SEED + 1));
      const encoder = new TextEncoder();
      for (const doc of documents(SEED, CASES)) {
        const bytes = encoder.encode(doc);
        const parser = new WebVTTByteParser();
        for (let pos = 0; pos < bytes.length;) {
          const size = g.chance(0.3) ? 1 : g.int(1, 16);
          parser.push(bytes.subarray(pos, pos + size));
          pos += size;
        }
        // UTF-8 decoding strips one leading BOM; string input is taken as already decoded.
        expect(parser.end()).toEqual(parse(doc.startsWith('\ufeff') ? doc.slice(1) : doc));
      }
    },
    TIMEOUT,
  );
});
