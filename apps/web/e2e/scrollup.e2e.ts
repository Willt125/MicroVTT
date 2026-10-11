import { expect, test, type Page } from '@playwright/test';
import { mediaInput, status, vttInput, wav } from './support.ts';

const FILE = [
  'WEBVTT',
  '',
  'REGION',
  'id:roll width:80% lines:3 scroll:up',
  '',
  '00:00.000 --> 00:09.000 region:roll',
  'One',
  '',
  '00:01.000 --> 00:09.000 region:roll',
  'Two',
  '',
  '00:05.000 --> 00:09.000 region:roll',
  'Three',
  '',
].join('\n');

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await vttInput(page).setInputFiles({
    name: 'roll.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from(FILE),
  });
  await expect(status(page)).toContainText('3 cues');
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
  // Record the cue boxes' transitions on `top`.
  await page.getByTestId('spec-captions').evaluate((overlay) => {
    const log: string[] = [];
    (window as unknown as { transitions: string[] }).transitions = log;
    for (const type of ['transitionrun', 'transitionend'])
      overlay.addEventListener(type, (e) => {
        const t = e as TransitionEvent;
        if (t.propertyName === 'top') log.push(`${type}:${(t.target as HTMLElement).textContent}`);
      });
  });
}

const seek = (page: Page, s: number) =>
  page.locator('video').evaluate((v: HTMLVideoElement, t) => (v.currentTime = t), s);
const lines = (page: Page) => page.getByTestId('spec-captions').locator('.vtt-region .vtt-cue');
const transitions = (page: Page) =>
  page.evaluate(() => (window as unknown as { transitions: string[] }).transitions);

test('scroll-up regions move their lines up as a new one comes in', async ({ page }) => {
  await open(page);
  await seek(page, 0.5);
  await expect(lines(page)).toHaveCount(1);
  await seek(page, 1.2);
  await expect(lines(page)).toHaveCount(2);
  // Both lines slide up together (the new one from below the region's edge), over 0.433 s.
  await expect
    .poll(() => transitions(page))
    .toEqual(expect.arrayContaining(['transitionrun:One', 'transitionrun:Two']));
  await expect
    .poll(() => transitions(page))
    .toEqual(expect.arrayContaining(['transitionend:One', 'transitionend:Two']));
  await expect(lines(page).first()).toHaveCSS('top', '0px');
  expect(
    await lines(page)
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe('0.433s');

  // A jump (seeking) redraws without the animation.
  await page.evaluate(
    () => ((window as unknown as { transitions: string[] }).transitions.length = 0),
  );
  await seek(page, 6);
  await expect(lines(page)).toHaveCount(3);
  await page.waitForTimeout(600);
  expect(await transitions(page)).toEqual([]);
});

test('no animation for viewers who prefer reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await seek(page, 0.5);
  await expect(lines(page)).toHaveCount(1);
  await seek(page, 1.2);
  await expect(lines(page)).toHaveCount(2);
  await page.waitForTimeout(600);
  expect(await transitions(page)).toEqual([]);
});
