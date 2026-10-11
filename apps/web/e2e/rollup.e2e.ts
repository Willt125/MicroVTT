/** Roll-up captions from ordinary cues: a scrolling region, or repeated lines. */
import { expect, test, type Page } from '@playwright/test';
import { mediaInput, rows, status, vttInput, wav } from './support.ts';

const CUES =
  'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nWelcome back to\n<00:00:03.000>the workshop.\n\n' +
  '00:00:05.000 --> 00:00:09.000\nToday we build\n<00:00:07.000>a bench.\n';

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles({
    name: 'cues.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from(CUES),
  });
  await expect(status(page)).toContainText('2 cues');
}

test('makes a scrolling region that shows the newest line at the bottom', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Roll-up…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Roll-up captions' });
  await expect(dialog.getByLabel('Scrolling region (WebVTT)')).toBeChecked();
  await expect(dialog.getByLabel('Lines shown')).toHaveValue('3');
  await expect(dialog.getByLabel('Background behind each line (like pop-on)')).toBeChecked();
  await expect(dialog.getByRole('status')).toContainText(
    '2 cues become 4 cues (4 roll-up lines), in a new region "rollup"',
  );
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page)).toContainText('4 cues');
  await expect(rows(page).nth(1).locator('.text')).toHaveText('the workshop.');

  // In the preview, at 4 s, the region holds the first two lines, the newer one lower.
  await mediaInput(page).setInputFiles({
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: wav(10),
  });
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState), {
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(1);
  await page.locator('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 4));
  const lines = page.locator('.media .vtt-region .vtt-cue');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toHaveText('Welcome back to');
  // No box for the region itself: each line has its own, as pop-on cues do.
  await expect(page.locator('.media .vtt-region')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  await expect(lines.nth(0).locator('.vtt-bg')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.8)');
  const [a, b] = [await lines.nth(0).boundingBox(), await lines.nth(1).boundingBox()];
  expect((b?.y ?? 0) > (a?.y ?? 0)).toBe(true);

  // One undo step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(status(page)).toContainText('2 cues');
});

test('makes repeated lines, for players without regions', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Roll-up…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Roll-up captions' });
  await dialog.getByLabel('Repeated lines').check();
  await dialog.getByLabel('Lines shown').fill('2');
  await expect(dialog.getByRole('status')).toContainText('2 cues become 4 cues');
  await expect(dialog.getByRole('status')).not.toContainText('region');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await rows(page).nth(2).click();
  await expect(page.locator('#cue-text')).toHaveValue('the workshop.\nToday we build');
});
