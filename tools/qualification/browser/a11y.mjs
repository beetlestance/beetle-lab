// Accessibility scan with axe-core (WCAG 2.1 A/AA) in a real browser.
//
//   node tools/qualification/browser/a11y.mjs site            # built docs site (site/dist), both skins
//   node tools/qualification/browser/a11y.mjs app <origin>    # a running installation, e.g. http://127.0.0.1:4567
//
// Every page is scanned as loaded and again after each button in the docs diagrams is
// pressed, so selected and pressed states are covered. BEETLE_BROWSER_CHANNEL=chrome uses an
// installed Chrome instead of Playwright's bundled Chromium. Exits 1 on any violation.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SKINS = ['darkroom', 'scarab'];
const MAX_APP_PAGES = 40;
/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

/** @typedef {{ label: string, rule: string, impact: string | null | undefined, target: string, summary: string }} Finding */
/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Browser} Browser */

/**
 * Serves site/dist under /docs, as the frontend image does.
 * @param {string} root
 * @returns {Promise<import('node:http').Server>}
 */
function serveSite(root) {
  const server = createServer((request, response) => {
    let file = join(root, decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname).replace(/^\/docs/, ''));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(root) || !existsSync(file)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(response);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

/**
 * @param {string} root
 * @param {string} [directory]
 * @returns {string[]}
 */
function sitePages(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return ['_astro', 'pagefind'].includes(entry.name) ? [] : sitePages(root, path);
    return entry.name === 'index.html' ? [`/docs${path.slice(root.length).replace(/index\.html$/, '')}`] : [];
  });
}

/**
 * @param {Page} page
 * @param {string} label
 * @param {Finding[]} findings
 */
async function scan(page, label, findings) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const violation of result.violations)
    for (const node of violation.nodes)
      findings.push({
        label,
        rule: violation.id,
        impact: violation.impact,
        target: node.target.join(' '),
        summary: node.failureSummary?.split('\n')[1]?.trim() ?? violation.help,
      });
}

/**
 * Scans the page as loaded, then after pressing each diagram button.
 * @param {Page} page
 * @param {string} label
 * @param {Finding[]} findings
 */
async function scanStates(page, label, findings) {
  await scan(page, label, findings);
  const buttons = await page.locator('main [class*="bl-"] button:visible').all();
  for (const [index, button] of buttons.entries()) {
    await button.click({ timeout: 1000 }).catch(() => undefined);
    await scan(page, `${label} after button ${index + 1}`, findings);
  }
}

/**
 * @param {Browser} browser
 * @param {Finding[]} findings
 */
async function siteScan(browser, findings) {
  const root = resolve('site/dist');
  if (!existsSync(join(root, 'index.html'))) throw new Error('site/dist is missing; run npm run build in site/ first');
  const server = await serveSite(root);
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  const origin = `http://127.0.0.1:${address.port}`;
  const pages = sitePages(root);
  try {
    for (const skin of SKINS)
      for (const path of pages) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        await page.addInitScript((value) => globalThis.localStorage.setItem('beetle.theme', value), skin);
        await page.goto(origin + path);
        await scanStates(page, `${skin} ${path}`, findings);
        await context.close();
      }
  } finally {
    server.close();
  }
  return pages.length * SKINS.length;
}

/**
 * Follows same-origin links from the start page, up to MAX_APP_PAGES pages.
 * @param {Browser} browser
 * @param {string} origin
 * @param {Finding[]} findings
 */
async function appScan(browser, origin, findings) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const queue = [new URL('/', origin).href];
  const seen = new Set(queue);
  let scanned = 0;
  while (queue.length && scanned < MAX_APP_PAGES) {
    const url = /** @type {string} */ (queue.shift());
    await page.goto(url);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    await scan(page, new URL(url).pathname, findings);
    scanned += 1;
    for (const href of await page
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => /** @type {HTMLAnchorElement} */ (link).href))) {
      const next = new URL(href);
      next.hash = '';
      if (next.origin === new URL(origin).origin && !next.pathname.startsWith('/docs') && !seen.has(next.href)) {
        seen.add(next.href);
        queue.push(next.href);
      }
    }
  }
  await context.close();
  return scanned;
}

const [target, origin] = process.argv.slice(2);
if (target !== 'site' && !(target === 'app' && origin)) {
  console.error('usage: a11y.mjs site | a11y.mjs app <origin>');
  process.exit(2);
}
const channel = process.env.BEETLE_BROWSER_CHANNEL;
const browser = await chromium.launch(channel ? { headless: true, channel } : { headless: true });
/** @type {Finding[]} */
const findings = [];
try {
  const pages =
    target === 'site' ? await siteScan(browser, findings) : await appScan(browser, String(origin), findings);
  const unique = new Map();
  for (const finding of findings) {
    const key = `${finding.rule} ${finding.target} ${finding.label.replace(/ after button \d+$/, '')}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  for (const f of unique.values()) console.log(`${f.impact ?? 'n/a'} ${f.rule} [${f.label}] ${f.target}: ${f.summary}`);
  console.log(`Scanned ${pages} page views with axe (${TAGS.join(', ')}): ${unique.size} violations.`);
  if (unique.size) process.exitCode = 1;
} finally {
  await browser.close();
}
