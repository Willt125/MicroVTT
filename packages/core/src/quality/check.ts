/** Running a ruleset over a document, and applying the fixes it offers. */
import type { BodyItem, Cue, VttDocument } from '../document.ts';
import type { TextDialect } from '../format/dialect.ts';
import { WEBVTT_TEXT } from '../format/webvtt-text.ts';
import { RULES, type CueInfo } from './rules.ts';
import { RULESETS } from './rulesets.ts';
import type { QualityFinding, QualityFix, QualityRuleId, RuleOverrides, Ruleset } from './types.ts';

/** What is known about the media, for rules that depend on it. */
export interface QualityContext {
  /** The video's frame rate, used by rules with an `fps` setting unless the user set one. */
  fps?: number;
  /** How the document's cue text is written (WebVTT by default). */
  dialect?: TextDialect;
  /** The video's shot changes (ms, sorted), for the shot-change rule. */
  shotChanges?: readonly number[];
}

/** A ruleset's rules after the user's changes: enabled ones, with their settings. */
export function effectiveRules(
  ruleset: Ruleset,
  overrides: RuleOverrides = {},
  context: QualityContext = {},
): { id: QualityRuleId; severity: 'warning' | 'info'; params: Record<string, number> }[] {
  return (
    Object.entries(ruleset.rules) as [QualityRuleId, NonNullable<Ruleset['rules'][QualityRuleId]>][]
  )
    .filter(([id]) => overrides[id]?.enabled !== false && RULES[id])
    .map(([id, entry]) => ({
      id,
      severity: entry.severity,
      params: {
        ...RULES[id].defaults,
        ...entry.params,
        ...(context.fps && 'fps' in RULES[id].defaults ? { fps: context.fps } : {}),
        ...overrides[id]?.params,
      },
    }));
}

export function rulesetById(id: string): Ruleset | undefined {
  return RULESETS.find((r) => r.id === id);
}

/** Checks `doc` against a ruleset. Findings are in document order, head first. */
export function checkQuality(
  doc: VttDocument,
  ruleset: Ruleset,
  overrides: RuleOverrides = {},
  context: QualityContext = {},
): QualityFinding[] {
  const rules = effectiveRules(ruleset, overrides, context);
  const findings: QualityFinding[] = [];
  const emitFor =
    (id: QualityRuleId, severity: 'warning' | 'info') =>
    (f: { list?: 'body' | 'head'; index: number; message: string; fix?: QualityFix }): void => {
      findings.push({
        rule: id,
        category: RULES[id].category,
        severity,
        list: f.list ?? 'body',
        index: f.index,
        message: f.message,
        ...(f.fix ? { fix: f.fix } : {}),
      });
    };

  for (const { id, severity, params } of rules) {
    RULES[id].document?.(doc, params, emitFor(id, severity));
  }

  const cueRules = rules.filter(({ id }) => RULES[id].cue);
  if (cueRules.length > 0) {
    const dialect = context.dialect ?? WEBVTT_TEXT;
    const infos: CueInfo[] = [];
    doc.body.forEach((item, index) => {
      if (item.type === 'cue')
        infos.push({
          cue: item,
          index,
          lines: dialect.readableLines(item.text),
          dialect,
          next: null,
          previous: null,
          shotChanges: context.shotChanges ?? [],
        });
    });
    infos.forEach((info, i) => {
      info.next = infos[i + 1] ?? null;
      info.previous = infos[i - 1] ?? null;
    });
    for (const info of infos) {
      for (const { id, severity, params } of cueRules) {
        RULES[id].cue?.(info, params, emitFor(id, severity));
      }
    }
  }

  const order = (f: QualityFinding): number => (f.list === 'head' ? -1e9 : 0) + f.index;
  return findings.sort((a, b) => order(a) - order(b));
}

/** Applies one finding's fix. The finding must have been made for this document. */
export function applyQualityFix(doc: VttDocument, finding: QualityFinding): VttDocument {
  const fix = finding.fix;
  if (!fix || finding.list !== 'body') return doc;
  const cue = doc.body[finding.index];
  if (cue?.type !== 'cue') return doc;
  const change = fix.change;
  if (change.kind === 'delete') {
    return { ...doc, body: doc.body.filter((_, i) => i !== finding.index) };
  }
  let next: Cue;
  switch (change.kind) {
    case 'text':
      next = { ...cue, text: change.text };
      break;
    case 'times':
      next = { ...cue, startMs: change.startMs, endMs: change.endMs };
      break;
    case 'centre':
      next = { ...cue, align: 'center', position: 'auto', positionAlign: 'auto' };
      break;
  }
  delete next.source;
  const body: BodyItem[] = [...doc.body];
  body[finding.index] = next;
  return { ...doc, body };
}

/**
 * Applies the fixes of several findings (e.g. every fix one rule offers). Deletions are
 * applied last, from the end, so indices stay valid; each cue takes at most one fix.
 */
export function applyQualityFixes(
  doc: VttDocument,
  findings: readonly QualityFinding[],
): VttDocument {
  const seen = new Set<number>();
  const fixable = findings.filter((f) => {
    if (!f.fix || f.list !== 'body' || seen.has(f.index)) return false;
    seen.add(f.index);
    return true;
  });
  const deletes = fixable.filter((f) => f.fix?.change.kind === 'delete');
  let out = fixable
    .filter((f) => f.fix?.change.kind !== 'delete')
    .reduce((d, f) => applyQualityFix(d, f), doc);
  for (const f of [...deletes].sort((a, b) => b.index - a.index)) out = applyQualityFix(out, f);
  return out;
}
