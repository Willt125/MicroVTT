/**
 * Seeded generator of adversarial WebVTT documents for differential and streaming tests.
 * Biased toward the constructs where parsers disagree: arrows in odd places, broken timestamps,
 * settings edge cases, STYLE/REGION blocks before and after cues, mixed line endings and NULs.
 */

/** mulberry32: small, fast, deterministic. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Gen {
  readonly random: () => number;

  constructor(random: () => number) {
    this.random = random;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.random() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)] as T;
  }

  repeat(min: number, max: number, f: () => string, sep = ''): string {
    const n = this.int(min, max);
    const parts: string[] = [];
    for (let i = 0; i < n; i++) parts.push(f());
    return parts.join(sep);
  }

  digits(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += String(this.int(0, 9));
    return s;
  }
}

const WS = [' ', ' ', ' ', '\t', '  ', ' \t', '\f'];

function timestamp(g: Gen): string {
  if (g.chance(0.85)) {
    // Mostly well-formed, with occasional out-of-range fields.
    const mm = g.chance(0.9) ? String(g.int(0, 59)).padStart(2, '0') : g.digits(2);
    const ss = g.chance(0.9) ? String(g.int(0, 59)).padStart(2, '0') : g.digits(2);
    const frac = g.digits(3);
    if (g.chance(0.4)) return `${mm}:${ss}.${frac}`;
    const hh = g.chance(0.8) ? String(g.int(0, 99)).padStart(2, '0') : g.digits(g.int(1, 5));
    return `${hh}:${mm}:${ss}.${frac}`;
  }
  // Malformed: wrong field widths, separators, or missing parts.
  return g.pick([
    () => `${g.digits(g.int(0, 3))}:${g.digits(g.int(0, 3))}.${g.digits(g.int(0, 4))}`,
    () => `${g.digits(2)}:${g.digits(2)}:${g.digits(2)}.${g.digits(g.int(0, 4))}`,
    () => `${g.digits(2)}:${g.digits(2)},${g.digits(3)}`,
    () => `${g.digits(2)}.${g.digits(3)}`,
    () => `${g.digits(1)}:${g.digits(2)}.${g.digits(3)}`,
    () => `-${g.digits(2)}:${g.digits(2)}.${g.digits(3)}`,
    () => `${g.digits(2)}:${g.digits(2)}.${g.digits(3)}x`,
    () => '',
  ])();
}

function percentage(g: Gen): string {
  if (g.chance(0.6))
    return g.chance(0.5) ? `${g.int(0, 100)}%` : `${g.int(0, 99)}.${g.digits(g.int(1, 3))}%`;
  return g.pick([
    () => `${g.int(0, 100)}%`,
    () => `${g.int(0, 100)}.${g.digits(g.int(1, 3))}%`,
    () => `${g.int(101, 999)}%`,
    () => `${g.digits(g.int(1, 3))}`,
    () => `.${g.digits(1)}%`,
    () => `${g.digits(1)}.%`,
    () => `-${g.int(0, 100)}%`,
    () => `${g.digits(2)}%%`,
    () => `１０%`, // Non-ASCII digits.
  ])();
}

function anyValue(g: Gen, regionIds: readonly string[]): string {
  return g.pick([
    () => g.pick(regionIds.length > 0 ? regionIds : ['r']),
    () => g.pick(['rl', 'lr', 'RL', '']),
    () => g.pick(['start', 'center', 'end', 'left', 'right', 'middle', 'line-left', 'line-right']),
    () => percentage(g),
    () =>
      g.pick([
        '-1',
        '0',
        '-0',
        '5',
        '1.5',
        '1.',
        '.5',
        '-.5',
        '1-2',
        '--1',
        '1e3',
        '99999999999999999999',
      ]),
    () => g.pick(['a:b', ':', 'x']),
  ])();
}

/** A value that is usually meaningful for the given setting name, sometimes anything at all. */
function valueFor(g: Gen, name: string, regionIds: readonly string[]): string {
  if (g.chance(0.25)) return anyValue(g, regionIds);
  switch (name) {
    case 'region':
      return g.chance(0.8) && regionIds.length > 0 ? g.pick(regionIds) : g.pick(['nope', 'R']);
    case 'vertical':
      return g.pick(['rl', 'lr', 'rl', 'lr', 'RL', 'tb']);
    case 'line': {
      const pos = g.pick([
        () => String(g.int(-20, 20)),
        () => `${g.int(-5, 5)}.${g.digits(1)}`,
        () => percentage(g),
        () => g.pick(['-0', '1.', '.5', '1-2', '99999999999999999999', '1e400']),
      ])();
      return g.chance(0.6)
        ? pos
        : `${pos},${g.pick(['start', 'center', 'end', 'end', 'line-left', ''])}`;
    }
    case 'position': {
      const pos = percentage(g);
      return g.chance(0.6)
        ? pos
        : `${pos},${g.pick(['line-left', 'center', 'line-right', 'line-right', 'start', ''])}`;
    }
    case 'size':
      return g.chance(0.2) ? '100%' : percentage(g);
    case 'align':
      return g.pick(['start', 'center', 'end', 'left', 'right', 'middle', 'Start']);
    default:
      return anyValue(g, regionIds);
  }
}

