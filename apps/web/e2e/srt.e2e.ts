import { expect, test, type Page } from '@playwright/test';
import { cueText, rows, savedFile, status, vttInput } from './support.ts';

const CRLF_BOM =
  '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\n<i>One</i>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nTwo <s>struck</s>\r\n\r\n';

async function openSrt(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles({ name, mimeType: 'application/x-subrip', buffer });
}

test('opens, edits and saves SubRip as SubRip, the way the file was written', async ({ page }) => {
  await openSrt(page, 'film.srt', Buffer.from(CRLF_BOM));
  await expect(status(page)).toContainText('2 cues');
  await expect(rows(page).first()).toContainText('One');
  await expect(page.getByText('(SubRip markup, e.g.')).toBeVisible();

  // Its one setting, the position, is written in the text.
  await page.locator('details.settings summary').click();
  await page.getByLabel('Position').selectOption('8');
  await expect(cueText(page)).toHaveValue('{\\an8}<i>One</i>');

  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Format')).toHaveValue('srt');
  await expect(dialog.getByLabel('Line endings')).toHaveValue('\r\n');
  await expect(dialog.getByRole('checkbox', { name: /Byte order mark/ })).toBeChecked();
  const { name, bytes } = await savedFile(page);
  expect(name).toBe('film.srt');
  expect(bytes.toString('utf8')).toBe(
    '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\n{\\an8}<i>One</i>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nTwo <s>struck</s>\r\n\r\n',
  );
});

test('converts SubRip to WebVTT on export, listing what is lost', async ({ page }) => {
  await openSrt(page, 'film.srt', Buffer.from(CRLF_BOM));
  await expect(status(page)).toContainText('2 cues');
  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Format').selectOption('webvtt');
  await expect(dialog.getByLabel('Not converted')).toContainText('Strikethrough (<s>): 1');
  await dialog.getByLabel('Line endings').selectOption('\n');
  const { name, bytes } = await savedFile(page);
  expect(name).toBe('film.vtt');
  expect(bytes.toString('utf8')).toBe(
    'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<i>One</i>\n\n00:00:03.000 --> 00:00:04.000\nTwo struck\n',
  );
});

test('reports what players read differently, and writes a legacy file back in its encoding', async ({
  page,
}) => {
  // Windows-1252 ("café" with é as 0xE9), loose times and a misnumbered cue.
  const file = Buffer.concat([
    Buffer.from('3\n0:00:01.5 --> 0:00:02.5\ncaf'),
    Buffer.from([0xe9]),
    Buffer.from('\n'),
  ]);
  await openSrt(page, 'old.srt', file);
  await expect(cueText(page)).toHaveValue('café');
  const problems = page.getByRole('complementary', { name: 'Problems' });
  await expect(problems).toContainText('SubRip files have no set encoding');
  await expect(problems).toContainText('SubRip times are written HH:MM:SS,mmm');
  await expect(problems).toContainText('SubRip cues are numbered from 1');

  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /Write in Western \(Windows-1252\)/ }).check();
  const { bytes } = await savedFile(page);
  expect([...bytes]).toEqual([
    ...Buffer.from('1\n00:00:01,500 --> 00:00:02,500\ncaf'),
    0xe9,
    ...Buffer.from('\n\n'),
  ]);
});

test('opens pasted SubRip', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\npasted cue\n';
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const init = { clipboardData: data, dataType: 'text/plain', data: text, bubbles: true };
    window.dispatchEvent(new ClipboardEvent('paste', init));
  });
  await expect(status(page)).toContainText('pasted.srt');
  await expect(cueText(page)).toHaveValue('pasted cue');
});
