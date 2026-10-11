/** Text in other languages and scripts: the editor's language, direction marks, find. */
import { expect, test, type Page } from '@playwright/test';
import { cueList, cueText, rows, status, vttInput } from './support.ts';

async function open(page: Page, name: string, text: string): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles({ name, mimeType: 'text/vtt', buffer: Buffer.from(text) });
  await expect(status(page)).toContainText(name);
}

const language = (page: Page) => page.getByLabel('Language', { exact: true });

test('takes the language from the file and shows invisible marks', async ({ page }) => {
  await open(
    page,
    'news.vtt',
    'WEBVTT\nLanguage: ar\n\n00:00.000 --> 00:02.000\n\u200fما رأيك في الخطة الجديدة؟\n',
  );
  await rows(page).first().click();
  await expect(language(page)).toHaveValue('ar');
  await expect(cueText(page)).toHaveAttribute('lang', 'ar');
  await expect(cueText(page)).toHaveAttribute('dir', 'auto');
  await expect(page.getByRole('status').filter({ hasText: 'looks like' })).toHaveCount(0);

  const rlm = page.getByRole('button', { name: 'Remove Right-to-left mark' });
  await rlm.click();
  await expect(rlm).toBeHidden();
  expect(await cueText(page).inputValue()).not.toContain('\u200f');

  // Insert an isolate around a selected word.
  await cueText(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 2));
  await page
    .getByLabel('Insert an invisible character')
    .selectOption({ label: 'Left-to-right isolate around the selection' });
  expect(await cueText(page).inputValue()).toMatch(/^\u2066ما\u2069 رأيك/);
  await expect(page.getByRole('button', { name: 'Remove Left-to-right isolate' })).toBeVisible();
});

test('offers a guessed language and applies it only when asked', async ({ page }) => {
  await open(
    page,
    'plan.vtt',
    'WEBVTT\n\n00:00.000 --> 00:04.000\nЧто ты думаешь о новом плане? Я думаю, что он неплохой,\n\n00:04.000 --> 00:08.000\nно мы должны сначала поговорить с ними.\n',
  );
  const banner = page.getByRole('status').filter({ hasText: 'looks like Russian' });
  await expect(banner).toBeVisible();
  await rows(page).first().click();
  await expect(language(page)).toHaveValue('');
  await expect(cueText(page)).not.toHaveAttribute('lang');
  await banner.getByRole('button', { name: 'Set language' }).click();
  await expect(banner).toBeHidden();
  await expect(language(page)).toHaveValue('ru');
  await expect(cueText(page)).toHaveAttribute('lang', 'ru');
});

test('suggests rules for the text’s language', async ({ page }) => {
  await open(page, 'talk.fi.vtt', 'WEBVTT\n\n00:00.000 --> 00:02.000\nHyvää huomenta.\n');
  const panel = page.getByRole('complementary', { name: 'Style and accessibility' });
  await panel.getByLabel('Check against').selectOption('netflix-en-us');
  await expect(
    panel.getByText('These rules are for English text; this text is in Finnish.'),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Use Netflix Finnish' }).click();
  await expect(panel.getByLabel('Check against')).toHaveValue('netflix-fi');
  await expect(panel.getByText('These rules are for')).toBeHidden();
});

test('finds letters however they are encoded', async ({ page }) => {
  await open(page, 'cafe.vtt', 'WEBVTT\n\n00:00.000 --> 00:02.000\nCafe\u0301 ja café\n');
  // Focus the page first: with nothing focused, Firefox can take Ctrl+F as its own find.
  await cueList(page).focus();
  await page.keyboard.press('ControlOrMeta+f');
  await page.getByLabel('Find', { exact: true }).fill('café');
  const bar = page.getByRole('region', { name: 'Find and replace' });
  await expect(bar.locator('.status')).toHaveText(/^\s*2\s+matches\s*$/);
});

test('tells Simplified from Traditional Chinese, and checks Japanese by its guide', async ({
  page,
}) => {
  await open(page, 'talk.zh-TW.vtt', 'WEBVTT\n\n00:00.000 --> 00:03.000\n我們今天去公園嗎？\n');
  const panel = page.getByRole('complementary', { name: 'Style and accessibility' });
  await panel.getByLabel('Check against').selectOption('netflix-zh-hans');
  await expect(panel.getByText(/These rules are for .*Chinese.* text/)).toBeVisible();
  await panel.getByRole('button', { name: 'Use Netflix Chinese (Traditional)' }).click();
  await expect(panel.getByLabel('Check against')).toHaveValue('netflix-zh-hant');

  await open(page, 'talk.ja.vtt', 'WEBVTT\n\n00:00.000 --> 00:05.000\nBBCの記者が来た。\n');
  await panel.getByLabel('Check against').selectOption('netflix-ja');
  await panel.getByText('Punctuation (Japanese) (1)').click();
  await panel.getByRole('button', { name: 'Fix the punctuation' }).click();
  await rows(page).first().click();
  await expect(cueText(page)).toHaveValue('BBCの記者が来た');
});