function cueSetting(g: Gen, regionIds: readonly string[]): string {
  const name = g.pick([
    'region',
    'region',
    'vertical',
    'line',
    'line',
    'position',
    'size',
    'align',
    'foo',
    'Align',
    '',
  ]);
  return g.pick([
    () => `${name}:${valueFor(g, name, regionIds)}`,
    () => `${name}:${valueFor(g, name, regionIds)}`,
    () => `${name}:${valueFor(g, name, regionIds)}`,
    () => `${name}:${valueFor(g, name, regionIds)}`,
    () => `${name}:`,
    () => `:${anyValue(g, regionIds)}`,
    () => name,
  ])();
}

function regionSetting(g: Gen, id: string): string {
  return g.pick([
    () => `id:${id}`,
    () => `id:${id}`,
    () => `id:${g.pick(['r', 'r1', 'fred', 'a-->b', 'x:y'])}`,
    () => `width:${percentage(g)}`,
    () => `lines:${g.pick([String(g.int(0, 9)), '3a', '-1', '', '1.5', '٣'])}`,
    () => `regionanchor:${percentage(g)},${percentage(g)}`,
    () => `viewportanchor:${percentage(g)}${g.pick([',', ';', ''])}${percentage(g)}`,
    () => `scroll:${g.pick(['up', 'down', 'UP', ''])}`,
    () => g.pick(['junk', 'id:', ':x', 'width']),
  ])();
}

function timingLine(g: Gen, regionIds: readonly string[]): string {
  const lead = g.chance(0.1) ? g.pick(WS) : '';
  const arrow = g.chance(0.85) ? '-->' : g.pick(['->', '--!>', '- ->', '—>']);
  const sep1 = g.chance(0.85) ? g.pick(WS) : '';
  const sep2 = g.chance(0.85) ? g.pick(WS) : '';
  const settings = g.chance(0.8)
    ? g.pick(WS) + g.repeat(1, 4, () => cueSetting(g, regionIds), g.pick(WS))
    : '';
  return `${lead}${timestamp(g)}${sep1}${arrow}${sep2}${timestamp(g)}${settings}`;
}

function textLine(g: Gen): string {
  return g.pick([
    'text',
    'Hello <b>world</b>',
    '<v Roger>Hi &amp; bye',
    'a --> b',
    '-->',
    'NOTE this',
    'STYLE',
    'REGION',
    ' ',
    '00:00.000 --> 00:01.000',
    '\u0000nul',
    'ünïcödé ✓',
  ]);
}

export interface Generated {
  text: string;
}

