/** Helpers for showing cues in the table. */
import { WEBVTT_TEXT, type Severity, type TextDialect } from '@microvtt/core';

const caches = new WeakMap<TextDialect, Map<string, string>>();
const CACHE_LIMIT = 5000;

/** The readable text of raw cue text, on one line ("⏎" marks line breaks). Cached. */
export function plainText(raw: string, dialect: TextDialect = WEBVTT_TEXT): string {
  let cache = caches.get(dialect);
  if (!cache) caches.set(dialect, (cache = new Map()));
  let text = cache.get(raw);
  if (text === undefined) {
    text = dialect
      .displayLines(raw)
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .join(' ⏎ ');
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(raw, text);
  }
  return text;
}

const RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };

export function worstSeverity(severities: Severity[]): Severity | null {
  let worst: Severity | null = null;
  for (const s of severities) if (worst === null || RANK[s] > RANK[worst]) worst = s;
  return worst;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Note',
};
