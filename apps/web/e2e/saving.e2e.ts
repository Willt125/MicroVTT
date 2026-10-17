/** Naming the file in the editor, and saving it where the user chooses. */
import { expect, test } from '@playwright/test';
import { openSample, savedFile, status, stubSaveDialog } from './support.ts';

test.beforeEach(async ({ page }) => {
  await openSample(page);
});

test('renames the file from its name in the toolbar', async ({ page }) => {
  await page.getByRole('button', { name: 'autocaption-sample.vtt' }).click();
  const name = page.getByRole('textbox', { name: 'File name' });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('autocaption-sample');

  // A name the system would refuse stays open with the reason.
  await name.fill('a/b');
  await name.press('Enter');
  await expect(page.locator('#rename-error')).toContainText('cannot contain');
  // Escape gives up.
  await name.press('Escape');
  await expect(status(page)).toContainText('autocaption-sample.vtt');

  await page.getByRole('button', { name: 'autocaption-sample.vtt' }).click();
  // A subtitle extension typed at the end is the format's own.
  await name.fill('Episode 1.5.srt');
  await name.press('Enter');
  await expect(status(page)).toContainText('Episode 1.5.vtt • edited');
  await expect(page).toHaveTitle('• Episode 1.5.vtt — MicroVTT');

  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('heading', { name: 'Export Episode 1.5.vtt' })).toBeVisible();
  const saved = await savedFile(page);
  expect(saved.name).toBe('Episode 1.5.vtt');
  await expect(status(page)).not.toContainText('edited');
});

test('saves through the save dialog where the browser has one', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: /^Export/ });
  if (!(await stubSaveDialog(page))) {
    // Firefox and Safari can only download: the dialog says how to be asked where.
    await page.keyboard.press('ControlOrMeta+s');
    await expect(dialog).toContainText('Always ask you where to save files');
    await expect(dialog.locator('.actions .primary')).toHaveText('Save autocaption-sample.vtt');
    return;
  }
  await page.keyboard.press('ControlOrMeta+s');
  // No straight-to-Downloads button: the user chooses where.
  await expect(dialog.getByRole('button', { name: 'Download' })).toHaveCount(0);
  await expect(dialog.locator('.actions .primary')).toHaveText('Save as…');
  await savedFile(page);

  // Saved there, the next export offers to save to that file again...
  await page.keyboard.press('ControlOrMeta+s');
  await expect(dialog.locator('.actions .primary')).toHaveText('Save to autocaption-sample.vtt');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // ...until the file is renamed: then only Save as…, under the new name.
  await page.getByRole('button', { name: 'autocaption-sample.vtt' }).click();
  await page.getByRole('textbox', { name: 'File name' }).fill('renamed');
  await page.getByRole('textbox', { name: 'File name' }).press('Enter');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(dialog.getByRole('button', { name: /^Save to/ })).toHaveCount(0);
  expect((await savedFile(page)).name).toBe('renamed.vtt');
});

test('offers a download when the save dialog cannot open', async ({ page }) => {
  const pickers = await page.evaluate(() => 'showSaveFilePicker' in window);
  test.skip(!pickers, 'Only browsers with a save dialog');
  await page.evaluate(() => {
    Object.assign(window, {
      showSaveFilePicker: async () => {
        throw new DOMException('Not allowed here.', 'SecurityError');
      },
    });
  });
  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog', { name: /^Export/ });
  await expect(dialog.getByText('Checking…')).toBeHidden();
  await dialog.getByRole('button', { name: 'Save as…' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save: Not allowed here.');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download instead' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('autocaption-sample.vtt');
});
