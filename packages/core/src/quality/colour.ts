/** CSS colours, as far as subtitle style sheets use them, and WCAG contrast. */

/** sRGB components 0–255 and alpha 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  lime: '#00ff00',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  maroon: '#800000',
  olive: '#808000',
  navy: '#000080',
  purple: '#800080',
  teal: '#008080',
  orange: '#ffa500',
  transparent: '#00000000',
};

const channel = (value: string, max: number): number | null => {
  const v = value.trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return v.endsWith('%') ? (n / 100) * max : n;
};

/** Parses a CSS colour (hex, rgb()/rgba(), or a basic named colour); null when not understood. */
export function parseColour(value: string): Rgba | null {
  const v = value
    .trim()
    .toLowerCase()
    .replace(/\s*!important$/, '');
  const hex = NAMED[v] ?? v;
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(hex);
  if (m) {
    let h = m[1] as string;
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (!m) return null;
  const parts = (m[1] as string).split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const [r, g, b] = parts.slice(0, 3).map((p) => channel(p, 255));
  const a = parts[3] === undefined ? 1 : channel(parts[3], 1);
  if (r == null || g == null || b == null || a == null) return null;
  return { r, g, b, a: Math.min(1, Math.max(0, a)) };
}

/** `top` drawn over the opaque colour `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number): number => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio between two opaque colours. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** "#ffff00" for a colour (alpha dropped). */
export function hexOf({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}
