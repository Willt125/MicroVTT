import { expect, test, type Page } from '@playwright/test';
import { cueText, mediaInput, openSample, rows, status, vttInput, wav } from './support.ts';

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

test('wraps timed text so the paint-on style hides words not yet spoken', async ({ page }) => {
  await open(page, 'One two three');
  const panel = page.locator('details.karaoke');
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'Spread over words' }).click();
  const wrap = panel.getByRole('group', { name: 'Wrap timed text' });
  await expect(wrap).toContainText('Some timed text here is not in a tag');

  // The Styles dialog's paint-on rule says it cannot reach the text yet, and offers the fix.
  await page.getByRole('button', { name: 'Styles…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Styles' });
  await dialog.getByRole('button', { name: 'Add style block' }).click();
  const css = dialog.getByLabel('CSS');
  await css.fill('');
  await dialog
    .getByLabel('Add a rule for')
    .selectOption({ label: 'Words not yet spoken, hidden (paint-on)' });
  await expect(css).toHaveValue('::cue(:future) {\n  visibility: hidden;\n}');
  const note = dialog.getByRole('status').filter({ hasText: 'outside any tag' });
  await expect(note).toContainText('1 cue has timed text outside any tag');
  await note.getByRole('button', { name: 'Wrap it in <c>' }).click();
  await expect(note).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();
  const wrapped = '<c>One </c><00:00:01.818><c>two </c><00:00:02.636><c>three</c>';
  await expect(cueText(page)).toHaveValue(wrapped);
  await expect(wrap).toHaveCount(0);

  // The same from the word timing panel, as one undo step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(cueText(page)).toHaveValue('One <00:00:01.818>two <00:00:02.636>three');
  await wrap.getByRole('button', { name: 'Wrap in <c>' }).click();
  await expect(cueText(page)).toHaveValue(wrapped);

  // Between the two timings, the last word is hidden and keeps its place.
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
  await page.locator('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 2.2));
  const word = (w: string) => page.locator('.media .vtt-node', { hasText: w });
  await expect(word('three')).toHaveCSS('visibility', 'hidden');
  await expect(word('two')).toHaveCSS('visibility', 'visible');
  await expect(word('One')).toHaveCSS('visibility', 'visible');
});

test('the growing-box paint-on style puts every cue in <c> and backs only the words shown', async ({
  page,
}) => {
  await page.goto('/');
  await vttInput(page).setInputFiles({
    name: 'cues.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from(
      'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nOne <00:00:02.000>two <00:00:03.000><i>three</i>\n\n' +
        '00:00:05.000 --> 00:00:07.000\nNo timings\n\n' +
        '00:00:08.000 --> 00:00:09.500\n<c.bg_yellow>Yellow</c>\n',
    ),
  });
  await expect(status(page)).toContainText('3 cues');
  await page.getByRole('button', { name: 'Styles…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Styles' });
  await dialog.getByRole('button', { name: 'Add style block' }).click();
  await dialog.getByLabel('CSS').fill('');
  await dialog
    .getByLabel('Add a rule for')
    .selectOption({ label: 'Words not yet spoken, hidden, box growing with them (paint-on)' });
  await expect(dialog).toContainText('No problems.');
  const note = dialog.getByRole('status').filter({ hasText: 'without a background' });
  await expect(note).toContainText('2 cues have text outside a <c>');
  await note.getByRole('button', { name: 'Wrap it in <c>' }).click();
  await expect(note).toHaveCount(0);
  await expect(dialog.getByRole('status').filter({ hasText: 'outside any tag' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(cueText(page)).toHaveValue(
    '<c>One </c><00:00:02.000><c>two </c><00:00:03.000><c><i>three</i></c>',
  );

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
  const word = (w: string) => page.locator('.media .vtt-node', { hasText: w }).first();
  await page.locator('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 2.5));
  // The cue's own box is gone; each word shown has its own, and the next is hidden with it.
  await expect(page.locator('.media .vtt-bg').first()).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  await expect(word('One')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.8)');
  await expect(word('two')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.8)');
  await expect(word('three')).toHaveCSS('visibility', 'hidden');
  // The cue without timings keeps a box, from its <c>.
  await page.locator('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 6));
  await expect(word('No timings')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.8)');
  // The spec's background colour classes still show.
  await page.locator('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 8.5));
  await expect(word('Yellow')).toHaveCSS('background-color', 'rgb(255, 255, 0)');

  // A cue added later is listed with the problems, and wrapped from there.
  const panel = page.locator('details.styles-miss');
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Add cue' }).click();
  await cueText(page).fill('New words');
  await expect(panel.locator('summary')).toHaveText('Not reached by the styles (1)');
  await expect(panel).toContainText('text outside one shows without a background');
  await panel.getByRole('button', { name: 'Wrap in <c> (1 cue)' }).click();
  await expect(cueText(page)).toHaveValue('<c>New words</c>');
  await expect(panel).toHaveCount(0);
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
  // Clicked with the mouse, Tap keeps focus, so Space goes on tapping.
  await tap.click();
  await expect(tap).toBeFocused();
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

test('the cue list stays usable in a short window, with the editor scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await openSample(page);
  await mediaInput(page).setInputFiles({
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: wav(20),
  });
  const list = await page.getByRole('listbox', { name: 'Cues' }).boundingBox();
  expect(list?.height).toBeGreaterThan(60);
  await rows(page).nth(2).click();
  await expect(rows(page).nth(2)).toHaveAttribute('aria-selected', 'true');
});
