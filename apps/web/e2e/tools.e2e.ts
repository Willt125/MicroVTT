import { expect, test } from '@playwright/test';
import { SAMPLE_CUES, cueList, cueText, openSample, selectedCells, status } from './support.ts';

test('finds and replaces, as one undo step', async ({ page }) => {
  await openSample(page);
  await cueList(page).focus();
  await page.keyboard.press('ControlOrMeta+f');
  const find = page.getByLabel('Find', { exact: true });
  await expect(find).toBeFocused();
  await find.fill('bench');
  const bar = page.getByRole('region', { name: 'Find and replace' });
  await expect(bar.locator('.status')).toHaveText(/^\s*\d+\s+matches\s*$/);
  const total = Number(/(\d+)/.exec(await bar.locator('.status').innerText())?.[1]);
  await find.press('Enter');
  await expect(bar.locator('.status')).toContainText(`1 of ${total}`);
  await expect(bar.locator('mark')).toHaveText('bench');
  await page.getByLabel('Replace with').fill('table');
  await bar.getByRole('button', { name: 'Replace all' }).click();
  await expect(bar.locator('.status')).toContainText(`Replaced ${total} matches`);
  await find.press('Escape');
  await expect(bar).toBeHidden();
  await cueList(page).focus();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+f');
  await expect(bar.locator('.status')).toContainText(`${total} matches`);
});

test('opens pasted WebVTT', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'WEBVTT\n\n00:01.000 --> 00:02.000\npasted cue\n');
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(status(page)).toContainText('pasted.vtt');
  await expect(status(page)).toContainText('1 cue');
  await expect(cueText(page)).toHaveValue('pasted cue');
});

test('lists the keyboard shortcuts', async ({ page }) => {
  await openSample(page);
  await cueList(page).focus();
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Set the cue’s start to the playhead');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('autosaves and restores after a reload', async ({ page }) => {
  await openSample(page);
  await cueText(page).fill('kept across a reload');
  await expect(status(page)).toContainText('autosaved', { timeout: 10_000 });
  await page.reload();
  const offer = page.getByRole('region', { name: 'Unsaved work' });
  await expect(offer).toContainText('autocaption-sample.vtt');
  await expect(offer).toContainText(`${SAMPLE_CUES} cues`);
  await offer.getByRole('button', { name: 'Restore' }).click();
  await expect(cueText(page)).toHaveValue('kept across a reload');
  await expect(status(page)).toContainText('edited');
  expect((await selectedCells(page)).num).toBe('1');
});
