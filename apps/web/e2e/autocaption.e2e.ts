import { expect, test } from '@playwright/test';
import { SAMPLE_CUES, cueList, openSample, rows, status } from './support.ts';

test('offers cleanup, previews it, applies it as one undo step', async ({ page }) => {
  await openSample(page);
  const offer = page.getByRole('status').filter({ hasText: 'auto-captions' });
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('This looks like roll-up captions');
  await offer.getByRole('button', { name: 'Clean up…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Clean up auto-captions' });
  await expect(dialog).toContainText('Word timings come from the audio');
  await expect(dialog.locator('.preview')).toContainText(`${SAMPLE_CUES} cues become 4`);
  await expect(dialog.locator('.sample li').first()).toContainText('Welcome back to the workshop.');
  await dialog.getByRole('button', { name: 'Apply cleanup' }).click();

  await expect(status(page)).toContainText('4 cues');
  await expect(offer).toBeHidden();
  await expect(rows(page).nth(1).locator('.text')).toHaveText('[Music]');
  await cueList(page).focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(status(page)).toContainText(`${SAMPLE_CUES} cues`);
});

test('lists sound tags to review and jumps to them', async ({ page }) => {
  await openSample(page);
  const review = page.locator('.review');
  await expect(review.locator('summary')).toContainText('sound tags');
  await review
    .getByRole('button', { name: /^Cue \d+$/ })
    .first()
    .click();
  await expect(page.locator('#cue-text')).toHaveValue(/\[Music\]/);
});

test('applies a saved glossary across the document', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: 'Glossary…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Glossary' });
  await dialog.getByLabel('Find (entry 1)').fill('a bench');
  await dialog.getByLabel('Replace with (entry 1)').fill('a workbench');
  const apply = dialog.getByRole('button', { name: /^Apply all/ });
  await expect(apply).not.toHaveText('Apply all (0)');
  await apply.click();
  await expect(dialog.locator('.status')).toContainText('Replaced');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Find' }).click();
  await page.getByLabel('Find', { exact: true }).fill('workbench');
  await expect(page.locator('.find .status')).toContainText('matches');

  // The glossary is kept for the next visit.
  await page.reload();
  await openSample(page);
  await page.getByRole('button', { name: 'Glossary…' }).click();
  await expect(dialog.getByLabel('Find (entry 1)')).toHaveValue('a bench');
});

/** YouTube-style roll-up captions, each line's words timed one after another. */
function rollUp(lines: string[][], header = ''): string {
  const ts = (ms: number) => new Date(ms).toISOString().slice(11, 23);
  const parts = [`WEBVTT${header}\n`];
  let t = 0;
  let shown = ' ';
  for (const words of lines) {
    const end = t + words.length * 400;
    const timed = words.map((w, i) => (i === 0 ? w : `<${ts(t + i * 400)}><c>${w}</c>`)).join('');
    parts.push(`${ts(t)} --> ${ts(end)} align:start position:0%\n${shown}\n${timed}\n`);
    shown = words.join('');
    parts.push(`${ts(end)} --> ${ts(end + 10)} align:start position:0%\n${shown}\n \n`);
    t = end + 10;
  }
  return parts.join('\n');
}

test('takes line limits from the chosen guide, or the language', async ({ page }) => {
  const text = rollUp(
    [
      ['正直', 'な', 'ところ', 'これ', 'が', '何', 'の', 'こと', 'なのか'],
      ['全く', '分から', 'ない', 'ので', 'ここ', 'では', '何', 'の'],
      ['脈絡', 'も', 'なく', '提示', 'し', 'ます'],
      ['どなたか', 'これ', 'について', '説明', 'して', 'ください'],
    ],
    '\nKind: captions\nLanguage: ja',
  );
  await page.goto('/');
  await page
    .locator('input[type="file"][accept*=".vtt"]')
    .setInputFiles({ name: 'ja.vtt', mimeType: 'text/vtt', buffer: Buffer.from(text) });
  const offer = page.getByRole('status').filter({ hasText: 'auto-captions' });
  await offer.getByRole('button', { name: 'Clean up…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Clean up auto-captions' });
  // No guide chosen ("Basic checks"): the usual limits for Japanese.
  await expect(dialog.getByLabel('Characters per line')).toHaveValue('13');
  await expect(dialog.getByLabel('Half-width characters count as half')).toBeChecked();
  await expect(dialog.getByText('Line limits from Japanese.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  const panel = page.getByRole('complementary', { name: 'Style and accessibility' });
  await panel.getByLabel('Check against').selectOption('netflix-ja-sdh');
  await offer.getByRole('button', { name: 'Clean up…' }).click();
  await expect(dialog.getByLabel('Characters per line')).toHaveValue('16');
  await expect(dialog.getByText('Line limits from Netflix Japanese SDH.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply cleanup' }).click();
  await expect(offer).toBeHidden();
  const count = await rows(page).count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    await rows(page).nth(i).click();
    for (const line of (await page.locator('#cue-text').inputValue()).split('\n'))
      expect([...line].length).toBeLessThanOrEqual(16);
  }
});

test("puts timed words in <c> when the file's styles need it", async ({ page }) => {
  const text = rollUp(
    [
      ['Welcome', ' back', ' to', ' the', ' workshop'],
      ['today', ' we', ' build', ' a', ' bench'],
      ['with', ' simple', ' tools', ' and', ' care'],
    ],
    '\n\nSTYLE\n::cue(:future) {\n  color: grey;\n}',
  );
  await page.goto('/');
  await page
    .locator('input[type="file"][accept*=".vtt"]')
    .setInputFiles({ name: 'styled.vtt', mimeType: 'text/vtt', buffer: Buffer.from(text) });
  const offer = page.getByRole('status').filter({ hasText: 'auto-captions' });
  await offer.getByRole('button', { name: 'Clean up…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Clean up auto-captions' });
  const wrap = dialog.getByLabel('Put timed words in <c> (for karaoke / paint-on styles)');
  // On, as the file's style sheet uses :future.
  await expect(wrap).toBeChecked();
  // Evenly spaced test timings read as estimates, which are not kept unless asked.
  await dialog.getByLabel('Keep word timings').check();
  await dialog.getByRole('button', { name: 'Apply cleanup' }).click();
  await expect(offer).toBeHidden();
  await rows(page).first().click();
  await expect(page.locator('#cue-text')).toHaveValue(/^<c>Welcome <\/c><[\d:.]+><c>back <\/c>/);
});
