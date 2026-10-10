/**
 * Style and accessibility checks ("quality" checks): rules from subtitle style guides and
 * accessibility guidance. They are kept apart from the format's own errors and warnings
 * (diagnostics.ts): a file can conform to WebVTT and still break a style guide, and these
 * findings never block export.
 */

export type QualityCategory = 'timing' | 'reading-speed' | 'layout' | 'text' | 'accessibility';
export type QualitySeverity = 'warning' | 'info';

export type QualityRuleId =
  | 'empty-cue'
  | 'min-duration'
  | 'max-duration'
  | 'min-gap'
  | 'overlap'
  | 'chars-per-second'
  | 'words-per-minute'
  | 'max-lines'
  | 'line-length'
  | 'line-shape'
  | 'line-break-words'
  | 'centred'
  | 'ellipsis-character'
  | 'double-space'
  | 'dash-characters'
  | 'speaker-hyphen'
  | 'okay-spelling'
  | 'lowercase-labels'
  | 'lyrics-notes'
  | 'bbc-characters'
  | 'bbc-colours'
  | 'contrast';

/** A numeric setting of a rule (all settings are numbers, so they can be edited alike). */
export interface ParamSpec {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

/** What a fix does to the item it is offered for. */
export type QualityChange =
  | { kind: 'text'; text: string }
  | { kind: 'times'; startMs: number; endMs: number }
  /** Centre the cue: `align:center`, automatic position. */
  | { kind: 'centre' }
  | { kind: 'delete' };

export interface QualityFix {
  label: string;
  change: QualityChange;
}

export interface QualityFinding {
  rule: QualityRuleId;
  category: QualityCategory;
  severity: QualitySeverity;
  /** Where: a cue (body) or a style sheet (head), by index. */
  list: 'body' | 'head';
  index: number;
  message: string;
  fix?: QualityFix;
}

/** A guide a ruleset follows, as read when the ruleset was written. */
export interface GuideSource {
  id: string;
  title: string;
  /** The edition or revision read, e.g. "2025-12-19". */
  edition: string;
  url?: string;
}

/** A rule as a ruleset uses it. */
export interface RulesetEntry {
  severity: QualitySeverity;
  /** Settings that differ from the rule's defaults. */
  params?: Record<string, number>;
  /** The guide (a `GuideSource` id) and section the rule comes from; none for our own. */
  source?: string;
  section?: string;
}

/**
 * A set of rules, usually one guide's. Adding a guide is adding one of these (see
 * docs/QUALITY-RULES.md); rules a guide needs that no rule covers yet are added to rules.ts.
 */
export interface Ruleset {
  id: string;
  name: string;
  description: string;
  sources: GuideSource[];
  /** Requirements of the guides that cannot be checked from the file, for the record. */
  notChecked: string[];
  rules: Partial<Record<QualityRuleId, RulesetEntry>>;
}

/** A user's changes to a ruleset: rules switched off, and settings changed. */
export interface RuleOverride {
  enabled?: boolean;
  params?: Record<string, number>;
}
export type RuleOverrides = Partial<Record<QualityRuleId, RuleOverride>>;
