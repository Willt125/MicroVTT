import { expect, test } from '@playwright/test';
import { status, vttInput } from './support.ts';

const FILE = [
  'WEBVTT',
  'Language: fi',
  '',
  'REGION',
  'id:r',
  '',
  'NOTES',
  '00:00.000 --> 00:01.000 region:r',
  'caf&eacute; <lang fi>kiitos</lang>',
  '',
].join('\n');

async function exportText(page: import('@playwright/test').Page): Promise<string> {
  const dialog = page.getByRole('dialog');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: /^(Download|Save compat\.vtt)$/ }).click(),
  ]);
  return Buffer.concat(await (await download.createReadStream()).toArray()).toString('utf8');
}

test('offers player-compatibility fixes and the YouTube check on export', async ({ page }) => {
  await page.goto('/');
  await vttInput(page).setInputFiles({
    name: 'compat.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from(FILE),
  });
  await expect(status(page)).toContainText('1 cue');

  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog');
  const fixes = dialog.getByRole('group', { name: 'Player compatibility' });
  const ids = fixes.getByRole('checkbox', { name: /Remove cue ids that start with NOTE/ });
  const lang = fixes.getByRole('checkbox', { name: /Remove <lang> spans/ });
  await expect(ids).toBeChecked();
  await expect(
    fixes.getByRole('checkbox', { name: /REGION blocks before comments/ }),
  ).toBeChecked();
  await expect(fixes.getByRole('checkbox', { name: /Write characters instead/ })).toBeChecked();
  await expect(lang).not.toBeChecked();

  await lang.check();
  await ids.uncheck();
  await expect(dialog.getByText('Checking…')).toBeHidden();
  const vtt = await exportText(page);
  expect(vtt).toBe(
    'WEBVTT\n\nREGION\nid:r\n\nNOTE\nLanguage: fi\n\nNOTES\n00:00:00.000 --> 00:00:01.000 region:r\ncafé kiitos\n',
  );

  // The YouTube check: regions are dropped there, and an export fix avoids that.
  await page.keyboard.press('ControlOrMeta+s');
  const youtube = dialog.locator('details.youtube');
  await expect(youtube.locator('summary')).toHaveText(
    /Uploading to YouTube\?\s+1\s+feature to check/,
  );
  await youtube.locator('summary').click();
  await expect(youtube).toContainText('Regions (REGION blocks, region:): 2 (dropped');
  const regions = fixes.getByRole('checkbox', { name: /Remove STYLE and REGION blocks/ });
  await expect(regions).not.toBeChecked();
  await youtube.getByRole('button', { name: 'Tick the fixes for YouTube' }).click();
  await expect(regions).toBeChecked();
  await expect(ids).toBeChecked();
  await expect(youtube).toContainText('Avoided: "Remove STYLE and REGION blocks" is ticked.');
  await expect(youtube.getByRole('button', { name: 'Tick the fixes for YouTube' })).toBeHidden();
});
