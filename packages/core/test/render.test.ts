import { describe, expect, it } from 'vitest';
import type { Cue, Region } from '../src/index.ts';
import {
  activeCues,
  baseDirection,
  computedLine,
  computedPosition,
  computedPositionAlign,
  createCue,
  cueBoxSettings,
  cueInRegionLeft,
  regionBoxSettings,
  scopeCueStylesheet,
} from '../src/index.ts';

const cue = (settings: Partial<Cue> = {}, text = 'Hello'): Cue => ({
  ...createCue(0, 1000, text),
  ...settings,
});

const region = (settings: Partial<Region> = {}): Region => ({
  type: 'region',
  id: 'r',
  width: 100,
  lines: 3,
  regionAnchorX: 0,
  regionAnchorY: 100,
  viewportAnchorX: 0,
  viewportAnchorY: 100,
  scroll: '',
  ...settings,
});

describe('cue settings (§7.2)', () => {
  it('computes the line, position and position alignment', () => {
    expect(computedLine(cue())).toBe(-1);
    expect(computedLine(cue(), 1)).toBe(-2);
    expect(computedLine(cue({ line: 3 }))).toBe(3);
    expect(computedLine(cue({ line: 120, snapToLines: false }))).toBe(100);
    expect(computedLine(cue({ snapToLines: false }))).toBe(100);
    expect(computedPosition(cue())).toBe(50);
    expect(computedPosition(cue({ align: 'left' }))).toBe(0);
    expect(computedPosition(cue({ align: 'right' }))).toBe(100);
    expect(computedPosition(cue({ position: 30, align: 'right' }))).toBe(30);
    expect(computedPositionAlign(cue({ align: 'start' }))).toBe('line-left');
    expect(computedPositionAlign(cue({ align: 'start' }, 'שלום'))).toBe('line-right');
    expect(computedPositionAlign(cue({ align: 'end' }, '<v Bob>שלום</v>'))).toBe('line-left');
    expect(computedPositionAlign(cue({ align: 'end', positionAlign: 'center' }))).toBe('center');
  });

  it('finds the base direction from the first strong character', () => {
    expect(baseDirection('123 abc')).toBe('ltr');
    expect(baseDirection('123 שלום abc')).toBe('rtl');
    expect(baseDirection('\u2067abc\u2069 שלום')).toBe('rtl'); // Isolated text is skipped.
    expect(baseDirection('\u200fabc')).toBe('rtl');
    expect(baseDirection('...')).toBe('ltr');
  });

  it('sizes and places the box', () => {
    // Centred at 50%: the full width.
    expect(cueBoxSettings(cue())).toMatchObject({ size: 100, x: 0, y: 0, line: -1 });
    // Centred at 30%: at most 60% wide, starting at 0.
    expect(cueBoxSettings(cue({ position: 30 }))).toMatchObject({ size: 60, x: 0 });
    // Centred at 70% with size 50: 50 wide, from 45.
    expect(cueBoxSettings(cue({ position: 70, size: 50 }))).toMatchObject({ size: 50, x: 45 });
    // Line-left at 25%: at most 75%.
    expect(cueBoxSettings(cue({ position: 25, positionAlign: 'line-left' }))).toMatchObject({
      size: 75,
      x: 25,
    });
    // Line-right at 80% with size 30: from 50.
    expect(
      cueBoxSettings(cue({ position: 80, positionAlign: 'line-right', size: 30 })),
    ).toMatchObject({ size: 30, x: 50 });
    // A percentage line puts the box there directly.
    expect(cueBoxSettings(cue({ line: 25, snapToLines: false }))).toMatchObject({ y: 25 });
    // Vertical cues swap the axes.
    expect(cueBoxSettings(cue({ vertical: 'rl', position: 30 }))).toMatchObject({
      writingMode: 'vertical-rl',
      y: 0,
      x: 0,
      size: 60,
    });
    expect(cueBoxSettings(cue({ vertical: 'lr' })).writingMode).toBe('vertical-lr');
  });

  it('places regions and cues in them (§7.1)', () => {
    expect(regionBoxSettings(region())).toEqual({ width: 100, height: 18, left: 0, top: 82 });
    expect(
      regionBoxSettings(
        region({
          width: 40,
          regionAnchorX: 50,
          viewportAnchorX: 50,
          regionAnchorY: 0,
          viewportAnchorY: 10,
        }),
      ),
    ).toEqual({ width: 40, height: 18, left: 30, top: 10 });
    expect(cueInRegionLeft(cue(), region({ width: 40 }))).toBe(0); // 50% of 40, minus 20.
    expect(cueInRegionLeft(cue({ align: 'left' }), region({ width: 40 }))).toBe(0);
    expect(
      cueInRegionLeft(cue({ position: 100, positionAlign: 'line-left' }), region({ width: 40 })),
    ).toBe(40);
  });

  it('lists active cues in text track cue order', () => {
    const a = { ...createCue(0, 5000, 'a') };
    const b = { ...createCue(0, 9000, 'b') };
    const c = { ...createCue(2000, 3000, 'c') };
    expect(activeCues([a, b, c], 2500).map((x) => x.text)).toEqual(['b', 'a', 'c']);
    expect(activeCues([a, b, c], 5000).map((x) => x.text)).toEqual(['b']);
  });
});

