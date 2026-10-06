/**
 * Runs the vendored web-platform-tests WebVTT parsing suites (tests/wpt) against the parser.
 */
import { describe, expect, it } from 'vitest';
import { parse, parseBytes } from '../src/index.ts';
import {
  cueList,
  listFiles,
  readCueTextTests,
  readFileParsingTest,
  readWptBytes,
  runAssertions,
  serializeCueFragment,
} from './wpt-support.ts';

describe('WPT file-parsing', () => {
  for (const file of listFiles('file-parsing', '.test')) {
    const test = readFileParsingTest(`file-parsing/${file}`);
    it(`${file}: ${test.name}`, () => {
      const result = parseBytes(test.vtt);
      // Every .test file describes a track that loads; an invalid signature fires "error".
      expect(result.ok).toBe(true);
      runAssertions(test.js, cueList(result));
    });
  }

  // README: "Tests that expect an 'error' event (due to invalid signature) are ./support/*.vtt".
  for (const file of listFiles('file-parsing', '.vtt')) {
    it(`${file}: rejected (invalid signature)`, () => {
      expect(parseBytes(readWptBytes(`file-parsing/${file}`)).ok).toBe(false);
    });
  }
});

describe('WPT cue-text-parsing', () => {
  for (const file of listFiles('cue-text-parsing', '.dat')) {
    describe(file, () => {
      readCueTextTests(`cue-text-parsing/${file}`).forEach((test, index) => {
        it(`#${index + 1} ${JSON.stringify(test.input)}`, () => {
          // common.js wraps the input in a one-cue file and serializes cues[0].getCueAsHTML().
          const result = parse(`WEBVTT\n\n00:00.000 --> 00:01.000\n${test.input}`);
          expect(result.ok).toBe(true);
          const [cue] = cueList(result);
          expect(cue).toBeDefined();
          expect(serializeCueFragment(cue?.text ?? '')).toBe(test.expected);
        });
      });
    });
  }
});
