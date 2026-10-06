import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.ts';
import { THEMES, resolveTheme } from './themes.ts';

describe('themes', () => {
  it('has three light and three dark themes', () => {
    expect(THEMES.filter((t) => t.scheme === 'light')).toHaveLength(3);
    expect(THEMES.filter((t) => t.scheme === 'dark')).toHaveLength(3);
  });

  for (const theme of THEMES) {
    it(`${theme.name} meets WCAG AA`, () => {
      const c = theme.colors;
      const failures: string[] = [];
      const need = (label: string, fg: string, bg: string, min: number): void => {
        const ratio = contrastRatio(fg, bg);
        if (ratio < min) failures.push(`${label}: ${ratio.toFixed(2)} < ${min}`);
      };
      for (const [bgName, bg] of [
        ['bg', c.bg],
        ['surface', c.surface],
      ] as const) {
        for (const role of ['text', 'muted', 'error', 'warning', 'info'] as const) {
          need(`${role} on ${bgName}`, c[role], bg, 4.5);
        }
        need(`control on ${bgName}`, c.control, bg, 3);
        need(`accent on ${bgName}`, c.accent, bg, 3);
      }
      need('text on selected', c.text, c.selected, 4.5);
      need('muted on selected', c.muted, c.selected, 4.5);
      need('onAccent on accent', c.onAccent, c.accent, 4.5);
      expect(failures).toEqual([]);
    });
  }

  it('resolves "system" from the OS preference', () => {
    expect(resolveTheme('system', false).scheme).toBe('light');
    expect(resolveTheme('system', true).scheme).toBe('dark');
    expect(resolveTheme('nord', false).id).toBe('nord');
    expect(resolveTheme('unknown', true).id).toBe(THEMES[0]?.id);
  });
});
