import { expect, test } from '@playwright/test';
import {
  SAMPLE_CUES,
  cueList,
  cueText,
  errorCount,
  openSample,
  rows,
  selectedCells,
  status,
} from './support.ts';

test.beforeEach(async ({ page }) => openSample(page));

test('opens a file and reports what it had', async ({ page }) => {
  await expect(rows(page).first()).toBeVisible();
  expect((await selectedCells(page)).num).toBe('1');
  await expect(page.getByText('Found when the file was opened')).toBeVisible();
  await expect(page.locator('.summary')).not.toContainText('Checking');
});

test('edits text with live validation, and undoes', async ({ page }) => {
  const before = await cueText(page).inputValue();
  const errors = await errorCount(page);
  await cueText(page).fill('AT&T');
  await expect(page.locator('.problems')).toContainText('character reference');
  await expect.poll(() => errorCount(page)).toBe(errors + 1);
  await cueList(page).focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(cueText(page)).toHaveValue(before);
  await expect.poll(() => errorCount(page)).toBe(errors);
});

test('navigates, adds and deletes from the keyboard', async ({ page }) => {
  await cueList(page).focus();
  await page.keyboard.press('End');
  expect((await selectedCells(page)).num).toBe(String(SAMPLE_CUES));
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  expect((await selectedCells(page)).num).toBe('2');
  await page.keyboard.press('n'); // No media: a 2 s cue after the selected one.
  await expect(status(page)).toContainText(`${SAMPLE_CUES + 1} cues`);
  expect(await selectedCells(page)).toMatchObject({ num: '3', start: '00:00:03.080' });
  await cueList(page).focus();
  await page.keyboard.press('Delete');
  await expect(status(page)).toContainText(`${SAMPLE_CUES} cues`);
});

test('splits at the caret and merges back, keeping focus in the text', async ({ page }) => {
  await cueText(page).fill('hello brave world');
  await cueText(page).evaluate((t: HTMLTextAreaElement) => t.setSelectionRange(6, 6));
  await page.keyboard.press('Alt+KeyS');
  await expect(cueText(page)).toHaveValue('brave world');
  await expect(cueText(page)).toBeFocused();
  await expect(status(page)).toContainText(`${SAMPLE_CUES + 1} cues`);
  await page.keyboard.press('Alt+ArrowUp');
  await expect(cueText(page)).toHaveValue('hello');
  await expect(cueText(page)).toBeFocused();
  await page.keyboard.press('Alt+KeyM');
  await expect(cueText(page)).toHaveValue(/^hello\n<[\d:.]+>brave world$/);
  await expect(status(page)).toContainText(`${SAMPLE_CUES} cues`);
});

test('nudges times with the arrow keys', async ({ page }) => {
  const start = page.getByLabel('Start', { exact: true });
  await expect(start).toHaveValue('00:00:00.240');
  await start.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(start).toHaveValue('00:00:01.340');
  expect((await selectedCells(page)).start).toBe('00:00:01.340');
});

test('exports a conforming file', async ({ page, browserName }) => {
  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('changes so the file conforms');
  // Chromium can save through a picker; every browser can download.
  const save =
    browserName === 'chromium'
      ? dialog.getByRole('button', { name: 'Download' })
      : dialog.getByRole('button', { name: 'Save autocaption-sample.vtt' });
  const [download] = await Promise.all([page.waitForEvent('download'), save.click()]);
  expect(download.suggestedFilename()).toBe('autocaption-sample.vtt');
  const text = await (await download.createReadStream()).toArray();
  const vtt = Buffer.concat(text).toString('utf8');
  expect(vtt).toMatch(/^WEBVTT\n\nNOTE\nKind: captions\nLanguage: en\n\n/);
  await expect(status(page)).not.toContainText('edited');
});
