import { describe, expect, it } from 'vitest';
import type { VttDocument } from '@microvtt/core';
import { createCue, createDocument } from '@microvtt/core';
import { buildPattern, findAll } from './find.ts';
import {
  applyGlossary,
  countGlossary,
  formatGlossary,
  loadGlossary,
  newEntry,
  parseGlossary,
  saveGlossary,
} from './glossary.ts';

const doc = (...texts: string[]): VttDocument => ({
  ...createDocument(),
  body: texts.map((t, i) => createCue(i * 1000, i * 1000 + 1000, t)),
});
const texts = (d: VttDocument): string[] => d.body.map((c) => (c.type === 'cue' ? c.text : ''));

describe('matching across word timings', () => {
  it('lets spaces match timing and class tags', () => {
    const d = doc(
      'I asked chat <00:00:00.500>gpt about it',
      'chat</c><00:00:01.500><c> gpt',
      'chat\ngpt',
      'chatgpt',
    );
    const p = buildPattern({
      query: 'chat gpt',
      matchCase: false,
      wholeWord: true,
      regex: false,
      acrossTimings: true,
    }) as RegExp;
    expect(findAll(d, [0, 1, 2, 3], p).map((m) => m.bodyIndex)).toEqual([0, 1, 2]);
    const plain = buildPattern({
      query: 'chat gpt',
      matchCase: false,
      wholeWord: true,
      regex: false,
    });
    expect(findAll(d, [0, 1, 2, 3], plain as RegExp)).toEqual([]);
  });
});

describe('glossary', () => {
  it('reads and writes the text form', () => {
    const entries = parseGlossary('chat gpt => ChatGPT\n\nnot a rule\nelon => Elon');
    expect(entries.map((e) => [e.find, e.replace])).toEqual([
      ['chat gpt', 'ChatGPT'],
      ['elon', 'Elon'],
    ]);
    expect(formatGlossary(entries)).toBe('chat gpt => ChatGPT\nelon => Elon');
  });

  it('counts and applies every entry, whole words by default', () => {
    const d = doc('elon said chat <00:00:00.400>gpt', 'skeleton crew', 'ELON');
    const entries = [newEntry('chat gpt', 'ChatGPT'), newEntry('elon', 'Elon')];
    expect(countGlossary(d, [0, 1, 2], entries)).toEqual([1, 2]);
    const { doc: out, counts } = applyGlossary(d, [0, 1, 2], entries);
    expect(counts).toEqual([1, 2]);
    expect(texts(out)).toEqual(['Elon said ChatGPT', 'skeleton crew', 'Elon']);
  });

  it('survives having no storage', () => {
    saveGlossary([newEntry('a', 'b')]); // No localStorage in this environment.
    expect(loadGlossary()).toEqual([]);
  });
});
