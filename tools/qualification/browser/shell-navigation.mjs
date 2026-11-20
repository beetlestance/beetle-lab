import { expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
function navigation(page) {
  return page.getByRole('navigation', { name: 'Main navigation' });
}

/** @param {import('@playwright/test').Page} page @param {string} selected */
async function settingsLevels(page, selected) {
  const levels = page.getByRole('navigation', { name: 'Settings level' });
  for (const name of ['Installation', 'Organization', 'Workspace']) {
    await expect(levels.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(levels.getByRole('link', { name: selected, exact: true })).toHaveAttribute('aria-current', 'page');
  return levels;
}

/** @param {import('@playwright/test').Page} page @param {string} organization */
async function organizationMenu(page, organization) {
  const switcher = page.getByRole('button', { name: /switch organization/i });
  await switcher.click();
  await expect(switcher).toHaveAttribute('aria-expanded', 'true');
  const choices = page.getByRole('navigation', { name: 'Switch organization' });
  await expect(choices.getByRole('link', { name: 'Browser acceptance', exact: true })).toHaveAttribute(
    'href',
    organization,
  );
  await page.keyboard.press('Escape');
  await expect(choices).toHaveCount(0);
  await expect(switcher).toBeFocused();
}

/** @param {import('@playwright/test').Page} page @param {string} workspace */
export async function shellNavigation(page, workspace) {
  const organization = new URL(workspace).pathname.split('/').slice(0, 3).join('/');
  await page.goto(new URL('/', workspace).href);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Organizations', exact: true })).toBeVisible();
  await organizationMenu(page, organization);
  await navigation(page).getByRole('link', { name: 'Settings', exact: true }).click();
  const levels = await settingsLevels(page, 'Installation');
  await levels.getByRole('link', { name: 'Workspace', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Choose an organization', exact: true })).toBeVisible();
  await main.getByRole('link', { name: 'Browser acceptance', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Choose a workspace', exact: true })).toBeVisible();
  await main.getByRole('link', { name: 'Synthetic workspace', exact: true }).click();
  await expect(page).toHaveURL(workspace + '/settings');
  await settingsLevels(page, 'Workspace');

  await page.getByRole('link', { name: 'Beetle Lab home' }).click();
  await main.getByRole('link', { name: 'Browser acceptance', exact: true }).click();
  await organizationMenu(page, organization);
  await navigation(page)
    .getByRole('link', { name: /^Workspaces\b/ })
    .click();
  await expect(page).toHaveURL(new URL(organization + '/workspaces', workspace).href);
  await expect(main.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
  await main.getByRole('link', { name: 'Synthetic workspace', exact: true }).click();
  await page.getByRole('link', { name: 'Suites', exact: true }).click();
  await expect(page).toHaveURL(workspace + '/suites');
  await navigation(page).getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(workspace + '/settings');
  const scoped = await settingsLevels(page, 'Workspace');
  await scoped.getByRole('link', { name: 'Organization', exact: true }).click();
  await expect(page).toHaveURL(new URL(organization + '/settings', workspace).href);
  await settingsLevels(page, 'Organization');
}

/** Observe the browser's actual route animation without delaying or overriding its native duration.
 * @param {import('@playwright/test').Page} page @param {string} workspace */
export async function shellMotion(page, workspace) {
  await page.addInitScript(() => {
    const animate = globalThis.Element.prototype.animate;
    globalThis.Element.prototype.animate = function (
      /** @type {Parameters<Element['animate']>[0]} */ keyframes,
      /** @type {Parameters<Element['animate']>[1]} */ options,
    ) {
      const movement = animate.call(this, keyframes, options);
      const effect = movement.effect;
      if (this.parentElement?.id === 'main' && effect instanceof globalThis.KeyframeEffect) {
        globalThis.document.documentElement.dataset.routeMotion = JSON.stringify({
          frames: effect.getKeyframes().map(({ opacity }) => opacity),
          duration: effect.getTiming().duration,
        });
      }
      return movement;
    };
  });
  for (const reducedMotion of /** @type {const} */ (['no-preference', 'reduce'])) {
    await page.emulateMedia({ reducedMotion });
    await page.goto(workspace);
    const root = page.locator('html');
    await expect(page.getByRole('link', { name: 'Suites', exact: true })).toBeVisible();
    await root.evaluate((node) => node.removeAttribute('data-route-motion'));
    await page.getByRole('link', { name: 'Suites', exact: true }).click();
    await expect(page).toHaveURL(workspace + '/suites');
    await expect(page.getByRole('heading', { name: 'Synthetic workspace', exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Folders', exact: true })).toBeVisible();
    if (reducedMotion === 'reduce') {
      expect(await root.getAttribute('data-route-motion')).toBeNull();
    } else {
      await expect(root).toHaveAttribute('data-route-motion', /"duration":[1-9]/);
      const observed = JSON.parse((await root.getAttribute('data-route-motion')) ?? '{}');
      expect(Number(observed.duration)).toBeCloseTo(180);
      expect(Number(observed.frames[0])).toBeLessThan(1);
      expect(Number(observed.frames.at(-1))).toBe(1);
    }
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

/** @param {import('@playwright/test').Page} page @param {string} workspace */
export async function phoneShellNavigation(page, workspace) {
  const organization = new URL(workspace).pathname.split('/').slice(0, 3).join('/');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(workspace);
  await organizationMenu(page, organization);
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await menu.click();
  await navigation(page)
    .getByRole('link', { name: /^Workspaces\b/ })
    .click();
  await expect(page).toHaveURL(new URL(organization + '/workspaces', workspace).href);
  await expect(page.getByRole('main').getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 1440, height: 900 });
}
