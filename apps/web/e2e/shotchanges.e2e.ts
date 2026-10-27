/** Shot changes: marking them with C, importing and saving lists, and Netflix's timing rule. */
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mediaInput, mediaTime, selectedCells, status, vttInput, wav } from './support.ts';

const timeline = (page: Page) => page.getByRole('region', { name: 'Timeline' });
const quality = (page: Page) =>
  page.getByRole('complementary', { name: 'Style and accessibility' });

async function open(page: Page, text: string, media: string): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles({
    name: 'q.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from(text),
  });
  await expect(status(page)).toContainText('q.vtt');
  await mediaInput(page).setInputFiles(media);
  await expect(timeline(page)).toBeVisible();
}

test('marks a shot change at the playhead with C, removes it, and keeps it for the video', async ({
  page,
}, testInfo) => {
  // A file on disk keeps its modification time, which identifies it (with its name and size).
  const media = testInfo.outputPath('cuts.wav');
  writeFileSync(media, wav(20));
  await open(page, 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello\n', media);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('l');
  await page.keyboard.press('l');
  // Two seconds on from the selected cue's start, where the playhead begins.
  await expect.poll(() => mediaTime(page)).toBe(3000);
  await page.keyboard.press('c');
  await expect(timeline(page)).toContainText('Shot change marked at 00:00:03.000.');
  await expect(timeline(page).getByRole('button', { name: 'Shot changes (1)' })).toBeVisible();
  await expect(timeline(page)).toHaveAttribute('data-cuts', '1');
  // The same key at the same place takes it off.
  await page.keyboard.press('c');
  await expect(timeline(page)).toContainText('Shot change removed at 00:00:03.000.');
  await expect(timeline(page)).toHaveAttribute('data-cuts', '0');
  await page.keyboard.press('c');
  await expect(timeline(page)).toHaveAttribute('data-cuts', '1');

  // Opening the same video again brings them back.
  await page.reload();
  await open(page, 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello\n', media);
  await expect(timeline(page).getByRole('button', { name: 'Shot changes (1)' })).toBeVisible();
  await expect(timeline(page)).toHaveAttribute('data-cuts', '1');
});

test('imports a list, checks Netflix’s shot-change timing, and saves the list', async ({
  page,
}, testInfo) => {
  const media = testInfo.outputPath('import.wav');
  writeFileSync(media, wav(20));
  await open(page, 'WEBVTT\n\n00:00:01.000 --> 00:00:10.000\nHello there\n', media);
  await quality(page).getByLabel('Check against').selectOption('netflix-en-us');

  await timeline(page).getByRole('button', { name: 'Shot changes (0)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Shot changes' });
  // An ffmpeg scene-detection log: only the pts_time of each line counts.
  await dialog
    .getByLabel('Shot-change list')
    .fill(
      [
        'ffmpeg version 7.0.2',
        '[Parsed_showinfo_1 @ 0x1] n:   0 pts: 240 pts_time:10      duration:1',
        '[Parsed_showinfo_1 @ 0x1] n:   1 pts: 360 pts_time:15      duration:1',
      ].join('\n'),
    );
  await dialog.getByRole('button', { name: 'Import 2' }).click();
  await expect(dialog).toContainText('Imported 2 shot changes.');

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save list…' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('import.shotchanges');
  expect(readFileSync(await saved.path(), 'utf8')).toBe('10.000\n15.000\n');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(timeline(page)).toHaveAttribute('data-cuts', '2');

  // The cue ends on the cut at 10 s: Netflix ends it two frames before (24 fps by default).
  await quality(page).getByText('Shot changes (1)').click();
  await expect(quality(page)).toContainText('Ends on a shot change');
  await quality(page).getByRole('button', { name: 'Time to the shot changes' }).click();
  await expect.poll(async () => (await selectedCells(page)).end).toContain('09.917');
  await expect(quality(page).getByText('Shot changes (1)')).toHaveCount(0);
});

/**
 * Six seconds at 25 fps, in three shots with cuts at 2 s and 4 s (made with ffmpeg 6.1:
 * `-f lavfi -i "testsrc2=s=128x72:r=25:d=2" -f lavfi -i "smptebars=s=128x72:r=25:d=2"
 * -f lavfi -i "mandelbrot=s=128x72:r=25,trim=duration=2" -filter_complex
 * "[1:v]noise=alls=12:allf=t[b];[0:v][b][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]"
 * -map "[v]" -c:v libvpx -b:v 50k -g 50`). ffmpeg's own scene detection finds the same two.
 */
const CUTS_VIDEO = new URL('./media/cuts-25fps.webm', import.meta.url).pathname;

test('finds the shot changes in the video', async ({ page }) => {
  await open(page, 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello\n', CUTS_VIDEO);
  await timeline(page).getByRole('button', { name: 'Shot changes (0)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Shot changes' });
  await dialog.getByRole('button', { name: 'Find shot changes' }).click();
  const found = dialog.getByText('Found 2 shot changes.');
  const unavailable = dialog.getByText(/Cannot find them here/);
  await expect(found.or(unavailable)).toBeVisible({ timeout: 30_000 });
  // Where this browser cannot decode VP8 in a worker, it says so and points to ffmpeg.
  if (await unavailable.isVisible()) return;
  await expect(dialog).toContainText('00:00:02.000, 00:00:04.000');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(timeline(page)).toHaveAttribute('data-cuts', '2');
});
