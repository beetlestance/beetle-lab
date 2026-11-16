import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {expect} from '@playwright/test';
const assets = [
 {label: 'Download API reference', path: '/reference/public-api.md', filename: 'public-api.md', type: 'text/plain'},
 {label: 'Download schema catalogue', path: '/reference/public-api.json', filename: 'public-api.json', type: 'application/json'},
 {label: 'Download k6 configuration schemas', path: '/reference/k6-config.json', filename: 'k6-config.json', type: 'application/json'},
 {label: 'Download agent instructions', path: '/reference/beetle-lab/SKILL.md', filename: 'SKILL.md', type: 'text/plain'},
];
/** @param {string} file */
async function downloaded(file) {
 const handle = await open(file, 'r');
 try {const stat = await handle.stat(); assert(stat.isFile() && stat.size > 0 && stat.size <= 2097152); return await handle.readFile();}
 finally {await handle.close();}
}
/** @param {import('@playwright/test').Page} page @param {import('../native-application/compose/fixture.ts').Fixture} f */
export async function reference(page, f) {
 let apiReads = 0;
 /** @param {import('@playwright/test').Request} request */
 const record = request => {if (new URL(request.url()).pathname.startsWith('/api/v2/')) {apiReads = Math.min(33, apiReads + 1);}};
 page.on('request', record);
 try {
  await page.getByRole('link', {name: 'API reference', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Public API reference', exact: true})).toBeVisible();
  await page.getByLabel('Filter JSON operations', {exact: true}).fill('getInstallationSettings');
  await page.getByRole('button', {name: 'Inspect getInstallationSettings', exact: true}).click();
  const selected = page.getByRole('region', {name: 'Selected operation', exact: true});
  await expect(selected.getByRole('heading', {name: 'getInstallationSettings', exact: true})).toBeVisible();
  await expect(selected).toContainText('GET /api/v2/settings'); await expect(selected).toContainText('HTTP 200');
  await expect(selected).toContainText('Implemented in the standard configuration');
  await expect(page.getByRole('region', {name: 'Successful response schema', exact: true})).toContainText('settings#/$defs/SettingsIdentity');
  await page.getByLabel('Filter JSON operations', {exact: true}).fill('no_such_native_operation');
  await expect(page.getByText('No matching operations.', {exact: true})).toBeVisible();
  await page.getByLabel('Filter JSON operations', {exact: true}).fill('getInstallationSettings');
  await expect(page.getByRole('region', {name: 'Binary transfer reference', exact: true})).toContainText('verify complete bytes and SHA256');
  assert.equal(apiReads, 0, 'Reference navigation/filter/schema selection must not issue API operations');
 } finally {page.off('request', record);}
 const id = f.compose('ps', '-q', 'frontend'); assert.match(id, /^[a-f0-9]{64}$/);
 const results = [];
 for (const asset of assets) {
  const native = '/usr/share/nginx/html' + asset.path;
  const digest = f.docker.run(['exec', '--user', '1000:1000', id, 'sha256sum', native]).split(' ', 1)[0]; assert(digest && /^[a-f0-9]{64}$/.test(digest));
  const size = Number(f.docker.run(['exec', '--user', '1000:1000', id, 'stat', '-c', '%s', native])); assert(Number.isSafeInteger(size) && size > 0 && size <= 2097152);
  const link = page.getByRole('link', {name: asset.label, exact: true}); await expect(link).toHaveAttribute('href', asset.path);
  const pending = page.waitForEvent('download'); await link.click(); const download = await pending; assert.equal(download.suggestedFilename(), asset.filename);
  const path = join(f.root, 'reference-' + asset.filename); await download.saveAs(path); const bytes = await downloaded(path);
  assert.equal(bytes.length, size); assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  const head = await page.request.head(f.origin + asset.path, {timeout: 3000}); assert.equal(head.status(), 200);
  assert.equal(Number(head.headers()['content-length']), size); assert(head.headers()['content-type']?.startsWith(asset.type)); assert.equal(head.headers()['x-content-type-options'], 'nosniff');
  const denied = await page.request.post(f.origin + asset.path, {data: 'synthetic', timeout: 3000}); assert.equal(denied.status(), 405);
  if (asset.filename === 'SKILL.md') {assert(bytes.toString().startsWith('---\nname: beetle-lab\n')); assert.match(bytes.toString(), /Raw shell hooks are unsupported/); assert.match(bytes.toString(), /MIT License/);}
  results.push({filename: asset.filename, bytes: size, sha256: digest});
 }
 assert.equal((await page.request.get(f.origin + '/reference/not-shipped.json', {timeout: 3000})).status(), 404);
 assert.equal((await page.request.get(f.origin + '/api/v2/settings', {timeout: 3000})).status(), 200);
 return {assets: results, implementedSettingsRead: true, referenceIssuedApiRequests: apiReads, retiredShellNotice: true};
}
