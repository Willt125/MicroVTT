/** Helpers for showing cues in the table. */
import type { CueNode, Severity } from '@microvtt/core';
import { parseCueText } from '@microvtt/core';

const cache = new Map<string, string>();
const CACHE_LIMIT = 5000;

function textOf(nodes: CueNode[]): string {
  return nodes
    .map((n) => (n.type === 'text' ? n.value : n.type === 'timestamp' ? '' : textOf(n.children)))
    .join('');
}

/** The readable text of raw cue text, on one line ("⏎" marks line breaks). Cached. */
export function plainText(raw: string): string {
  let text = cache.get(raw);
  if (text === undefined) {
    text = textOf(parseCueText(raw).children)
      .split('\n')
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
