/** Style and accessibility checks: choosing a ruleset, fixing, changing rules, auto-captions. */
import { expect, test, type Page } from '@playwright/test';
import { SAMPLE, cueText, status, vttInput } from './support.ts';

const panel = (page: Page) => page.getByRole('complementary', { name: 'Style and accessibility' });

async function open(page: Page, text: string): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles({
    name: 'q.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from(text),
  });
  await expect(status(page)).toContainText('q.vtt');
}

test('checks against a chosen guide, and fixes what it can', async ({ page }) => {
  await open(page, 'WEBVTT\n\n00:00.000 --> 00:03.000\nWait...  what?\n');
  // The basic checks pass this.
  await expect(panel(page).getByRole('status')).toHaveText('Nothing to report.');
  await panel(page).getByLabel('Check against').selectOption('netflix-en-us');
  await expect(panel(page).getByRole('status')).toContainText('2 warnings');
  await panel(page).getByText('Ellipsis character (1)').click();
  await panel(page).getByRole('button', { name: 'Use …' }).click();
  await expect(cueText(page)).toHaveValue('Wait…  what?');
  await expect(panel(page).getByRole('status')).toContainText('1 warning');
  // The choice is kept in this browser.
  await page.reload();
  await vttInput(page).setInputFiles({
    name: 'q.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:03.000\nfine  text\n'),
  });
  await expect(panel(page).getByLabel('Check against')).toHaveValue('netflix-en-us');
  await expect(panel(page).getByText('Double spaces (1)')).toBeVisible();
});

test('rules can be switched off and their settings changed', async ({ page }) => {
  await open(page, 'WEBVTT\n\n00:00.000 --> 00:01.000\nA line that is read rather fast\n');
  await panel(page).getByLabel('Check against').selectOption('netflix-en-us');
  await expect(panel(page).getByText('Reading speed (characters) (1)')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Rules…' }).click();
  const dialog = page.getByRole('dialog', { name: /Rules: Netflix English/ });
  await dialog.getByLabel('Reading speed (characters): Fastest').fill('40');
  await dialog.getByLabel('Reading speed (characters): Fastest').press('Tab');
  await expect(panel(page).getByRole('status')).toHaveText('Nothing to report.');
  await dialog.getByRole('button', { name: 'Reset to the guide’s values' }).click();
  await expect(panel(page).getByText('Reading speed (characters) (1)')).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Reading speed (characters)' }).uncheck();
  await expect(panel(page).getByRole('status')).toHaveText('Nothing to report.');
  await dialog.getByRole('button', { name: 'Close' }).click();
});

test('checks contrast of style sheet colours for WCAG', async ({ page }) => {
  await open(
    page,
    'WEBVTT\n\nSTYLE\n::cue(.quiet) { color: #777 }\n\n00:00.000 --> 00:02.000\n<c.quiet>hush</c>\n',
  );
  await panel(page).getByLabel('Check against').selectOption('wcag22');
  await panel(page).getByText('Contrast (1)').click();
  await expect(panel(page)).toContainText('::cue(.quiet): text #777777');
});

test('waits for auto-captions to be cleaned up', async ({ page }) => {
  await page.goto('/');
  await vttInput(page).setInputFiles(SAMPLE);
  await expect(panel(page)).toContainText('Waiting for the auto-captions to be cleaned up');
  await panel(page).getByRole('button', { name: 'Check anyway' }).click();
  await expect(panel(page).getByRole('status')).toContainText(/warnings?/);
});
