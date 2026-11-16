import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {cleanupBrowserInstallation} from './cleanup.mjs';
test('a held browser close does not delay Compose cleanup or claim premature success', async () => {
  /** @type {() => void} */ let release = () => {throw Error('Gate not initialized');};
  const browser = new Promise(resolve => {release = () => resolve(undefined);});
  let installationStarted = false; let joined = false;
  const work = cleanupBrowserInstallation(() => browser, async () => {installationStarted = true; return {verified: true};})
    .then(value => {joined = true; return value;});
  await setImmediate(); assert.equal(installationStarted, true); assert.equal(joined, false);
  release(); assert.deepEqual(await work, {browserClosed: true, cleanupVerified: true});
});
test('a synchronous browser failure still starts and joins installation cleanup', async () => {
  let installationStarted = false;
  const result = await cleanupBrowserInstallation(() => {throw Error('Browser failed');}, async () => {installationStarted = true; return {verified: true};});
  assert.equal(installationStarted, true); assert.deepEqual(result, {browserClosed: false, cleanupVerified: true});
});
test('installation cleanup failure cannot be reported as a pass', async () => {
  assert.deepEqual(await cleanupBrowserInstallation(async () => {}, async () => {throw Error('Installation failed');}),
    {browserClosed: true, cleanupVerified: false});
});
