import { mkdir, mkdtemp, realpath, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalOutputBytes } from '../../src/adapters/outbound/files/outputs/index.js';

/** Production entrypoint only; no private native implementation seam. */
export async function nativeFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-transfer-native-'))); await chmod(root, 0o700);
  const options = {stagingRoot: join(root, 'staging'), publishedRoot: join(root, 'published'),
    leasePath: join(root, 'namespace.sqlite'), createLease: true};
  await mkdir(options.stagingRoot, {mode: 0o700}); await mkdir(options.publishedRoot, {mode: 0o700});
  let store = await openLocalOutputBytes(options);
  return {get store() {return store;},
    async reopen() {await store.close(); store = await openLocalOutputBytes({...options, createLease: false});},
    async dispose() {await store.close(); await rm(root, {recursive: true, force: true});}};
}
