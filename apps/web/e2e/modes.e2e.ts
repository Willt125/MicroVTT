import { expect, test, type Page } from '@playwright/test';
import { cueText, mediaInput, rows, status, vttInput, wav } from './support.ts';

async function open(page: Page, name: string, text: string): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles({ name, mimeType: 'text/vtt', buffer: Buffer.from(text) });
  await expect(status(page)).toContainText(name);
}

const CHAPTERS = [
  'WEBVTT',
  '',
  '00:00.000 --> 01:00.000',
  'Intro',
  '',
  '01:00.000 --> 03:00.000',
  'Main part',
  '',
].join('\n');

const fileType = (page: Page) => page.getByRole('banner').getByLabel('Type');
const chapters = (page: Page) => page.getByRole('complementary', { name: 'Chapters' });
const outline = (page: Page) => chapters(page).getByRole('list', { name: 'Chapter outline' });

test('offers chapters mode and edits chapters', async ({ page }) => {
  await open(page, 'talk.chapters.vtt', CHAPTERS);
  const offer = page.getByRole('status').filter({ hasText: 'This looks like a chapters file' });
  await expect(offer).toContainText('the file name says it holds chapters');
  await offer.getByRole('button', { name: 'Edit as chapters' }).click();
  await expect(offer).toBeHidden();
  await expect(fileType(page)).toHaveValue('chapters');

  // The editor is for titles: no markup tools, settings or style rules.
  await rows(page).first().click();
  await expect(page.locator('label[for="cue-text"]')).toContainText('Title');
  await expect(page.getByRole('toolbar', { name: 'Text markup' })).toHaveCount(0);
  await expect(page.locator('details.settings')).toHaveCount(0);
  await expect(page.locator('details.karaoke')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Style and accessibility' })).toHaveCount(0);
  await expect(outline(page).getByRole('listitem')).toHaveCount(2);

  // Markup is not allowed in a chapter title.
  await cueText(page).fill('<i>Intro</i>');
  await expect(page.getByText('Chapter titles cannot contain tags').first()).toBeVisible();
  await cueText(page).fill('Intro & welcome');

  // Add a chapter (no media: after the last), then make them continuous.
  await chapters(page).getByRole('button', { name: 'Add chapter' }).click();
  await expect(outline(page).getByRole('listitem')).toHaveCount(3);
  await expect(outline(page)).toContainText(/3:00\s*Chapter 3/);
  await expect(chapters(page).getByRole('button', { name: 'Make continuous' })).toBeDisabled();

  // Copy as a list.
  await chapters(page).getByText('Copy as a chapter list').click();
  await expect(chapters(page).getByLabel('Chapter list', { exact: true })).toHaveValue(
    '0:00 Intro & welcome\n1:00 Main part\n3:00 Chapter 3',
  );

  // Replace them from a list.
  await chapters(page).getByText('Import a chapter list').click();
  await chapters(page)
    .getByLabel('Chapter list to import')
    .fill('Chapters\n0:00 Start\n0:45 - Middle\nEnd (2:30)');
  await expect(chapters(page)).toContainText(
    '3 chapters read; 1 line without a time left out (line 1).',
  );
  page.once('dialog', (d) => void d.accept());
  await chapters(page).getByRole('button', { name: 'Replace chapters' }).click();
  await expect(outline(page).getByRole('listitem')).toHaveCount(3);
  await expect(outline(page)).toContainText(/0:45\s*Middle/);
  await expect(cueText(page)).toHaveValue('Start');
});

test('shows the chapter at the playhead and adds chapters there', async ({ page }) => {
  await open(page, 'talk.chapters.vtt', CHAPTERS);
  await page.getByRole('button', { name: 'Edit as chapters' }).click();
  await mediaInput(page).setInputFiles({
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: wav(200),
  });
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState), {
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(1);
  await expect(page.getByLabel('Captions', { exact: true })).toBeDisabled();
  await expect(page.getByTestId('spec-captions')).toHaveCount(0);
  await page.locator('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 90));
  await expect(page.getByRole('status', { name: 'Chapter at the playhead' })).toHaveText(
    'Main part',
  );
  await chapters(page).getByRole('button', { name: 'Add at playhead' }).click();
  await expect(outline(page)).toContainText(/1:30\s*Chapter 3/);
  // The chapter it was in now ends there.
  await expect(rows(page).nth(1)).toContainText('00:01:30.000');
});

test('edits JSON metadata payloads', async ({ page }) => {
  await open(
    page,
    'events.vtt',
    'WEBVTT\n\n00:00.000 --> 00:01.000\n{"scene": 1}\n\n00:01.000 --> 00:02.000\n{"scene": 2}\n',
  );
  const offer = page.getByRole('status').filter({ hasText: 'This looks like a metadata file' });
  await expect(offer).toContainText('every cue holds JSON data');
  await offer.getByRole('button', { name: 'Edit as metadata' }).click();
  await rows(page).first().click();
  await expect(page.locator('label[for="cue-text"]')).toContainText('Payload');
  await expect(cueText(page)).toHaveAttribute('spellcheck', 'false');
  const checks = page.getByLabel('Payload checks');
  await expect(checks).toContainText('Valid JSON.');

  await cueText(page).fill('{"scene": 1, "note": "a --> b", "tags": ["x"]}');
  await expect(checks).toContainText('"-->" would end the cue');
  await checks.getByRole('button', { name: 'Format' }).click();
  await expect(cueText(page)).toHaveValue(
    '{\n  "scene": 1,\n  "note": "a --\\u003e b",\n  "tags": [\n    "x"\n  ]\n}',
  );
  await checks.getByRole('button', { name: 'One line' }).click();
  await expect(cueText(page)).toHaveValue('{"scene":1,"note":"a --\\u003e b","tags":["x"]}');
  await cueText(page).fill('{"scene": }');
  await expect(checks).toContainText('JSON does not parse');
  await expect(checks.getByRole('button', { name: 'Format' })).toBeDisabled();
});

test('a file opened next starts as captions again', async ({ page }) => {
  await open(page, 'talk.chapters.vtt', CHAPTERS);
  await page.getByRole('button', { name: 'Edit as chapters' }).click();
  await expect(fileType(page)).toHaveValue('chapters');
  await vttInput(page).setInputFiles({
    name: 'other.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n'),
  });
  await expect(status(page)).toContainText('other.vtt');
  await expect(fileType(page)).toHaveValue('captions');
  await expect(page.getByRole('complementary', { name: 'Chapters' })).toHaveCount(0);
});
