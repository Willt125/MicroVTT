import { expect, test, type Page } from '@playwright/test';
import { cueText, mediaInput, status, vttInput, wav } from './support.ts';

async function open(page: Page, text: string): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles({
    name: 'cues.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from(`WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n${text}\n`),
  });
  await expect(status(page)).toContainText('1 cue');
}

/** Puts the caret at `start` in the text field and selects `length` characters with the keyboard. */
async function selectText(page: Page, start: number, length = 0): Promise<void> {
  await cueText(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let i = 0; i < start; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < length; i++) await page.keyboard.press('Shift+ArrowRight');
}

const tools = (page: Page) => page.getByRole('toolbar', { name: 'Text markup' });
const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Markup at the cursor' });

test('wraps, toggles and removes spans with the markup tools', async ({ page }) => {
  await open(page, 'Hello there friend');
  await selectText(page, 6, 5); // "there"
  await tools(page).getByRole('button', { name: 'I', exact: true }).click();
  await expect(cueText(page)).toHaveValue('Hello <i>there</i> friend');
  await expect(tools(page).getByRole('button', { name: 'I', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(crumbs(page)).toContainText('Italic');

  // The wrapped text stays selected: a shortcut applies to it too.
  await page.keyboard.press('ControlOrMeta+b');
  await expect(cueText(page)).toHaveValue('Hello <i><b>there</b></i> friend');

  // A voice around everything.
  await cueText(page).press('ControlOrMeta+a');
  await tools(page).getByRole('button', { name: 'Voice…' }).click();
  const form = page.getByRole('form', { name: 'Add voice' });
  await form.getByLabel('Voice (speaker)').fill('Bob & Ann');
  await form.getByLabel('Voice (speaker)').press('Enter');
  await expect(cueText(page)).toHaveValue('<v Bob &amp; Ann>Hello <i><b>there</b></i> friend</v>');

  // The breadcrumb at the cursor, and removing a span from it.
  await selectText(page, 30); // Inside "there".
  await expect(crumbs(page)).toContainText('Voice Bob &amp; Ann');
  await expect(crumbs(page)).toContainText('Bold');
  await crumbs(page).getByRole('button', { name: 'Remove Italic' }).click();
  await expect(cueText(page)).toHaveValue('<v Bob &amp; Ann>Hello <b>there</b> friend</v>');

  // Taking part of a span out.
  await selectText(page, 0);
  await cueText(page).fill('<i>one two three</i>');
  await selectText(page, 7, 3); // "two"
  await page.keyboard.press('ControlOrMeta+i');
  await expect(cueText(page)).toHaveValue('<i>one </i>two<i> three</i>');

  // Checked values.
  await tools(page).getByRole('button', { name: 'Language…' }).click();
  const lang = page.getByRole('form', { name: 'Add language' });
  await lang.getByLabel('Language').fill('not a tag');
  await lang.getByLabel('Language').press('Enter');
  await expect(lang.getByRole('alert')).toContainText('not a BCP 47 language tag');
  await lang.getByLabel('Language').press('Escape');
  await expect(lang).toBeHidden();

  // Clear with no selection removes all the markup.
  await selectText(page, 0);
  await tools(page).getByRole('button', { name: 'Clear' }).click();
  await expect(cueText(page)).toHaveValue('one two three');
});

test('adds ruby and classes, and offers what the file uses', async ({ page }) => {
  await open(page, '<c.loud>x</c> 漢字');
  await selectText(page, 14, 2);
  await tools(page).getByRole('button', { name: 'Ruby…' }).click();
  await page.getByLabel('Ruby text (reading)').fill('かんじ');
  await page.getByLabel('Ruby text (reading)').press('Enter');
  await expect(cueText(page)).toHaveValue('<c.loud>x</c> <ruby>漢字<rt>かんじ</rt></ruby>');
  await selectText(page, 8, 1);
  await tools(page).getByRole('button', { name: 'Class…' }).click();
  await expect(page.locator('#markup-suggestions option')).toHaveAttribute('value', 'loud');
  await page.getByLabel('Class name').fill('two words');
  await page.getByLabel('Class name').press('Enter');
  await expect(page.getByRole('alert')).toContainText('cannot contain spaces');
  await page.getByLabel('Class name').fill('soft');
  await page.getByLabel('Class name').press('Enter');
  await expect(cueText(page)).toHaveValue(
    '<c.loud><c.soft>x</c></c> <ruby>漢字<rt>かんじ</rt></ruby>',
  );
});

test('SubRip gets its own tags and no WebVTT-only tools', async ({ page }) => {
  await page.goto('/');
  await vttInput(page).setInputFiles({
    name: 'cues.srt',
    mimeType: 'text/plain',
    buffer: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nstruck out\n'),
  });
  await expect(status(page)).toContainText('1 cue');
  await expect(tools(page).getByRole('button', { name: 'Voice…' })).toHaveCount(0);
  await expect(page.locator('details.karaoke')).toHaveCount(0);
  await selectText(page, 0, 6);
  await tools(page).getByRole('button', { name: 'S', exact: true }).click();
  await expect(cueText(page)).toHaveValue('<s>struck</s> out');
});

test('edits word timings without media', async ({ page }) => {
  await open(page, 'One two three');
  const panel = page.locator('details.karaoke');
  await panel.locator('summary').click();
  await expect(panel).toContainText('(none)');
  await panel.getByRole('button', { name: 'Spread over words' }).click();
  await expect(cueText(page)).toHaveValue('One <00:00:01.818>two <00:00:02.636>three');
  const timings = panel.getByRole('list', { name: 'Word timings' });
  await expect(timings.getByRole('listitem')).toHaveCount(2);
  await expect(timings.getByRole('listitem').first()).toContainText('two');

  await timings.getByLabel('Timing 1', { exact: true }).fill('5');
  await timings.getByLabel('Timing 1', { exact: true }).press('Enter');
  await expect(timings).toContainText('Not inside the cue');
  await expect(panel.locator('summary')).toContainText('1 to check');
  await panel.getByRole('button', { name: 'Remove timing 1' }).click();
  await expect(cueText(page)).toHaveValue('One two <00:00:02.636>three');

  // Without media, a timing goes halfway between the ones either side.
  await selectText(page, 4);
  await panel.getByRole('button', { name: 'Insert at cursor' }).click();
  await expect(cueText(page)).toHaveValue('One <00:00:01.818>two <00:00:02.636>three');
  await panel.getByRole('button', { name: 'Remove all' }).click();
  await expect(cueText(page)).toHaveValue('One two three');
});

test('taps word timings while the media plays', async ({ page }) => {
  await open(page, 'One two three');
  await mediaInput(page).setInputFiles({
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: wav(10),
  });
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState), {
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(1);
  const panel = page.locator('details.karaoke');
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'Tap timing…' }).click();
  const tap = panel.getByRole('button', { name: 'Tap', exact: true });
  await expect(tap).toBeFocused();
  await expect(panel.getByRole('status')).toContainText('Next: two (2 of 3)');
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  await expect(panel.getByRole('status')).toContainText('Next: three (3 of 3)');
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  // Done after the last word: tapping stops and the media pauses.
  await expect(tap).toBeHidden();
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  const text = await cueText(page).inputValue();
  const times = [...text.matchAll(/<00:00:(\d\d\.\d{3})>/g)].map((m) => Number(m[1]));
  expect(text).toMatch(/^One <[\d:.]+>two <[\d:.]+>three$/);
  expect(times).toHaveLength(2);
  expect(times[0]).toBeGreaterThan(1);
  expect(times[1]).toBeGreaterThan(times[0] as number);
});
