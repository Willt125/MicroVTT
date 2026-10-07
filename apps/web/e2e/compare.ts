/** Comparing another parser's cues with ours, cue by cue and attribute by attribute. */
import type { CueView } from '../../../packages/core/test/wpt-support.ts';

export interface NativeResult {
  /** True when the track loaded (false when the browser rejected the file). */
  loaded: boolean;
  cues: CueView[];
}

/** Numbers parsed from text may differ in the last bit depending on evaluation order. */
export const close = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number'
    ? a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a))
    : a === b;

/** Human-readable differences between the browser's cues and ours. */
export function differences(
  native: NativeResult,
  ours: CueView[],
  expectLoaded: boolean,
  skip: readonly string[],
): string[] {
  const out: string[] = [];
  if (native.loaded !== expectLoaded)
    out.push(`track ${native.loaded ? 'loaded' : 'failed to load'}, expected the opposite`);
  if (native.cues.length !== ours.length) {
    out.push(`${native.cues.length} cues, expected ${ours.length}`);
    return out;
  }
  native.cues.forEach((n, i) => {
    const o = ours[i] as CueView;
    for (const key of Object.keys(o) as (keyof CueView)[]) {
      if (skip.includes(key)) continue;
      if (key === 'region') {
        const nr = n.region;
        const or = o.region;
        if (!nr || !or) {
          if (nr !== or)
            out.push(`cue ${i} region: ${nr?.id ?? 'null'}, expected ${or?.id ?? 'null'}`);
          continue;
        }
        for (const rk of Object.keys(or) as (keyof typeof or)[])
          if (!close(nr[rk], or[rk]))
            out.push(
              `cue ${i} region.${rk}: ${JSON.stringify(nr[rk])}, expected ${JSON.stringify(or[rk])}`,
            );
      } else if (!close(n[key], o[key])) {
        out.push(`cue ${i} ${key}: ${JSON.stringify(n[key])}, expected ${JSON.stringify(o[key])}`);
      }
    }
  });
  return out;
}
