import { expect, test } from '@playwright/test';
import { openSample } from './support.ts';

/**
 * A dialog's close event is queued as a task, so it can arrive after the dialog has been
 * reopened (Ctrl+S right after saving on a slow machine); it must not close it again.
 */
test('the export dialog reopens right after closing', async ({ page }) => {
  await openSample(page);
  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Checking…')).toBeHidden();
  // Close and reopen within one task, before the dialog's (asynchronous) close event fires.
  await page.evaluate(async () => {
    const cancel = [...document.querySelectorAll('dialog button')].find(
      (b) => b.textContent === 'Cancel',
    ) as HTMLButtonElement;
    cancel.click();
    // Let Svelte's effects run (microtasks), which closes the dialog; its close event is a task.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
  });
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog')).toBeVisible();
});
