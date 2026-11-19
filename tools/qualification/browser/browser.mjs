import assert from 'node:assert/strict';

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
/**
 * @template T
 * @param {{launch(options: {headless: boolean}): Promise<T>, connect(endpoint: string, options: {exposeNetwork: string}): Promise<T>}} driver
 * @param {string} origin
 * @param {string | undefined} endpoint
 */
export async function openBrowser(driver, origin, endpoint) {
  if (endpoint === undefined) return driver.launch({ headless: true });
  const server = new URL(endpoint);
  assert(server.protocol === 'ws:' && loopback.has(server.hostname), 'Browser server must be loopback WebSocket');
  assert(
    server.port && !server.username && !server.password && !server.search && !server.hash,
    'Invalid browser server address',
  );
  const app = new URL(origin);
  assert(
    app.protocol === 'http:' && loopback.has(app.hostname) && app.port && app.origin === origin,
    'Qualification app must have an exact loopback origin',
  );
  return driver.connect(server.href, { exposeNetwork: `${app.hostname}:${app.port}` });
}
