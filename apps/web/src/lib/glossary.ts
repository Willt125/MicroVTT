/**
 * A glossary: corrections the user applies to every file (names and terms speech recognition
 * gets wrong). Kept in this browser's local storage; it can be copied out and pasted back as text,
 * one "find => replace" per line.
 */
import { WEBVTT_TEXT, type TextDialect, type VttDocument } from '@microvtt/core';
import { buildPattern, findAll, replaceAll } from './find.ts';

export interface GlossaryEntry {
  find: string;
  replace: string;
  matchCase: boolean;
  wholeWord: boolean;
}

const KEY = 'microvtt.glossary';
const ARROW = ' => ';

export const newEntry = (find = '', replace = ''): GlossaryEntry => ({
  find,
  replace,
  matchCase: false,
  wholeWord: true,
});

export function loadGlossary(): GlossaryEntry[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter((e): e is GlossaryEntry => typeof e?.find === 'string')
      .map((e) => ({ ...newEntry(), ...e }));
  } catch {
    return []; // Storage unavailable or corrupt: start empty.
  }
}

export function saveGlossary(entries: GlossaryEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable (e.g. some private modes): the glossary lasts for this visit only.
  }
}

/** One entry per line: "find => replace" (case-insensitive, whole words). */
export function parseGlossary(text: string): GlossaryEntry[] {
  return text
    .split('\n')
    .map((line) => line.split(ARROW))
    .filter((parts) => parts.length === 2 && (parts[0] as string).trim() !== '')
    .map(([find, replace]) => newEntry((find as string).trim(), (replace as string).trim()));
}

export function formatGlossary(entries: GlossaryEntry[]): string {
  return entries.map((e) => `${e.find}${ARROW}${e.replace}`).join('\n');
}

const patternFor = (e: GlossaryEntry, dialect: TextDialect): RegExp | null => {
  const p = buildPattern(
    {
      query: e.find,
      matchCase: e.matchCase,
      wholeWord: e.wholeWord,
      regex: false,
      acrossTimings: true,
    },
    dialect,
  );
  return p instanceof RegExp ? p : null;
};

/** Matches per entry, in the cues given. */
export function countGlossary(
  doc: VttDocument,
  rows: readonly number[],
  entries: GlossaryEntry[],
  dialect: TextDialect = WEBVTT_TEXT,
): number[] {
  return entries.map((e) => {
    const p = patternFor(e, dialect);
    return p ? findAll(doc, rows, p).length : 0;
  });
}

/** Applies every entry in order; returns the new document and the replacements per entry. */
export function applyGlossary(
  doc: VttDocument,
  rows: readonly number[],
  entries: GlossaryEntry[],
  dialect: TextDialect = WEBVTT_TEXT,
): { doc: VttDocument; counts: number[] } {
  let current = doc;
  const counts = entries.map((e) => {
    const p = patternFor(e, dialect);
    if (!p) return 0;
    const result = replaceAll(current, rows, p, e.replace, false);
    current = result.doc;
    return result.count;
  });
  return { doc: current, counts };
}
