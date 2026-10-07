/** Phase 4d in the editor: files from older drafts and other tools open as they were meant. */
import { expect, test, type Page } from '@playwright/test';
import { cueText, rows, status, vttInput } from './support.ts';

async function open(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles({ name, mimeType: 'text/vtt', buffer });
}

async function exportText(page: Page, name: string): Promise<string> {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Checking…')).toBeHidden();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: new RegExp(`^(Download|Save ${name})$`) }).click(),
  ]);
  return Buffer.concat(await (await download.createReadStream()).toArray()).toString('utf8');
}

test('an SRT-style file with <br> and <font> opens with every cue', async ({ page }) => {
  const srt =
    'WEBVTT\n\n1\n00:00:01,000 --> 00:00:02,500\none<br>two\n\n' +
    '2\n00:00:03,000 --> 00:00:04,000\n<font color="yellow">yellow</font>\n';
  await open(page, 'srtish.vtt', Buffer.from(srt));
  await expect(status(page)).toContainText('2 cues');
  await rows(page).first().click();
  await expect(cueText(page)).toHaveValue('one\ntwo');
  await expect(page.getByText('Found when the file was opened')).toBeVisible();

  await page.keyboard.press('ControlOrMeta+s');
  expect(await exportText(page, 'srtish.vtt')).toBe(
    'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\none\ntwo\n\n2\n00:00:03.000 --> 00:00:04.000\n<c.yellow>yellow</c>\n',
  );
});

test('a file that is not UTF-8 is read as Windows-1252, and can be reread', async ({ page }) => {
  const text = 'WEBVTT\n\n00:00.000 --> 00:01.000\ncafé\n';
  await open(page, 'latin1.vtt', Buffer.from(text, 'latin1'));
  const banner = page.getByRole('status').filter({ hasText: 'This file is not UTF-8' });
  await expect(banner).toBeVisible();
  await rows(page).first().click();
  await expect(cueText(page)).toHaveValue('café');

  await banner.getByRole('combobox', { name: 'Read the file as' }).selectOption('windows-1251');
  await rows(page).first().click();
  await expect(cueText(page)).toHaveValue('cafй'); // Cyrillic reading of the same byte
});

test('text after a blank line inside a caption can be joined back', async ({ page }) => {
  await open(
    page,
    'blank.vtt',
    Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nline one\n\nline two\n'),
  );
  const fixes = page.locator('details.fixes');
  await expect(fixes.locator('summary')).toHaveText('Can be fixed (1)');
  await fixes.getByRole('button', { name: 'Join this text to the cue above' }).click();
  await expect(fixes).toBeHidden();
  await rows(page).first().click();
  await expect(cueText(page)).toHaveValue('line one\nline two');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('details.fixes')).toBeVisible();
});

test('X-TIMESTAMP-MAP can be kept under the WEBVTT line for HLS', async ({ page }) => {
  const hls =
    'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n00:00:01.000 --> 00:00:02.000\nhi\n';
  await open(page, 'hls.vtt', Buffer.from(hls));
  await expect(status(page)).toContainText('1 cue');
  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog');
  const keep = dialog.getByRole('checkbox', { name: /Keep the lines under "WEBVTT"/ });
  await expect(keep).not.toBeChecked();
  await keep.check();
  await expect(dialog).toContainText('non-conforming WebVTT');
  expect(await exportText(page, 'hls.vtt')).toBe(hls);
});
