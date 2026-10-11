import { expect, test, type Page } from '@playwright/test';
import { cueList, rows, status, vttInput } from './support.ts';

const FILE = [
  'WEBVTT',
  '',
  '00:00:01.000 --> 00:00:02.000',
  'One',
  '',
  '00:00:03.000 --> 00:00:04.000',
  'Two',
  '',
].join('\n');

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles({
    name: 'cues.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from(FILE),
  });
  await expect(status(page)).toContainText('2 cues');
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

const settings = (page: Page) => page.locator('details.settings');

test('edits every cue setting, with a preview and checked values', async ({ page }) => {
  await open(page);
  await settings(page).locator('summary').click();
  await expect(page.getByTestId('cue-preview')).toContainText('One');

  // Presets.
  await page
    .getByRole('group', { name: 'Place the cue' })
    .getByRole('button', { name: 'Top' })
    .click();
  await expect(page.getByLabel('Line', { exact: true })).toHaveValue('0');
  await expect(settings(page).locator('summary')).toContainText('(line)');

  // Values are checked as they are typed.
  const line = page.getByLabel('Line', { exact: true });
  await line.fill('abc');
  await line.press('Enter');
  await expect(line).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toContainText('is not a line');
  await line.fill('90%');
  await line.press('Enter');
  await expect(line).not.toHaveAttribute('aria-invalid');
  await page.getByLabel('Line align').selectOption('end');
  await page.getByLabel('Position', { exact: true }).fill('25%');
  await page.getByLabel('Position', { exact: true }).press('Enter');
  await page.getByLabel('Position align').selectOption('line-left');
  await page.getByLabel('Size').fill('120');
  await page.getByLabel('Size').press('Enter');
  await expect(page.getByRole('alert')).toContainText('not a percentage from 0 to 100');
  await page.getByLabel('Size').fill('50');
  await page.getByLabel('Size').press('Enter');
  await page.getByRole('combobox', { name: /^Align/ }).selectOption('left');

  expect(await exportText(page)).toContain(
    '00:00:01.000 --> 00:00:02.000 line:90%,end position:25%,line-left size:50% align:left\nOne\n',
  );
});

test('applies settings to all selected cues as one undo step', async ({ page }) => {
  await open(page);
  await rows(page).nth(0).click();
  await rows(page)
    .nth(1)
    .click({ modifiers: ['Shift'] });
  await settings(page).locator('summary').click();
  await expect(page.getByRole('checkbox', { name: 'Apply to all 2 selected cues' })).toBeChecked();
  await page
    .getByRole('group', { name: 'Place the cue' })
    .getByRole('button', { name: 'Top' })
    .click();
  expect(await exportText(page)).toContain(
    '00:00:01.000 --> 00:00:02.000 line:0\nOne\n\n00:00:03.000 --> 00:00:04.000 line:0\nTwo\n',
  );
  await page.keyboard.press('Escape');
  await cueList(page).focus();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await exportText(page)).not.toContain('line:0');
});

test('adds, renames, uses and deletes regions', async ({ page }) => {
  await open(page);
  await settings(page).locator('summary').click();
  await settings(page).getByRole('button', { name: 'Edit…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Regions' });
  await expect(dialog).toContainText('No regions yet.');
  await dialog.getByRole('button', { name: 'Add region' }).click();
  await expect(dialog.getByRole('list', { name: 'Regions in this file' })).toContainText('region1');

  const form = dialog.getByRole('group', { name: 'Region region1' });
  await form.getByLabel('Width (%)').fill('140');
  await form.getByLabel('Width (%)').press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('Width must be 0–100%.');
  await form.getByLabel('Width (%)').fill('40');
  await form.getByLabel('Width (%)').press('Enter');
  await form.getByLabel('Id', { exact: true }).fill('roll up');
  await form.getByLabel('Id', { exact: true }).press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('cannot contain spaces');
  await form.getByLabel('Id', { exact: true }).fill('rollup');
  await form.getByLabel('Id', { exact: true }).press('Enter');
  await dialog
    .getByRole('group', { name: 'Region rollup' })
    .getByLabel('Scroll')
    .selectOption('up');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await settings(page).getByLabel('Region').selectOption('rollup');
  const text = await exportText(page);
  expect(text).toContain('REGION\nid:rollup width:40% scroll:up\n');
  expect(text).toContain('00:00:01.000 --> 00:00:02.000 region:rollup\nOne');
  await page.keyboard.press('Escape');

  // Deleting it asks first, as a cue is in it.
  page.once('dialog', (d) => void d.accept());
  await settings(page).getByRole('button', { name: 'Edit…' }).click();
  await expect(dialog.getByRole('list', { name: 'Regions in this file' })).toContainText('1 cue');
  await dialog.getByRole('button', { name: 'Delete region rollup' }).click();
  await expect(dialog).toContainText('No regions yet.');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(settings(page).getByLabel('Region')).toHaveValue('');
});
