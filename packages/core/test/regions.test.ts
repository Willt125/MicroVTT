/** Editing regions, and cue placement presets. */
import { describe, expect, it } from 'vitest';
import type { Cue, VttDocument } from '../src/index.ts';
import {
  CUE_PLACEMENTS,
  DEFAULT_CUE_SETTINGS,
  addRegion,
  createCue,
  createRegion,
  deleteRegion,
  exportDocument,
  importDocument,
  nextRegionId,
  regionIdProblem,
  regionUse,
  updateCue,
  updateRegion,
} from '../src/index.ts';

const DOC = importDocument(
  [
    'WEBVTT',
    '',
    'STYLE',
    '::cue { color: lime }',
    '',
    'REGION',
    'id:a',
    '',
    '00:00.000 --> 00:01.000 region:a',
    'one',
    '',
    '00:01.000 --> 00:02.000',
    'two',
    '',
  ].join('\n'),
).document;

const cues = (doc: VttDocument): Cue[] => doc.body.filter((c): c is Cue => c.type === 'cue');

describe('regions', () => {
  it('adds a region after the others, with a fresh id', () => {
    expect(nextRegionId(DOC)).toBe('region1');
    const doc = addRegion(DOC);
    expect(doc.head.map((h) => (h.type === 'region' ? h.id : h.type))).toEqual([
      'style',
      'a',
      'region1',
    ]);
    expect(nextRegionId(doc)).toBe('region2');
    expect(() => addRegion(DOC, createRegion('a'))).toThrow('There is already a region "a".');
  });

  it('checks ids', () => {
    expect(regionIdProblem(DOC, '')).toBe('A region needs an id.');
    expect(regionIdProblem(DOC, 'a b')).toBe('A region id cannot contain spaces.');
    expect(regionIdProblem(DOC, 'a-->b')).toBe('A region id cannot contain "-->".');
    expect(regionIdProblem(DOC, 'a')).toBe('There is already a region "a".');
    expect(regionIdProblem(DOC, 'a', 'a')).toBeNull();
    expect(regionIdProblem(DOC, 'top')).toBeNull();
  });

  it('renames a region in its cues too, and checks values', () => {
    const doc = updateRegion(DOC, 'a', { id: 'top', width: 40, lines: 2, viewportAnchorY: 10 });
    expect(cues(doc)[0]?.region).toBe('top');
    expect(regionUse(doc)).toEqual(new Map([['top', 1]]));
    const out = exportDocument(doc);
    expect(out.text).toContain('REGION\nid:top width:40% lines:2 viewportanchor:0%,10%\n');
    expect(out.text).toContain('region:top');
    expect(() => updateRegion(DOC, 'a', { width: 120 })).toThrow('Width must be 0–100%.');
    expect(() => updateRegion(DOC, 'a', { lines: 1.5 })).toThrow('Lines must be a whole number');
    expect(() => updateRegion(DOC, 'nope', {})).toThrow('No region "nope".');
  });

  it('deletes a region, leaving its cues in none', () => {
    const doc = deleteRegion(DOC, 'a');
    expect(doc.head.some((h) => h.type === 'region')).toBe(false);
    expect(cues(doc).map((c) => c.region)).toEqual([null, null]);
  });
});

describe('cue placement', () => {
  it('places a cue at the top, in the middle or back at the bottom', () => {
    const cue = createCue(0, 1000, 'x');
    const top = updateCue(cue, CUE_PLACEMENTS.find((p) => p.id === 'top')!.update);
    expect(top).toMatchObject({ line: 0, snapToLines: true });
    const middle = updateCue(top, CUE_PLACEMENTS.find((p) => p.id === 'middle')!.update);
    expect(middle).toMatchObject({ line: 50, snapToLines: false, lineAlign: 'center' });
    const reset = updateCue({ ...middle, size: 50, align: 'left' }, DEFAULT_CUE_SETTINGS);
    expect(reset).toEqual(cue);
  });
});
