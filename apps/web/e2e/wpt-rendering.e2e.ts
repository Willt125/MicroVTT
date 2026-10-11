/**
 * The spec renderer against web-platform-tests' WebVTT rendering reftests
 * (tests/wpt/rendering, vendored by scripts/sync-wpt.sh). Each test plays a track over a video
 * and is compared with a reference page drawn in plain HTML and CSS. Here the test's track is
 * rendered by our renderer instead, at the time the test takes its screenshot, with the test
 * page's ::cue styles, and both are compared pixel by pixel. Tests that need the media element
 * itself (the JavaScript API, controls, seeking, resizing) are listed as not applicable, and
 * known differences in EXPECTED_FAILURES, each with its reason.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { ADJUSTED, EXPECTED_FAILURES, NOT_APPLICABLE } from './wpt-rendering-expectations.ts';

const ROOT = fileURLToPath(new URL('../../../tests/wpt/rendering/', import.meta.url));
const HOST = 'http://wpt.test';

/** Test pages: every .html that is not a reference and not support material. */
function testPages(dir = ROOT): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'support' ? [] : testPages(path);
    return name.endsWith('.html') && !/-ref|-expected|-ref-\d/.test(name)
      ? [relative(ROOT, path)]
      : [];
  });
}

interface WptTrack {
  text: string;
  language: string | undefined;
}

interface WptTest {
  path: string;
  ref: string;
  tracks: WptTrack[];
  css: string;
  timeMs: number | null;
  width: number;
  height: number;
  /** Changes cues, the video or the page with script after loading. */
  scripted: boolean;
}

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*["']?([^"'\\s>]+)`, 'i').exec(tag)?.[1];

function readTest(path: string): WptTest | null {
  const html = readFileSync(join(ROOT, path), 'utf8');
  const dir = dirname(path);
  const ref = attr(/<link[^>]*rel=["']?match[^>]*>/i.exec(html)?.[0] ?? '', 'href') ?? '';
  const tracks = [...html.matchAll(/<track[^>]*>/gi)].flatMap((m): WptTrack[] => {
    const src = attr(m[0], 'src');
    return src === undefined
      ? []
      : [{ text: readFileSync(join(ROOT, dir, src), 'utf8'), language: attr(m[0], 'srclang') }];
  });
  const sheets = [...html.matchAll(/<link[^>]*rel=["']?stylesheet[^>]*>/gi)]
    .map((m) => attr(m[0], 'href'))
    .filter((href): href is string => href !== undefined && !href.startsWith('/'))
    .map((href) => readFileSync(join(ROOT, dir, href), 'utf8'));
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] as string);
  const time = /currentTime\s*(?:=|>=)\s*([\d.]+)/.exec(html)?.[1];
  const video = /<video[^>]*>/i.exec(html)?.[0] ?? '';
  return {
    path,
    ref: ref && join(dir, ref),
    tracks,
    css: [...sheets, ...styles].join('\n'),
    timeMs: time === undefined ? null : Math.round(Number(time) * 1000),
    width: Number(attr(video, 'width') ?? 320),
    height: Number(attr(video, 'height') ?? 180),
    scripted:
      /addTextTrack|new VTTCue|\.addCue|removeCue|\.text\s*=|\bcontrols\b|location|\.style\.|\.(line|position|size|align)\s*=|<audio/.test(
        html,
      ),
  };
}

/** The start of the earliest cue: when tests that wait for an active cue take their picture. */
function firstCueStart(tracks: WptTrack[]): number {
  return Math.min(
    ...tracks.flatMap((t) =>
      [...t.text.matchAll(/(?:(\d+):)?(\d\d):(\d\d)\.(\d{3})[ \t]+-->/g)].map(
        (m) =>
          (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 1000 +
          Number(m[4] ?? 0),
      ),
    ),
  );
}

let bundle = '';

test.beforeAll(async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'wpt-render-'));
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./wpt-render-entry.ts', import.meta.url)),
        formats: ['iife'],
        name: 'WptRender',
        fileName: () => 'harness.js',
      },
    },
  });
  bundle = readFileSync(join(outDir, 'harness.js'), 'utf8');
});

