import { afterEach, expect, it } from 'vitest';
import { request } from 'node:http';
import { stat } from 'node:fs/promises';
import { openApplication } from '../../src/bootstrap/api.js';
import type { Application } from '../../src/bootstrap/api.js';
import { storageFixture, settingsFixture } from '../storage/fixture.js';
const storage = storageFixture(); const apps = new Set<Application>();
afterEach(async () => {await Promise.all([...apps].map(app => app.close())); apps.clear();});
const origin = 'http://127.0.0.1:43127'; const host = '127.0.0.1:43127';
async function start(path: string) {
  const app = await openApplication({externalOrigin: origin, localAccess: 'automatic', metadata: {
    path, workerUrl: storage.workerUrl(), installation: settingsFixture().chain.installation, runtime: null}});
  apps.add(app); const address = await app.server.listen({host: '127.0.0.1', port: 0}); return {app, address};
}
async function close(app: Application) {await app.close(); apps.delete(app);}
function call(address: string, path: string, options: {method?: string; cookie?: string; csrf?: string; body?: string} = {}) {
  return new Promise<{status: number; cookie: string | undefined; body: string}>((resolve, reject) => {
    const socket = request(address + path, {method: options.method ?? 'GET', headers: {host, origin,
      'content-type': 'application/json', 'x-beetle-local': '1', ...(options.cookie ? {cookie: options.cookie} : {}),
      ...(options.csrf ? {'x-beetle-csrf': options.csrf} : {})}}, response => {
      let body = ''; response.on('data', (bytes: Buffer) => {body += bytes.toString('utf8'); if (body.length > 4096) socket.destroy(new Error('Reply limit'));});
      response.once('error', reject); response.once('end', () => resolve({status: response.statusCode!, cookie: response.headers['set-cookie']?.[0]?.split(';')[0], body}));
    });
    socket.setTimeout(3000, () => socket.destroy(new Error('Timeout'))); socket.once('error', reject); socket.end(options.body);
  });
}
it('uses actual TCP and compiled metadata worker to open, restart/recover and durably revoke local access without pairing', async () => {
  const path = storage.path(); let server = await start(path);
  expect((await call(server.address, '/api/v2/auth/session')).status).toBe(401);
  const opened = await call(server.address, '/api/v2/auth/local', {method: 'POST', body: '{}'});
  expect(opened.status).toBe(200); expect(opened.cookie).toMatch(/^beetle_session=[A-Za-z0-9_-]{43}$/);
  const cookie = opened.cookie; if (!cookie) throw new Error('Session cookie missing');
  const view = JSON.parse(opened.body) as {accessMode: string; csrfToken: string}; expect(view.accessMode).toBe('automatic');
  expect((await call(server.address, '/api/v2/organizations?limit=100', {cookie})).status).toBe(200);
  await close(server.app); server = await start(path);
  const restored = await call(server.address, '/api/v2/auth/session', {cookie}); expect(restored.status).toBe(200); expect(restored.body).toBe(opened.body);
  expect((await call(server.address, '/api/v2/auth/logout', {method: 'POST', body: '{}', cookie, csrf: view.csrfToken})).status).toBe(200);
  await close(server.app); server = await start(path);
  expect((await call(server.address, '/api/v2/auth/session', {cookie})).status).toBe(401);
  const fresh = await call(server.address, '/api/v2/auth/local', {method: 'POST', body: '{}'}); expect(fresh.status).toBe(200); expect(fresh.cookie).not.toBe(cookie);
});
it('rejects a remote external origin before opening or creating the metadata file', async () => {
  const path = storage.path(); await expect(openApplication({externalOrigin: 'http://remote.test', localAccess: 'automatic', metadata: {
    path, workerUrl: storage.workerUrl(), installation: settingsFixture().chain.installation, runtime: null}})).rejects.toThrow();
  await expect(stat(path)).rejects.toMatchObject({code: 'ENOENT'});
});
