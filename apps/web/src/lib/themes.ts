/**
 * Color themes. Six widely used, openly licensed (MIT) color schemes: three light, three dark.
 *
 * Each theme keeps its official background, surface, text and accent colors. Where an official
 * color fails WCAG 2.x AA in the role we use it for (4.5:1 for text, 3:1 for control borders and
 * focus indicators), it is shifted toward black (light themes) or white (dark themes) by the
 * smallest step that passes, keeping its hue. Those are marked "AA-adjusted" with the original.
 * `themes.test.ts` checks every pair.
 */

export interface ThemeColors {
  /** App background. */
  bg: string;
  /** Panels, toolbar, table header. */
  surface: string;
  /** Selected row / hover. */
  selected: string;
  text: string;
  /** Secondary text (row numbers, labels). Must still be readable: 4.5:1. */
  muted: string;
  /** Focus rings, selected-row marker, primary buttons. */
  accent: string;
  /** Text on accent backgrounds. */
  onAccent: string;
  /** Borders of inputs and buttons (3:1 against bg and surface). */
  control: string;
  /** Decorative separators (no contrast requirement). */
  border: string;
  error: string;
  warning: string;
  info: string;
}

export interface Theme {
  id: string;
  name: string;
  scheme: 'light' | 'dark';
  /** Where the palette comes from. */
  source: string;
  colors: ThemeColors;
}

export const THEMES: readonly Theme[] = [
  {
    id: 'github-light',
    name: 'GitHub Light',
    scheme: 'light',
    source: 'Primer primitives (MIT), https://primer.style',
    colors: {
      bg: '#ffffff',
      surface: '#f6f8fa',
      selected: '#ddf4ff',
      text: '#1f2328',
      muted: '#59636e',
      accent: '#0969da',
      onAccent: '#ffffff',
      control: '#818b98',
      border: '#d1d9e0',
      error: '#d1242f',
      warning: '#9a6700',
      info: '#0969da',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    scheme: 'light',
    source: 'Solarized by Ethan Schoonover (MIT), https://ethanschoonover.com/solarized',
    colors: {
      bg: '#fdf6e3', // base3
      surface: '#eee8d5', // base2
      selected: '#e4ddc8',
      text: '#073642', // base02
      muted: '#51656c', // AA-adjusted base01 #586e75
      accent: '#1e6ca4', // AA-adjusted blue #268bd2
      onAccent: '#fdf6e3',
      control: '#7b8787', // AA-adjusted base1 #93a1a1
      border: '#e0d9c4',
      error: '#c42d2a', // AA-adjusted red #dc322f
      warning: '#846400', // AA-adjusted yellow #b58900
      info: '#1e6ca4', // AA-adjusted blue #268bd2
    },
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    scheme: 'light',
    source: 'Catppuccin (MIT), https://catppuccin.com',
    colors: {
      bg: '#eff1f5', // base
      surface: '#e6e9ef', // mantle
      selected: '#ccd0da', // surface0
      text: '#4c4f69', // text
      muted: '#56586f', // AA-adjusted subtext1 #5c5f77
      accent: '#1e66f5', // blue
      onAccent: '#ffffff',
      control: '#828596', // AA-adjusted overlay1 #8c8fa1
      border: '#dce0e8', // crust
      error: '#d00f38', // AA-adjusted red #d20f39
      warning: '#915c13', // AA-adjusted yellow #df8e1d
      info: '#1c5fe4', // AA-adjusted blue #1e66f5
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    scheme: 'dark',
    source: 'Dracula (MIT), https://draculatheme.com',
    colors: {
      bg: '#282a36', // background
      surface: '#21222c',
      selected: '#44475a', // current line
      text: '#f8f8f2', // foreground
      muted: '#adb6d0', // AA-adjusted comment #6272a4
      accent: '#bd93f9', // purple
      onAccent: '#282a36',
      control: '#6272a4', // comment
      border: '#343746',
      error: '#ff5555', // red
      warning: '#f1fa8c', // yellow
      info: '#8be9fd', // cyan
    },
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    scheme: 'dark',
    source: 'Atom One Dark syntax and UI themes (MIT), https://github.com/atom/atom',
    colors: {
      bg: '#282c34', // syntax background
      surface: '#21252b', // UI base
      selected: '#2c313c', // current-line highlight
      text: '#d7dae0', // UI text-highlight
      muted: '#9da5b4', // UI text
      accent: '#61afef', // blue
      onAccent: '#282c34',
      control: '#707681', // AA-adjusted mono-3 #5c6370
      border: '#181a1f',
      error: '#e17079', // AA-adjusted red #e06c75
      warning: '#e5c07b', // yellow
      info: '#56b6c2', // cyan
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    scheme: 'dark',
    source: 'Nord by Arctic Ice Studio (MIT), https://www.nordtheme.com',
    colors: {
      bg: '#2e3440', // nord0
      surface: '#3b4252', // nord1
      selected: '#434c5e', // nord2
      text: '#eceff4', // nord6
      muted: '#d8dee9', // nord4
      accent: '#88c0d0', // nord8
      onAccent: '#2e3440',
      control: '#878e9b', // AA-adjusted nord3 #4c566a
      border: '#434c5e', // nord2
      error: '#d89fa4', // AA-adjusted nord11 #bf616a
      warning: '#ebcb8b', // nord13
      info: '#88c0d0', // nord8
    },
  },
];

/** The theme used for "System" in each color scheme. */
export const SYSTEM_DEFAULTS = { light: 'github-light', dark: 'dracula' } as const;

export const SYSTEM = 'system';

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? (THEMES[0] as Theme);
}

const cssName = (key: string): string => `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** CSS for all themes, keyed by `html[data-theme="…"]`. */
export function themeStylesheet(): string {
  return THEMES.map((t) => {
    const vars = Object.entries(t.colors)
      .map(([k, v]) => `${cssName(k)}: ${v};`)
      .join(' ');
    return `html[data-theme='${t.id}'] { color-scheme: ${t.scheme}; ${vars} }`;
  }).join('\n');
}

const STORAGE_KEY = 'microvtt.theme';

/** The saved choice ("system" or a theme id). Storage can be unavailable; that is fine. */
export function loadThemeChoice(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === SYSTEM || THEMES.some((t) => t.id === saved)) return saved as string;
  } catch {
    // Private mode or blocked storage: fall back to the system theme.
  }
  return SYSTEM;
}

export function saveThemeChoice(choice: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}

/** Resolves "system" against the OS preference. */
export function resolveTheme(choice: string, prefersDark: boolean): Theme {
  if (choice === SYSTEM) return themeById(SYSTEM_DEFAULTS[prefersDark ? 'dark' : 'light']);
  return themeById(choice);
}
