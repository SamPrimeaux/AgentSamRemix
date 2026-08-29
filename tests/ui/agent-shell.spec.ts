import { expect, test } from '@playwright/test';

async function expectNoHorizontalOverflow(page: any) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('Chat keeps the composer inside the viewport', async ({ page }, testInfo) => {
  await page.goto('/dashboard/agent');
  await expect(page.locator('.as-shell')).toBeVisible();
  await expect(page.locator('.as-composer')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const composer = await page.locator('.as-composer').boundingBox();
  expect(composer).not.toBeNull();
  expect(composer!.x).toBeGreaterThanOrEqual(0);
  expect(composer!.x + composer!.width).toBeLessThanOrEqual(testInfo.project.use.viewport!.width + 1);
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(testInfo.project.use.viewport!.height + 1);
});

test('Work opens as a product workspace, not an empty editor scaffold', async ({ page }) => {
  await page.goto('/dashboard/agent/editor');
  await expect(page.locator('.as-work-overview')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Build with Agent Sam' })).toBeVisible();
  await expect(page.getByText('Execution lanes')).toBeVisible();
  await expect(page.getByText('Agent runtime')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('iPhone exposes Chat Work and a bounded terminal sheet', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-393', 'mobile-only interaction contract');
  await page.goto('/dashboard/agent');
  const switcher = page.locator('.as-mobile-mode-switch');
  await expect(switcher).toBeVisible();
  await expect(switcher.getByRole('tab', { name: 'Chat' })).toBeVisible();
  await expect(switcher.getByRole('tab', { name: 'Work' })).toBeVisible();

  const terminalHandle = page.locator('.as-terminal-handle').first();
  await expect(terminalHandle).toBeVisible();
  await terminalHandle.click();
  const sheet = page.locator('.as-terminal-open').first();
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(testInfo.project.use.viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(testInfo.project.use.viewport!.height + 1);
});
