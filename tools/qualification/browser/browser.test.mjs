import assert from 'node:assert/strict';
import test from 'node:test';
import { openBrowser } from './browser.mjs';
const origin = 'http://127.0.0.1:5190';
function fixture() {
  /** @type {Array<{method: string, endpoint?: string, options: {headless?: boolean, exposeNetwork?: string}}>} */
  const calls = [];
  return {
    calls,
    driver: {
      /** @param {{headless: boolean}} options */
      async launch(options) {
        calls.push({ method: 'launch', options });
        return 'browser';
      },
      /** @param {string} endpoint @param {{exposeNetwork: string}} options */
      async connect(endpoint, options) {
        calls.push({ method: 'connect', endpoint, options });
        return 'browser';
      },
    },
  };
}
test('launches a host browser only when no container endpoint was supplied', async () => {
  const f = fixture();
  assert.equal(await openBrowser(f.driver, origin, undefined), 'browser');
  assert.deepEqual(f.calls, [{ method: 'launch', options: { headless: true } }]);
});
test('container browser exposes only the owned fixture port through the client', async () => {
  const f = fixture();
  assert.equal(await openBrowser(f.driver, origin, 'ws://127.0.0.1:32001/opaque-path'), 'browser');
  assert.deepEqual(f.calls, [
    { method: 'connect', endpoint: 'ws://127.0.0.1:32001/opaque-path', options: { exposeNetwork: '127.0.0.1:5190' } },
  ]);
});
test('rejects unsafe endpoints without launching or connecting', async () => {
  const f = fixture();
  for (const endpoint of [
    '',
    'ws://remote.invalid:3000/path',
    'http://127.0.0.1:3000/path',
    'ws://127.0.0.1/path',
    'ws://user:secret@127.0.0.1:3000/path',
    'ws://127.0.0.1:3000/path?query=1',
    'ws://127.0.0.1:3000/path#fragment',
  ])
    await assert.rejects(openBrowser(f.driver, origin, endpoint));
  for (const app of ['http://remote.invalid:5190', origin + '/path', origin + '?query=1'])
    await assert.rejects(openBrowser(f.driver, app, 'ws://127.0.0.1:32001/path'));
  assert.deepEqual(f.calls, []);
});