describe('style sheets (§8)', () => {
  const scope = '[data-t="0"]';
  it('maps ::cue to the cue, its background to the background box', () => {
    expect(
      scopeCueStylesheet('::cue { color: lime; background: red; width: 10px }', scope, true),
    ).toBe(`${scope} .vtt-cue { color: lime; }\n${scope} .vtt-cue > .vtt-bg { background: red; }`);
  });

  it('rewrites ::cue() selectors for the node elements', () => {
    const out = scopeCueStylesheet(
      '::cue(c.yellow), ::cue(v[voice="Esme"]) { color: yellow; font-size: 2em }',
      scope,
      true,
    );
    expect(out).toBe(
      `${scope} c.yellow, ${scope} v[voice="Esme"] { color: yellow; font-size: 2em; }`,
    );
    expect(scopeCueStylesheet('::cue(#intro) { color: red }', scope, true)).toBe(
      `${scope} [data-vtt-id="intro"] { color: red; }`,
    );
    expect(scopeCueStylesheet('::cue(span) { color: red }', scope, true)).toBe(
      `${scope} vtt-none { color: red; }`,
    );
    expect(scopeCueStylesheet('::cue(*) { color: red }', scope, true)).toBe(
      `${scope} :is(.vtt-cue, .vtt-node) { color: red; }`,
    );
  });

  it('keeps sizing properties out of :past and :future rules', () => {
    expect(scopeCueStylesheet('::cue(:past) { color: grey; font-size: 30px }', scope, true)).toBe(
      `${scope} .vtt-past { color: grey; }`,
    );
  });

  it('scopes regions by id', () => {
    expect(scopeCueStylesheet('::cue-region(#fred) { color: red; top: 0 }', scope, true)).toBe(
      `${scope} .vtt-region[data-vtt-region-id="fred"] { color: red; }`,
    );
    expect(scopeCueStylesheet('::cue-region(.x) { color: red }', scope, true)).toBe('');
  });

  it('applies STYLE blocks only to the track, and page styles through the video', () => {
    expect(scopeCueStylesheet('video::cue { color: red }', scope, true)).toBe('');
    expect(scopeCueStylesheet('video::cue { color: red }', scope, false)).toBe(
      `${scope} .vtt-cue { color: red; }`,
    );
  });

  it('blocks imports and URLs other than data:', () => {
    const out = scopeCueStylesheet(
      '@import url(x.css); ::cue { background: url(http://x/a.png); color: lime; background-image: url(data:image/png;base64,AA) }',
      scope,
      true,
    );
    expect(out).toBe(
      `${scope} .vtt-cue { color: lime; }\n${scope} .vtt-cue > .vtt-bg { background-image: url(data:image/png;base64,AA); }`,
    );
  });

  it('keeps media queries', () => {
    expect(
      scopeCueStylesheet('@media (min-width: 1px) { ::cue { color: lime } }', scope, true),
    ).toBe(`@media (min-width: 1px) { ${scope} .vtt-cue { color: lime; } }`);
  });
});
