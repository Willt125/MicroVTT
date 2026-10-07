/**
 * Phase 5 acceptance (opt-in, not run in CI): the waveform of long media is computed without
 * memory growing with the media's length. Point WAVEFORM_MEDIA at one or more files (comma
 * separated; `scripts/long-media.sh` makes 1 h and 12 h test files) and run in Chromium:
 *
 *   WAVEFORM_MEDIA=/tmp/long-1h.webm,/tmp/long-12h.webm pnpm e2e --project=chromium acceptance
 *
 * It samples the resident memory of every browser process while the peaks are computed and
 * prints the baseline, the peak and the time taken for each file.
 */
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { mediaInput, openSample } from '../support.ts';

const files = (process.env['WAVEFORM_MEDIA'] ?? '').split(',').filter(Boolean);

/** Total resident memory (MB) of the browser's processes. */
function browserMb(): number {
  const lines = execSync('ps -eo rss=,args=', { encoding: 'utf8' }).split('\n');
  let kb = 0;
  for (const line of lines) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m && /chrom(e|ium)/i.test(m[2] as string) && !/\bps\b|node/.test(m[2] as string)) {
      kb += Number(m[1]);
    }
  }
  return Math.round(kb / 1024);
}

test.describe('waveform memory', () => {
  test.skip(files.length === 0, 'set WAVEFORM_MEDIA to measure');
  test.skip(({ browserName }) => browserName !== 'chromium', 'measured in Chromium');
  test.setTimeout(30 * 60_000);

  for (const file of files) {
    test(file, async ({ page }) => {
      await openSample(page);
      await page.waitForTimeout(1000);
      const baseline = browserMb();
      const started = Date.now();
      await mediaInput(page).setInputFiles(file);
      const timeline = page.locator('.timeline');
      let peak = baseline;
      for (;;) {
        peak = Math.max(peak, browserMb());
        const state = await timeline.getAttribute('data-waveform');
        if (state !== 'loading') {
          expect(state).toBe('ready');
          break;
        }
        await page.waitForTimeout(250);
      }
      const seconds = (Date.now() - started) / 1000;
      const result = {
        file,
        sizeMb: Math.round(statSync(file).size / 1048576),
        baselineMb: baseline,
        peakMb: peak,
        growthMb: peak - baseline,
        seconds: Math.round(seconds),
      };
      console.log(`WAVEFORM-MEMORY ${JSON.stringify(result)}`);
    });
  }
});