/** Generates one document. Lines are joined with random LF / CRLF / CR terminators. */
export function generateDocument(g: Gen): string {
  const lines: string[] = [];
  const regionIds: string[] = [];

  lines.push(
    g.chance(0.92)
      ? `WEBVTT${g.chance(0.3) ? g.pick([' ', '\t']) + g.pick(['', 'title', '-->x']) : ''}`
      : g.pick(['WEBVTT\fx', 'webvtt', 'WEBVT', '', 'WEBVTTx', '﻿WEBVTT', 'WEBVTT\u0000']),
  );
  if (g.chance(0.25))
    lines.push(
      ...g.pick([
        ['Kind: captions', 'Language: en'],
        ['X-TIMESTAMP-MAP=MPEGTS:0'],
        ['00:00.000 --> 00:01.000'],
      ]),
    );

  // Region-focused documents: regions (often with duplicate ids) defined up front, then cues
  // that reference them, with at most one other setting that may take the cue out of its region.
  if (g.chance(0.3)) {
    for (let r = g.int(1, 3); r > 0; r--) {
      const id = g.pick(['r', 'r1']);
      lines.push(
        '',
        'REGION',
        `id:${id} width:${g.int(0, 100)}% lines:${g.int(0, 9)}${g.chance(0.5) ? ' scroll:up' : ''}`,
      );
      regionIds.push(id);
    }
    for (let c = g.int(1, 4); c > 0; c--) {
      const extra = g.chance(0.5) ? ` ${cueSetting(g, regionIds)}` : '';
      const region = `region:${g.pick(regionIds)}`;
      const settings = g.chance(0.5) ? `${region}${extra}` : `${extra} ${region}`;
      lines.push('', `00:00:0${g.int(0, 9)}.000 --> 00:00:1${g.int(0, 9)}.000 ${settings}`, 'text');
    }
  }

  const blocks = g.int(0, 8);
  for (let b = 0; b < blocks; b++) {
    lines.push(...Array.from({ length: g.pick([0, 1, 1, 1, 2]) }, () => ''));
    const kind =
      b < 2 && g.chance(0.5)
        ? g.pick(['style', 'region', 'region'])
        : g.pick(['cue', 'cue', 'cue', 'cue', 'style', 'region', 'note', 'junk']);
    if (kind === 'cue') {
      if (g.chance(0.4)) lines.push(g.pick(['id', '1', 'STYLE', 'REGION', 'cue one', 'NOTE']));
      lines.push(timingLine(g, regionIds));
      for (let i = g.int(0, 3); i > 0; i--) lines.push(textLine(g));
    } else if (kind === 'style') {
      lines.push(
        g.pick([
          'STYLE',
          'STYLE ',
          'STYLE\t',
          'STYLE\v',
          'STYLE\u00a0',
          'STYLE\u0001',
          'STYLES',
          'style',
        ]),
      );
      for (let i = g.int(0, 3); i > 0; i--) {
        lines.push(
          g.pick(['::cue { color: red }', '::cue(b) {', '}', 'a --> b', '00:00.000 --> 00:01.000']),
        );
      }
    } else if (kind === 'region') {
      lines.push(
        g.pick(['REGION', 'REGION', 'REGION ', 'REGION\v', 'REGION\u2003', 'REGIONS', 'region']),
      );
      const id = g.pick(['r', 'r1', 'fred']);
      for (let i = g.int(1, 2); i > 0; i--) {
        lines.push(g.repeat(1, 4, () => regionSetting(g, id), g.pick([' ', '\t', ' \t'])));
      }
      regionIds.push(id);
    } else if (kind === 'note') {
      lines.push(g.pick(['NOTE', 'NOTE comment', 'NOTE\tx']));
      if (g.chance(0.5)) lines.push(textLine(g));
    } else {
      lines.push(textLine(g));
    }
  }

  let text = '';
  lines.forEach((line, i) => {
    text += line;
    if (i < lines.length - 1 || g.chance(0.5)) text += g.pick(['\n', '\n', '\n', '\r\n', '\r']);
  });
  return text;
}
