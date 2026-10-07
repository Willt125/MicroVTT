import { expect, test } from '@playwright/test';
import { SAMPLE_CUES, cueList, openSample, rows, status } from './support.ts';

test('offers cleanup, previews it, applies it as one undo step', async ({ page }) => {
  await openSample(page);
  const offer = page.getByRole('status').filter({ hasText: 'auto-captions' });
  await expect(offer).toBeVisible();
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
