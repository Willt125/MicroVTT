/** Timing tools: dragging and snapping on the timeline, multiple selection, frames, Timing. */
import { expect, test, type Page } from '@playwright/test';
import { cueList, mediaInput, mediaTime, rows, status, vttInput, wav } from './support.ts';

const THREE = Buffer.from(
  'WEBVTT\n\n00:01.000 --> 00:03.000\none\n\n00:05.000 --> 00:07.000\ntwo\n\n' +
    '00:09.000 --> 00:11.000\nthree\n',
);

const timeline = (page: Page) => page.getByRole('region', { name: 'Timeline' });

/** Starts of the cues as the table shows them. */
const starts = (page: Page): Promise<string[]> =>
  rows(page).evaluateAll((list) =>
    list.map((row) => row.querySelector('.time')?.textContent?.trim() ?? ''),
  );

/** "00:00:06.010" as 6010. */
function toMs(time: string | undefined): number {
  const [h, m, s] = (time ?? '').split(':').map(Number);
  return Math.round(((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? Number.NaN)) * 1000);
}

async function openThree(page: Page): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles({ name: 'three.vtt', mimeType: 'text/vtt', buffer: THREE });
  await expect(status(page)).toContainText('3 cues');
}

/** The page x of a time on the timeline, from the view it reports. */
async function xOf(page: Page, ms: number): Promise<number> {
  const box = (await page.locator('.timeline canvas').boundingBox()) as { x: number };
  const startMs = Number(await timeline(page).getAttribute('data-start-ms'));
  const msPerPx = Number(await timeline(page).getAttribute('data-ms-per-px'));
  return box.x + 1 + (ms - startMs) / msPerPx;
}

/** Drags in the cue lane from one time to another. */
async function dragLane(page: Page, fromMs: number, toMs: number): Promise<void> {
  const box = (await page.locator('.timeline canvas').boundingBox()) as {
    y: number;
    height: number;
  };
  const y = box.y + box.height - 12;
  await page.mouse.move(await xOf(page, fromMs), y);
  await page.mouse.down();
  await page.mouse.move(await xOf(page, toMs), y, { steps: 8 });
  await page.mouse.up();
}

test.describe('with media', () => {
  test.beforeEach(async ({ page }) => {
    await openThree(page);
    await mediaInput(page).setInputFiles({
      name: 'tone.wav',
      mimeType: 'audio/wav',
      buffer: wav(20),
    });
    await expect(timeline(page)).toBeVisible();
  });

  test('moves a cue by dragging it, as one undo step', async ({ page }) => {
    await dragLane(page, 6000, 7000);
    const [, two] = await starts(page);
    // Within a pixel or two of 6 s (no snap target is near).
    expect(Math.abs(toMs(two) - 6000)).toBeLessThan(60);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await starts(page)).toEqual(['00:00:01.000', '00:00:05.000', '00:00:09.000']);
  });

  test('snaps a dragged edge to the next cue', async ({ page }) => {
    // The end of "one" (3 s) dragged to just short of where "two" starts.
    const msPerPx = Number(await timeline(page).getAttribute('data-ms-per-px'));
    await dragLane(page, 3000 - msPerPx, 5000 - 4 * msPerPx);
    await expect(rows(page).first().locator('.time').nth(1)).toHaveText('00:00:05.000');
  });

  test('moves every selected cue together', async ({ page }) => {
    await cueList(page).focus();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(cueList(page).locator('[aria-selected=true]')).toHaveCount(3);
    await dragLane(page, 10_000, 12_000);
    const [one, two, three] = await starts(page);
    expect(toMs(one) - 1000).toBeGreaterThan(1500);
    expect(toMs(two) - 5000).toBe(toMs(one) - 1000);
    expect(toMs(three) - 9000).toBe(toMs(one) - 1000);
  });
});

test('selects in the list with Shift and Ctrl/⌘, and deletes the selection', async ({ page }) => {
  await openThree(page);
  const selected = cueList(page).locator('[aria-selected=true]');
  await rows(page).nth(0).click();
  await rows(page)
    .nth(1)
    .click({ modifiers: ['Shift'] });
  await expect(selected).toHaveCount(2);
  await rows(page)
    .nth(2)
    .click({ modifiers: ['ControlOrMeta'] });
  await expect(selected).toHaveCount(3);
  await rows(page)
    .nth(0)
    .click({ modifiers: ['ControlOrMeta'] });
  await expect(selected).toHaveCount(2);
  await cueList(page).press('Delete');
  await expect(status(page)).toContainText('1 cue');
  await expect(rows(page).first().locator('.text')).toHaveText('one');
});

test('shifts and resyncs with the Timing dialog', async ({ page }) => {
  await openThree(page);
  await page.getByRole('button', { name: 'Timing…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Timing' });
  await dialog.getByLabel(/Shift by/).fill('-0.5');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => starts(page)).toEqual(['00:00:00.500', '00:00:04.500', '00:00:08.500']);

  await page.getByRole('button', { name: 'Timing…' }).click();
  await dialog.getByLabel('Two-point resync').check();
  await dialog.getByLabel("First cue's correct start").fill('2');
  await dialog.getByLabel("Second cue's correct start").fill('18');
  await expect(dialog.getByRole('status')).toContainText('2.00000');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => starts(page)).toEqual(['00:00:02.000', '00:00:10.000', '00:00:18.000']);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => starts(page)).toEqual(['00:00:00.500', '00:00:04.500', '00:00:08.500']);
});

test('steps by frames at the frame rate measured from the video', async ({ page }) => {
  await openThree(page);
  await mediaInput(page).setInputFiles(
    new URL('./media/frames-25fps.webm', import.meta.url).pathname,
  );
  const rate = page.getByRole('combobox', { name: 'Frame rate' });
  await expect(rate.locator('option').first()).toHaveText('Auto (25)', { timeout: 15_000 });
  // Where this browser cannot play VP8, there is nothing to step through.
  if (await page.locator('.media .error-text').isVisible()) return;
  // Selecting the first cue moved the playhead to its start, 1 s: frame 25.
  await expect.poll(() => mediaTime(page)).toBe(1000);
  await cueList(page).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('.');
  await expect.poll(() => mediaTime(page)).toBe(1120);
  await page.keyboard.press(',');
  await expect.poll(() => mediaTime(page)).toBe(1080);
});
