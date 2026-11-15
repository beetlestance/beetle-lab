import {readFile, mkdtemp, writeFile, rm, readlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {expect, it} from 'vitest';
import {captureSourceCatalog, sourceName, sourceUrl} from './catalog.js';
import type {RecipeFile} from './catalog.js';
import {sourceLinkTarget, sourceHash, finishRecipeFile} from './fetch.js';
import {npmSources} from './npm.js';
import {verifySourceCoverage, verifyRuntimeSource, verifyK6Module} from './coverage.js';
async function catalog() {return captureSourceCatalog(JSON.parse(await readFile(new URL('./catalog.json', import.meta.url), 'utf8')) as unknown);}
it('captures the pinned catalog and refuses incomplete recipes or changed k6 provenance', async () => {
  const data = await catalog(); expect(data.alpine).toHaveLength(14);
  const missing = structuredClone(data); missing.alpine[0]!.sourceChecksums['missing.patch'] = 'a'.repeat(128);
  expect(() => captureSourceCatalog(missing)).toThrow('Incomplete');
  const duplicate = structuredClone(data); duplicate.alpine.push(duplicate.alpine[0]!);
  expect(() => captureSourceCatalog(duplicate)).toThrow('Duplicate');
  const changed = structuredClone(data); changed.k6Binary.revision = 'a'.repeat(40);
  expect(() => captureSourceCatalog(changed)).toThrow('provenance');
  const omitted = structuredClone(data); const recipe = omitted.alpine.find(item => item.origin === 'alpine-baselayout')!;
  recipe.recipeFiles = recipe.recipeFiles.filter(file => file.name !== 'alpine-baselayout.post-upgrade');
  expect(() => captureSourceCatalog(omitted)).toThrow('tree mismatch');
  const mode = structuredClone(data); mode.alpine[0]!.recipeFiles[0]!.mode = '100755';
  expect(() => captureSourceCatalog(mode)).toThrow('tree mismatch');
});
it('refuses escaped leaves and credentialed or non-HTTPS source URLs', () => {
  expect(sourceName('alpine-devel@lists.example-1.rsa.pub')).toContain('@');
  for (const name of ['..', '.', '../other', '/absolute', 'x\0y']) expect(() => sourceName(name)).toThrow();
  for (const url of ['http://example.com/source', 'https://user:secret@example.com/a', 'https://example.com:8443/a'])
    expect(() => sourceUrl(url)).toThrow();
});
it('requires all OS origins and exact versions, regardless of license classification', async () => {
  const data = await catalog(); const pkg = {SrcName: 'alpine-base', SrcVersion: '3.24.4-r0'};
  const scan = {Results: [{Class: 'os-pkgs', Packages: [pkg]}]};
  expect(verifySourceCoverage(scan, data)).toEqual(['alpine-base']);
  pkg.SrcVersion = 'other'; expect(() => verifySourceCoverage(scan, data)).toThrow('not covered');
  pkg.SrcName = 'unknown'; expect(() => verifySourceCoverage(scan, data)).toThrow('not covered');
  expect(() => verifySourceCoverage({Results: []}, data)).toThrow('missing');
});
it('checks Node/nginx inspected versions and the k6 binary module version', async () => {
  const data = await catalog();
  expect(() => verifyRuntimeSource([{Config: {Env: ['NODE_VERSION=24.22.3']}}], 'backend', data)).not.toThrow();
  expect(() => verifyRuntimeSource([{Config: {Env: ['NGINX_VERSION=other']}}], 'frontend', data)).toThrow('mismatch');
  expect(() => verifyK6Module({Results: [{Class: 'lang-pkgs', Packages: [{Name: 'go.k6.io/k6/v2', Version: 'v2.4.0'}]}]}, data)).not.toThrow();
  expect(() => verifyK6Module({Results: []}, data)).toThrow('mismatch');
});
it('retains only verified same-directory recipe links and rejects byte tampering', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'beetle-source-link-'));
  try {
    const target = 'install.sh'; const contents = Buffer.from(target);
    const asset: RecipeFile = {name: 'upgrade.sh', bytes: contents.length, mode: '120000',
      gitBlob: createHash('sha1').update(`blob ${contents.length}\0`).update(contents).digest('hex')};
    const sibling: RecipeFile = {name: target, bytes: 1, mode: '100755', gitBlob: 'a'.repeat(40)};
    for (const bad of ['../outside', '/outside', 'unknown', asset.name]) expect(() => sourceLinkTarget(bad, [asset, sibling])).toThrow();
    const path = join(directory, asset.name); await writeFile(path, contents); await writeFile(join(directory, target), 'x');
    await finishRecipeFile(path, asset, [asset, sibling]); expect(await readlink(path)).toBe(target);
    await expect(sourceHash(path, 100, 'sha256')).rejects.toThrow();
    const tampered = join(directory, 'tampered'); await writeFile(tampered, 'other');
    await expect(finishRecipeFile(tampered, asset, [asset, sibling])).rejects.toThrow('Git blob mismatch');
  } finally {await rm(directory, {recursive: true});}
});
it('uses production lockfile SRI, deduplicates nested copies and refuses conflicting pins', () => {
  const row = {version: '1.0.0', resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz', integrity: 'sha512-' + Buffer.alloc(64).toString('base64')};
  const lock = {lockfileVersion: 3, packages: {'': {}, 'node_modules/a': row,
    'node_modules/parent/node_modules/a': {...row}, 'node_modules/dev': {dev: true}, app: {link: true}}};
  expect(npmSources(lock)).toHaveLength(1);
  lock.packages['node_modules/parent/node_modules/a'].integrity = 'sha512-' + Buffer.alloc(64, 1).toString('base64');
  expect(() => npmSources(lock)).toThrow('Conflicting');
  expect(() => npmSources({lockfileVersion: 3, packages: {'node_modules/a': {...row, resolved: 'https://example.com/a'}}})).toThrow('registry');
  expect(() => npmSources({lockfileVersion: 3, packages: {'node_modules/a': {...row, integrity: 'sha1-unknown'}}})).toThrow('integrity');
});
