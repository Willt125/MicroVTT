/**
 * Parser behaviour beyond the WPT suite: the streaming API, source ranges, decoding, and the
 * auto-caption fixtures.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WebVTTByteParser,
  WebVTTParser,
  parse,
  parseBytes,
  parseCueText,
  sortCues,
} from '../src/index.ts';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('signature', () => {
  it.each(['WEBVTT', 'WEBVTT\n', 'WEBVTT title', 'WEBVTT\tx', 'WEBVTT\r\n'])(
    'accepts %j',
    (text) => {
      expect(parse(text).ok).toBe(true);
    },
  );

  it.each(['', 'WEBVT', 'WEBVTTX', 'webvtt', 'WEBVTT\fx', '﻿WEBVTT', ' WEBVTT'])(
    'rejects %j',
    (text) => {
      expect(parse(text).ok).toBe(false);
    },
  );

  it('strips one BOM when decoding bytes, but not two', () => {
    const bom = [0xef, 0xbb, 0xbf];
    const body = [...new TextEncoder().encode('WEBVTT\n')];
    expect(parseBytes(new Uint8Array([...bom, ...body])).ok).toBe(true);
    expect(parseBytes(new Uint8Array([...bom, ...bom, ...body])).ok).toBe(false);
  });

  it('rejects early, before a whole line arrives', () => {
    const parser = new WebVTTParser();
    parser.push('WEBVTTX and then a very long line');
    parser.push(' that never ends\n\n00:00.000 --> 00:01.000\nx');
    expect(parser.end()).toEqual({ ok: false, cues: [], regions: [], stylesheets: [] });
  });
});

describe('streaming', () => {
  it('handles CRLF and multi-byte characters split across chunks', () => {
    const text = 'WEBVTT\r\n\r\n00:00.000 --> 00:01.000\r\nünï ✓ 😀\r\n';
    const bytes = new TextEncoder().encode(text);
    for (let split = 1; split < bytes.length; split++) {
      const parser = new WebVTTByteParser();
      parser.push(bytes.subarray(0, split));
      parser.push(bytes.subarray(split));
      expect(parser.end().cues.map((c) => c.text)).toEqual(['ünï ✓ 😀']);
    }
  });

  it('throws if pushed after end', () => {
    const parser = new WebVTTParser();
    parser.end();
    expect(() => parser.push('x')).toThrow();
  });
});

describe('source ranges', () => {
  it('cover each block in the normalized input', () => {
    const text =
      'WEBVTT\r\n\r\nSTYLE\r\n::cue {}\r\n\r\nREGION\nid:r\n\nid1\n00:00.000 --> 00:01.000\nline 1\nline 2\n';
    const normalized = text.replace(/\r\n/g, '\n');
    const result = parse(text);
    const slice = (r: { start: number; end: number }): string => normalized.slice(r.start, r.end);
    expect(slice(result.stylesheets[0]!.range)).toBe('STYLE\n::cue {}');
    expect(slice(result.regions[0]!.range)).toBe('REGION\nid:r');
    expect(slice(result.cues[0]!.range)).toBe('id1\n00:00.000 --> 00:01.000\nline 1\nline 2');
  });
});

describe('sortCues', () => {
  it('orders by start, then end descending, then file order', () => {
    const cues = [
      { startMs: 5, endMs: 6, n: 0 },
      { startMs: 1, endMs: 2, n: 1 },
      { startMs: 1, endMs: 9, n: 2 },
      { startMs: 1, endMs: 2, n: 3 },
    ];
    expect(sortCues(cues).map((c) => c.n)).toEqual([2, 1, 3, 0]);
  });
});

describe('auto-caption fixtures', () => {
  it('parses the en-orig style sample', () => {
    const result = parse(fixture('autocaption-sample.vtt'));
    expect(result.ok).toBe(true);
    expect(result.cues).toHaveLength(11);
    // The Kind:/Language: lines are a header block: swallowed, not cues.
    expect(result.cues[0]).toMatchObject({
      startMs: 240,
      endMs: 3070,
      align: 'start',
      position: 0,
    });
    expect(result.cues[0]!.text).toBe(
      ' \nWelcome<00:00:00.820><c> back</c><00:00:01.100><c> to</c><00:00:01.260><c> the</c>' +
        '<00:00:01.500><c> workshop.</c><00:00:02.310><c> Today</c><00:00:02.600><c> we</c>',
    );
    const words = parseCueText(result.cues[0]!.text).children.filter((n) => n.type === 'timestamp');
    expect(words).toHaveLength(6);
  });

  it('parses the translated-track sample, including its empty-line quirk', () => {
    const result = parse(fixture('autocaption-translated-sample.vtt'));
    expect(result.ok).toBe(true);
    expect(result.cues).toHaveLength(8);
    const handOff = result.cues.find((c) => c.startMs === 5405);
    expect(handOff?.text).toBe(' \n ');
  });
});
