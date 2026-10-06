/**
 * Parser benchmarks on auto-caption-shaped input (see docs/PLAN.md "Sizing").
 *
 * Run: pnpm bench   (from the repo root)
 * Synthetic files follow the measured YouTube structure at the fast-speech rate (~3.6k cues and
 * ~574 KB per hour). Real samples in tests/private-fixtures are included when present.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  WebVTTByteParser,
  exportDocument,
  importDocument,
  parseCueText,
  validate,
} from '../src/index.ts';

const WORDS = [
  'so',
  'the',
  'thing',
  'about',
  'captions',
  'is',
  'that',
  'they',
  'never',
  'quite',
  'match',
  'what',
  'was',
  'said',
];

function ts(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const f = ms % 1000;
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(f, 3)}`;
}

/** Growing cue + 10 ms hand-off cue per caption line, ~1.98 s per line (fast speech). */
function synthetic(lineCount: number): string {
  const out = ['WEBVTT\nKind: captions\nLanguage: en\n'];
  let prev = ' ';
  let t = 240;
  for (let i = 0; i < lineCount; i++) {
    const n = 5 + (i % 4);
    const words = Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k) % WORDS.length] as string);
    const end = t + 1980;
    const step = Math.floor(1900 / n);
    let timed = words[0] as string;
    for (let k = 1; k < n; k++) timed += `<${ts(t + step * k)}><c> ${words[k]}</c>`;
    out.push(`${ts(t)} --> ${ts(end)} align:start position:0%\n${prev}\n${timed}\n`);
    prev = words.join(' ');
    out.push(`${ts(end)} --> ${ts(end + 10)} align:start position:0%\n${prev}\n \n`);
    t = end + 10;
  }
  return out.join('\n');
}

interface Row {
  name: string;
  mb: number;
  cues: number;
  parseMs: number;
  cueTextMs: number;
  heapMb: number;
}

function measure(name: string, bytes: Uint8Array): Row {
  const runs = 5;
  let best = Infinity;
  let cueCount = 0;
  let cueTexts: string[] = [];
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    // Feed 64 KiB chunks, as File.stream() would.
    const parser = new WebVTTByteParser();
    for (let i = 0; i < bytes.length; i += 65_536) parser.push(bytes.subarray(i, i + 65_536));
    const result = parser.end();
    best = Math.min(best, performance.now() - t0);
    cueCount = result.cues.length;
    cueTexts = result.cues.map((c) => c.text);
  }
  let bestText = Infinity;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    for (const text of cueTexts) parseCueText(text);
    bestText = Math.min(bestText, performance.now() - t0);
  }
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed;
  const parser = new WebVTTByteParser();
  parser.push(bytes);
  const kept = parser.end();
  globalThis.gc?.();
  const heapMb = (process.memoryUsage().heapUsed - before) / 1e6;
  if (kept.cues.length !== cueCount) throw new Error('unstable result');
  return {
    name,
    mb: bytes.length / 1e6,
    cues: cueCount,
    parseMs: best,
    cueTextMs: bestText,
    heapMb,
  };
}

const encoder = new TextEncoder();
const rows: Row[] = [];
// 1,818 lines ≈ 1 hour at ~1.98 s per line.
for (const [name, lines] of [
  ['synthetic 10 min', 303],
  ['synthetic 1 h', 1818],
  ['synthetic 12 h', 21_816],
  ['synthetic 100k cues', 50_000],
  ['synthetic 50 MB', 152_000],
] as const) {
  rows.push(measure(name, encoder.encode(synthetic(lines))));
}

const privateDir = new URL('../../../tests/private-fixtures/', import.meta.url);
if (existsSync(privateDir)) {
  for (const file of readdirSync(privateDir)
    .filter((f) => f.endsWith('.vtt'))
    .sort()) {
    rows.push(measure(`real ${file}`, readFileSync(new URL(file, privateDir))));
  }
}

console.log(`Node ${process.version}, best of 5 runs, 64 KiB chunks\n`);
console.log('| Input | Size | Cues | Parse | Throughput | Cue text (all cues) | Retained heap |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const r of rows) {
  console.log(
    `| ${r.name} | ${r.mb.toFixed(2)} MB | ${r.cues.toLocaleString('en-US')} | ${r.parseMs.toFixed(1)} ms | ` +
      `${(r.mb / (r.parseMs / 1000)).toFixed(0)} MB/s | ${r.cueTextMs.toFixed(1)} ms | ${r.heapMb.toFixed(1)} MB |`,
  );
}

// Validation and export (import → repair → serialize → re-validate) on the larger inputs.
const best = (fn: () => void, runs = 3): number => {
  let t = Infinity;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    fn();
    t = Math.min(t, performance.now() - t0);
  }
  return t;
};
const decoder = new TextDecoder();
const bigInputs: [string, string][] = [
  ['synthetic 1 h', synthetic(1818)],
  ['synthetic 12 h', synthetic(21_816)],
  ['synthetic 100k cues', synthetic(50_000)],
];
if (existsSync(privateDir)) {
  const real = new URL('autocaption-4h18m29s.vtt', privateDir);
  if (existsSync(real))
    bigInputs.push(['real autocaption-4h18m29s.vtt', decoder.decode(readFileSync(real))]);
}
console.log('\n| Input | Cues | Validate | Export (repair + serialize + re-validate) |');
console.log('| --- | ---: | ---: | ---: |');
for (const [name, text] of bigInputs) {
  const { document } = importDocument(text);
  const cues = document.body.filter((i) => i.type === 'cue').length;
  const v = best(() => validate(text));
  const e = best(() => exportDocument(document));
  console.log(
    `| ${name} | ${cues.toLocaleString('en-US')} | ${v.toFixed(0)} ms | ${e.toFixed(0)} ms |`,
  );
}