const AHEM = readFileSync(join(ROOT, 'Ahem.ttf'));
const TYPES: Record<string, string> = {
  html: 'text/html',
  css: 'text/css',
  vtt: 'text/vtt',
  png: 'image/png',
  gif: 'image/gif',
  js: 'text/javascript',
};

/** Serves the vendored tests (and Ahem) at HOST. */
async function serve(page: Page): Promise<void> {
  await page.route(`${HOST}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/fonts/ahem.css')
      return route.fulfill({
        contentType: 'text/css',
        body: "@font-face { font-family: 'Ahem'; src: url('/fonts/Ahem.ttf'); }",
      });
    if (path === '/fonts/Ahem.ttf') return route.fulfill({ contentType: 'font/ttf', body: AHEM });
    if (path === '/harness.js')
      return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (path === '/harness.html') {
      const q = new URL(route.request().url()).searchParams;
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><style>html { overflow: hidden } body { margin: 0 }
          @font-face { font-family: Ahem; src: url(/fonts/Ahem.ttf) }</style>
          <div id="video" style="position: relative; overflow: hidden; background: white;
            width: ${q.get('w')}px; height: ${q.get('h')}px"></div>
          <script src="/harness.js"></script>`,
      });
    }
    try {
      const body = readFileSync(join(ROOT, decodeURIComponent(path)));
      return route.fulfill({
        contentType: TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream',
        body,
      });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
}

/** Differing pixels between two PNG screenshots, counted in the browser. */
async function diffPixels(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([x, y]: [string, string]) => {
      const load = async (data: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const [p, q] = await Promise.all([load(x), load(y)]);
      let n = 0;
      for (let i = 0; i < p.length; i += 4)
        if ([0, 1, 2].some((c) => Math.abs((p[i + c] as number) - (q[i + c] as number)) > 24)) n++;
      return n;
    },
    [a.toString('base64'), b.toString('base64')] as [string, string],
  );
}

