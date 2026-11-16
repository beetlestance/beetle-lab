import {expect} from '@playwright/test';
/** @param {import('@playwright/test').Page} page @param {string} origin */
export async function keyboard(page, origin) {
  await page.goto(origin); await expect(page.getByRole('heading', {name: 'Organizations', exact: true})).toBeVisible();
  const skip = page.getByRole('link', {name: 'Skip to content'});
  // The session toolbar precedes the app shell in document order.
  for (let tabs = 0; tabs < 3; tabs++) {await page.keyboard.press('Tab'); if (await skip.evaluate(node => node === globalThis.document.activeElement)) break;}
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#main')).toBeFocused();
  await page.keyboard.press('Tab'); const invoker = page.getByRole('button', {name: 'Search commands', exact: true});
  await expect(invoker).toBeFocused(); await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', {name: 'Search commands', exact: true}); await expect(dialog).toBeVisible();
  const input = page.getByRole('searchbox', {name: 'Search commands and recent items'}); await expect(input).toBeFocused();
  const controls = await dialog.locator('input,button:not([disabled]),a[href]').count(); expect(controls).toBeLessThanOrEqual(60);
  for (let i = 0; i < controls + 2; i++) {
    await page.keyboard.press('Tab'); expect(await dialog.evaluate(node => node.contains(globalThis.document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(invoker).toBeFocused();
  await page.keyboard.press('Control+k'); await input.fill('API reference'); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('navigation', {name: 'Command search results'}).getByRole('link', {name: /^API reference/})).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page).toHaveURL(new URL('/reference', origin).href);
  await expect(page.locator('#main')).toBeFocused(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
/** @param {import('@playwright/test').Page} page @param {string} workspace */
export async function themesAndViewports(page, workspace) {
  await page.emulateMedia({reducedMotion: 'no-preference'}); await page.goto(workspace);
  const section = page.locator('.content-section').first(); await expect(section).toBeVisible();
  expect(await section.evaluate(node => globalThis.getComputedStyle(node).animationName)).not.toBe('none');
  await page.getByRole('combobox', {name: 'Theme', exact: true}).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const light = await page.locator('html').evaluate(node => globalThis.getComputedStyle(node).getPropertyValue('--canvas'));
  await page.getByRole('combobox', {name: 'Theme', exact: true}).selectOption('dark'); await page.reload();
  await expect(page.getByRole('combobox', {name: 'Theme', exact: true})).toHaveValue('dark');
  const dark = await page.locator('html').evaluate(node => globalThis.getComputedStyle(node).getPropertyValue('--canvas')); expect(dark).not.toBe(light);
  await page.getByRole('combobox', {name: 'Theme', exact: true}).selectOption('system'); await page.emulateMedia({colorScheme: 'dark', reducedMotion: 'reduce'});
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  expect(await page.locator('html').evaluate(node => globalThis.getComputedStyle(node).getPropertyValue('--canvas'))).toBe(dark);
  for (const viewport of [{width: 375, height: 812}, {width: 768, height: 1024}, {width: 1440, height: 900}]) {
    await page.setViewportSize(viewport); await page.reload();
    await expect(page.getByRole('button', {name: 'Create folder', exact: true})).toBeVisible();
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.window.innerWidth + 1)).toBe(true);
    const theme = page.getByRole('combobox', {name: 'Theme', exact: true}); await theme.scrollIntoViewIfNeeded();
    const box = await theme.boundingBox(); if (!box) throw Error('Theme control has no layout box');
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.getByRole('button', {name: 'Search commands', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Search commands', exact: true}); await expect(dialog).toBeVisible();
    expect(await section.evaluate(node => globalThis.getComputedStyle(node).animationName)).toBe('none');
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  }
  await page.emulateMedia({colorScheme: 'light', reducedMotion: 'no-preference'}); await page.setViewportSize({width: 1440, height: 900});
}
