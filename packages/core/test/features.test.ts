import { describe, expect, it } from 'vitest';
import {
  FEATURES,
  featureDocument,
  featureTestFile,
  importDocument,
  usedFeatures,
  validate,
  youtubeCheck,
} from '../src/index.ts';

describe('feature catalogue', () => {
  it.each(FEATURES.map((f) => [f.id, f] as const))(
    '%s: the example conforms and is detected',
    (_id, feature) => {
      const text = featureDocument(feature);
      const errors = validate(text).diagnostics.filter((d) => d.severity === 'error');
      expect(errors).toEqual([]);
      expect(feature.count(importDocument(text).document)).toBeGreaterThan(0);
    },
  );

  it('builds a conforming test file that uses every feature', () => {
    const text = featureTestFile();
    expect(validate(text).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const used = usedFeatures(importDocument(text).document).map((u) => u.feature.id);
    expect(new Set(used)).toEqual(new Set(FEATURES.map((f) => f.id)));
  });

  it('reports nothing special for a plain file', () => {
    const doc = importDocument('WEBVTT\n\n00:00.000 --> 00:01.000\nHello & welcome\n').document;
    expect(usedFeatures(doc)).toEqual([]);
  });

  it('can leave features out', () => {
    const text = featureTestFile(6000, ['style', 'region']);
    const used = usedFeatures(importDocument(text).document).map((u) => u.feature.id);
    expect(used).not.toContain('style');
    expect(used).not.toContain('region');
    expect(used).toContain('vertical');
  });

  it('lists every feature YouTube is not known to keep', () => {
    const doc = importDocument(featureTestFile()).document;
    expect(youtubeCheck(doc).length).toBeGreaterThan(0);
    expect(
      youtubeCheck(importDocument('WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n').document),
    ).toEqual([]);
  });
});

describe('docs/youtube-test*.vtt', () => {
  it('are up to date with the catalogue (run: node scripts/youtube-test.mjs)', async () => {
    const { readFileSync } = await import('node:fs');
    // @ts-expect-error -- plain JS module outside the package
    const { render } = (await import('../../../scripts/youtube-test.mjs')) as {
      render: () => Record<string, string>;
    };
    for (const [name, text] of Object.entries(render())) {
      expect(readFileSync(new URL(`../../../docs/${name}`, import.meta.url), 'utf8')).toBe(text);
    }
  });

  it('match the results table in docs/YOUTUBE-TEST.md, in order', async () => {
    const { readFileSync } = await import('node:fs');
    const doc = readFileSync(new URL('../../../docs/YOUTUBE-TEST.md', import.meta.url), 'utf8');
    const rows = [...doc.matchAll(/^\| (\d+) +\| ([\d:]+) +\| `([a-z-]+)`/gm)].map((m) => [
      Number(m[1]),
      m[2],
      m[3],
    ]);
    const at = (i: number): string =>
      `${Math.floor(((i + 1) * 6) / 60)}:${String(((i + 1) * 6) % 60).padStart(2, '0')}`;
    expect(rows).toEqual(FEATURES.map((f, i) => [i + 1, at(i), f.id]));
  });
});
