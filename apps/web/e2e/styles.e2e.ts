import { expect, test, type Page } from '@playwright/test';
import { status, vttInput } from './support.ts';

const FILE = [
  'WEBVTT',
  '',
  '00:00:01.000 --> 00:00:02.000',
  '<v Bob>Hello</v> <c.loud>there</c>',
  '',
].join('\n');

async function open(page: Page, name = 'cues.vtt', text = FILE): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(status(page)).toContainText('1 cue');
}

async function exportText(page: Page): Promise<string> {
  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog', { name: /^Export/ });
  await expect(dialog.getByText('Checking…')).toBeHidden();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: /^(Download|Save cues\.vtt)$/ }).click(),
  ]);
  return Buffer.concat(await (await download.createReadStream()).toArray()).toString('utf8');
}

test('adds and edits a style block, with problems, rules and a preview', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Styles…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Styles' });
  await expect(dialog).toContainText('No style blocks yet.');
  await dialog.getByRole('button', { name: 'Add style block' }).click();
  await expect(dialog.getByRole('list', { name: 'Style blocks in this file' })).toContainText(
    'Style 1 1 rule',
  );

  // The caret starts inside the ::cue rule.
  const css = dialog.getByLabel('CSS');
  await expect(css).toBeFocused();
  await page.keyboard.type('color: yellow;');
  await expect(css).toHaveValue('::cue {\n  color: yellow;\n}');
  const hello = dialog.getByTestId('cue-preview').getByText('Hello');
  await expect(hello).toHaveCSS('color', 'rgb(255, 255, 0)');

  // A rule for a voice the cues use, added after the rule the caret is in.
  await css.press('ControlOrMeta+Home');
  await css.press('ArrowDown');
  await dialog.getByLabel('Add a rule for').selectOption({ label: 'Voice Bob' });
  await expect(css).toHaveValue(
    '::cue {\n  color: yellow;\n}\n::cue(v[voice="Bob"]) {\n  color: cyan;\n}',
  );
  await expect(hello).toHaveCSS('color', 'rgb(0, 255, 255)');
  await expect(dialog.getByRole('option', { name: 'Class .loud' })).toBeAttached();

  // Problems as you type, with the line they are on.
  await css.press('ControlOrMeta+End');
  await page.keyboard.type('\np { color: red }');
  const problems = dialog.getByRole('list', { name: 'Problems in this style block' });
  await expect(problems).toContainText('Line 7');
  for (let i = 0; i < 17; i++) await page.keyboard.press('Backspace');
  await expect(dialog).toContainText('No problems.');
  await dialog.getByRole('button', { name: 'Done' }).click();

  const text = await exportText(page);
  expect(text).toContain(
    'STYLE\n::cue {\n  color: yellow;\n}\n::cue(v[voice="Bob"]) {\n  color: cyan;\n}\n\n',
  );
  await page.keyboard.press('Escape');

  // Deleting asks first.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Styles…' }).click();
  await dialog.getByRole('button', { name: 'Delete style block' }).click();
  await expect(dialog).toContainText('No style blocks yet.');
});

test('has no style sheets for SubRip', async ({ page }) => {
  await open(page, 'cues.srt', '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
  await expect(page.getByRole('button', { name: 'Styles…' })).toBeDisabled();
});