/** Where two screenshots differ, for WPT_REPORT: bounding boxes and a coarse map. */
async function diffDetails(page: Page, a: Buffer, b: Buffer): Promise<string> {
  return page.evaluate(
    async ([x, y]: [string, string]) => {
      const load = async (data: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.drawImage(img, 0, 0);
        return {
          w: img.width,
          h: img.height,
          d: ctx.getImageData(0, 0, img.width, img.height).data,
        };
      };
      const [p, q] = await Promise.all([load(x), load(y)]);
      const { w, h } = p;
      type Box = [number, number, number, number];
      const box = (test: (i: number) => boolean): Box | null => {
        let b: Box | null = null;
        for (let yy = 0; yy < h; yy++)
          for (let xx = 0; xx < w; xx++)
            if (test((yy * w + xx) * 4)) {
              b = b
                ? [Math.min(b[0], xx), Math.min(b[1], yy), Math.max(b[2], xx), Math.max(b[3], yy)]
                : [xx, yy, xx, yy];
            }
        return b;
      };
      const dark = (d: Uint8ClampedArray) => (i: number) =>
        (d[i] as number) + (d[i + 1] as number) + (d[i + 2] as number) < 384;
      const differs = (i: number) =>
        [0, 1, 2].some((c) => Math.abs((p.d[i + c] as number) - (q.d[i + c] as number)) > 24);
      const fmt = (b: Box | null) => (b ? `${b[0]},${b[1]}-${b[2]},${b[3]}` : 'none');
      // One character per 4×4 cell: '#' some pixel differs, 'o' only ours is dark, 'r' only the reference.
      const rows: string[] = [];
      for (let cy = 0; cy < h; cy += 4) {
        let row = '';
        for (let cx = 0; cx < w; cx += 4) {
          let diff = false;
          let ours = false;
          let ref = false;
          for (let yy = cy; yy < Math.min(h, cy + 4); yy++)
            for (let xx = cx; xx < Math.min(w, cx + 4); xx++) {
              const i = (yy * w + xx) * 4;
              if (differs(i)) {
                diff = true;
                if (dark(p.d)(i)) ours = true;
                if (dark(q.d)(i)) ref = true;
              }
            }
          row += !diff ? '.' : ours && !ref ? 'o' : ref && !ours ? 'r' : '#';
        }
        if (/[#or]/.test(row)) rows.push(`${String(cy).padStart(3)} ${row}`);
      }
      return [
        `ours dark ${fmt(box(dark(p.d)))}; reference dark ${fmt(box(dark(q.d)))}; differing ${fmt(box(differs))}`,
        ...rows,
      ].join('\n');
    },
    [a.toString('base64'), b.toString('base64')] as [string, string],
  );
}

/** Pixels allowed to differ (anti-aliasing at glyph and box edges). */
const TOLERANCE = 12;

for (const path of testPages().sort()) {
  const name = path.replace(/\.html$/, '');
  test(`WPT rendering: ${name}`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium' && process.env['WPT_ALL_BROWSERS'] !== '1', 'Chromium');
    const wpt = readTest(path);
    const reason =
      NOT_APPLICABLE[name] ??
      (wpt?.scripted
        ? 'drives the media element (JavaScript API, controls, seeking or resizing)'
        : undefined);
    test.skip(reason !== undefined, reason);
    test.skip(wpt === null || !wpt.ref || wpt.tracks.length === 0, 'no reference or track');
    if (!wpt) return;
    await serve(page);
    const clip = { x: 0, y: 0, width: wpt.width, height: wpt.height };
    const adjusted = ADJUSTED[name];

    /** Our rendering of a page's tracks, with its ::cue styles, at its screenshot time. */
    const render = async (t: WptTest, adjustment = ''): Promise<Buffer> => {
      await page.goto(`${HOST}/harness.html?w=${t.width}&h=${t.height}`);
      await page.evaluate(() => document.fonts.load('10px Ahem'));
      await page.evaluate(
        ([tracks, css, time, extra]) => window.renderWpt(tracks, css, time, extra),
        [t.tracks, t.css, t.timeMs ?? firstCueStart(t.tracks), adjustment] as const,
      );
      return page.screenshot({ clip });
    };

    // The reference: a plain HTML and CSS page, or (for tests of equivalence between two ways
    // of styling) another video page, which we render too.
    const reference = readTest(wpt.ref);
    let expected: Buffer;
    if (reference && reference.tracks.length > 0) {
      expected = await render(reference);
    } else {
      await page.goto(`${HOST}/${wpt.ref}`);
      await page.evaluate(() => document.fonts.ready);
      expected = await page.screenshot({ clip });
    }
    const actual = await render(wpt, adjusted?.css);

    const differing = await diffPixels(page, actual, expected);
    const failure = EXPECTED_FAILURES[name];
    // WPT_REPORT=1: one line per test, for comparing browsers from a CI log.
    if (process.env['WPT_REPORT'] === '1') {
      const limit = adjusted?.tolerance ?? TOLERANCE;
      const verdict = failure ? 'expected-failure' : differing <= limit ? 'pass' : 'FAIL';
      console.log(`WPT-RESULT\t${browserName}\t${name}\t${differing}\t${verdict}`);
      if (verdict === 'FAIL')
        console.log(
          (await diffDetails(page, actual, expected))
            .split('\n')
            .map((line) => `WPT-DETAIL\t${browserName}\t${name}\t${line}`)
            .join('\n'),
        );
    }
    if (adjusted) test.info().annotations.push({ type: 'adjusted', description: adjusted.reason });
    if (failure) {
      test.info().annotations.push({ type: 'expected failure', description: failure });
      expect(differing, `now passes: remove it from EXPECTED_FAILURES`).toBeGreaterThan(TOLERANCE);
    } else {
      if (differing > TOLERANCE) {
        await test.info().attach('ours', { body: actual, contentType: 'image/png' });
        await test.info().attach('reference', { body: expected, contentType: 'image/png' });
      }
      expect(differing, 'pixels differing from the reference').toBeLessThanOrEqual(
        adjusted?.tolerance ?? TOLERANCE,
      );
    }
  });
}
