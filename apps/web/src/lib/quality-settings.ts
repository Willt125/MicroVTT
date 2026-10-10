/**
 * The user's choice of style and accessibility rules: which ruleset, and their changes to each
 * ruleset (rules switched off, settings changed). Kept in this browser.
 */
import { RULESETS, type RuleOverrides } from '@microvtt/core';

export interface QualitySettings {
  /** A ruleset id, or '' for no checks. */
  ruleset: string;
  /** Changes per ruleset id. */
  overrides: Record<string, RuleOverrides>;
}

const KEY = 'microvtt.quality';
export const DEFAULT_QUALITY: QualitySettings = { ruleset: 'lite', overrides: {} };

export function loadQualitySettings(): QualitySettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_QUALITY;
    const parsed = JSON.parse(raw) as Partial<QualitySettings>;
    const ruleset =
      parsed.ruleset === '' || RULESETS.some((r) => r.id === parsed.ruleset)
        ? (parsed.ruleset as string)
        : DEFAULT_QUALITY.ruleset;
    const overrides =
      parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {};
    return { ruleset, overrides };
  } catch {
    return DEFAULT_QUALITY;
  }
}

export function saveQualitySettings(settings: QualitySettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not kept (private window, storage blocked): the choice lasts for this session.
  }
}
