/**
 * Editing regions and placing cues: pure operations on the document, for the cue settings
 * panel and the regions editor.
 */
import { createRegion, type Cue, type Region, type VttDocument } from './document.ts';
import type { CueUpdate } from './edit.ts';

/** The settings of a cue that has none (VTTCue's defaults). */
export const DEFAULT_CUE_SETTINGS: Required<
  Pick<
    CueUpdate,
    | 'region'
    | 'vertical'
    | 'snapToLines'
    | 'line'
    | 'lineAlign'
    | 'position'
    | 'positionAlign'
    | 'size'
    | 'align'
  >
> = {
  region: null,
  vertical: '',
  snapToLines: true,
  line: 'auto',
  lineAlign: 'start',
  position: 'auto',
  positionAlign: 'auto',
  size: 100,
  align: 'center',
};

/** Common vertical placements, as cue setting changes. */
export const CUE_PLACEMENTS: readonly { id: string; label: string; update: CueUpdate }[] = [
  {
    id: 'bottom',
    label: 'Bottom',
    update: { line: 'auto', snapToLines: true, lineAlign: 'start' },
  },
  { id: 'top', label: 'Top', update: { line: 0, snapToLines: true, lineAlign: 'start' } },
  {
    id: 'middle',
    label: 'Middle',
    update: { line: 50, snapToLines: false, lineAlign: 'center' },
  },
];

/**
 * Why `id` cannot be a region id in `doc` (`except` is the region being renamed), or null if it
 * can. Ids are written as `id:…` in a REGION block and `region:…` in cue settings, so they may
 * not contain white space or "-->", and must be unique.
 */
export function regionIdProblem(doc: VttDocument, id: string, except?: string): string | null {
  if (id === '') return 'A region needs an id.';
  if (/\s/.test(id)) return 'A region id cannot contain spaces.';
  if (id.includes('-->')) return 'A region id cannot contain "-->".';
  if (id !== except && doc.head.some((h) => h.type === 'region' && h.id === id))
    return `There is already a region "${id}".`;
  return null;
}

/** An id no region in `doc` has: "region1", "region2", … */
export function nextRegionId(doc: VttDocument): string {
  const ids = new Set(doc.head.flatMap((h) => (h.type === 'region' ? [h.id] : [])));
  let n = 1;
  while (ids.has(`region${n}`)) n++;
  return `region${n}`;
}

/** Adds a region (after the last REGION block, or first in the header). */
export function addRegion(
  doc: VttDocument,
  region: Region = createRegion(nextRegionId(doc)),
): VttDocument {
  const problem = regionIdProblem(doc, region.id);
  if (problem) throw new RangeError(problem);
  const last = doc.head.reduce((at, h, i) => (h.type === 'region' ? i : at), -1);
  const head = [...doc.head];
  head.splice(last + 1, 0, region);
  return { ...doc, head };
}

export type RegionUpdate = Partial<Omit<Region, 'type' | 'source'>>;

const percent = (name: string, v: number): void => {
  if (!Number.isFinite(v) || v < 0 || v > 100) throw new RangeError(`${name} must be 0–100%.`);
};

/**
 * Changes the region `id`. Renaming it renames it in every cue that uses it. Values are checked
 * as VTTRegion checks them: percentages 0–100, lines a whole number ≥ 0.
 */
export function updateRegion(doc: VttDocument, id: string, update: RegionUpdate): VttDocument {
  const index = doc.head.findIndex((h) => h.type === 'region' && h.id === id);
  if (index === -1) throw new RangeError(`No region "${id}".`);
  const next: Region = { ...(doc.head[index] as Region), ...update };
  delete next.source;
  if (update.id !== undefined && update.id !== id) {
    const problem = regionIdProblem(doc, update.id, id);
    if (problem) throw new RangeError(problem);
  }
  percent('Width', next.width);
  percent('The region anchor', next.regionAnchorX);
  percent('The region anchor', next.regionAnchorY);
  percent('The viewport anchor', next.viewportAnchorX);
  percent('The viewport anchor', next.viewportAnchorY);
  if (!Number.isInteger(next.lines) || next.lines < 0)
    throw new RangeError('Lines must be a whole number, 0 or more.');
  const head = [...doc.head];
  head[index] = next;
  const body =
    next.id === id
      ? doc.body
      : doc.body.map((item) =>
          item.type === 'cue' && item.region === id ? { ...item, region: next.id } : item,
        );
  return { ...doc, head, body };
}

/** Deletes the region `id`; the cues in it are left in no region. */
export function deleteRegion(doc: VttDocument, id: string): VttDocument {
  return {
    ...doc,
    head: doc.head.filter((h) => !(h.type === 'region' && h.id === id)),
    body: doc.body.map((item) =>
      item.type === 'cue' && item.region === id ? ({ ...item, region: null } as Cue) : item,
    ),
  };
}

/** How many cues use each region. */
export function regionUse(doc: VttDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of doc.body)
    if (item.type === 'cue' && item.region !== null)
      counts.set(item.region, (counts.get(item.region) ?? 0) + 1);
  return counts;
}
