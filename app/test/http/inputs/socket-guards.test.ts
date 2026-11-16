import { createConnection } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { storageFixture } from '../../storage/fixture.js';
import { setup, create, wrap, base } from './fixture.js';
import type { App } from './fixture.js';
import { listen } from './socket-fixture.js';
const fixture = storageFixture();
const apps: App[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

async function rawReply(port: number, message: string): Promise<string> {
  const socket = createConnection({ host: '127.0.0.1', port }); const chunks: Buffer[] = []; let size = 0;
  try {
    return await new Promise<string>((resolve, reject) => {
      socket.once('connect', () => socket.write(message));
      socket.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > 65_536) { reject(new Error('Synthetic raw reply bound exceeded')); socket.destroy(); return; }
        chunks.push(chunk);
      });
      socket.once('error', reject);
      socket.once('close', () => resolve(Buffer.concat(chunks).toString()));
    });
  } finally { socket.destroy(); }
}
it('rejects HTTP/1.0, literal query markers, duplicate ranges and invalid uploads before service issue/body delivery', async () => {
  const append = vi.fn(); const read = vi.fn(); const get = vi.fn();
  const app = await setup(fixture, service => wrap(service, { append, read, get })); apps.push(app);
  const { record } = await create(app, 'a'); const port = await listen(app);
  const content = `${base}/${record.id}/content`; const upload = `${base}/${record.id}/chunks?offset=0`;
  const headers = Object.entries(app.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n');
  const cases = [
    { line: `GET ${content} HTTP/1.0`, extra: '', status: 400 },
    { line: `GET ${content}? HTTP/1.1`, extra: '', status: 400 },
    { line: `GET ${content} HTTP/1.1`, extra: 'Range: bytes=0-0\r\nRange: bytes=0-0\r\n', status: 400 },
    { line: `GET ${content} HTTP/1.1`, extra: 'Content-Length: 1\r\n', status: 400 },
    { line: `PUT ${upload} HTTP/1.1`, extra: 'Content-Type: text/plain\r\nContent-Length: 1\r\n', status: 400 },
    { line: `PUT ${upload} HTTP/1.1`, extra: 'Content-Type: application/octet-stream\r\nContent-Length: 65537\r\n', status: 413 },
    { line: `PUT ${upload}&offset=0 HTTP/1.1`, extra: 'Content-Type: application/octet-stream\r\nContent-Length: 1\r\n', status: 400 },
  ];
  for (const item of cases) {
    // Deliberately send no declared body. Rejection must not wait for its bytes.
    const result = await rawReply(port, `${item.line}\r\n${headers}\r\nConnection: close\r\n${item.extra}\r\n`);
    expect(result).toMatch(new RegExp(`^HTTP/1\\.1 ${item.status} `));
    expect(result.toLowerCase()).toContain('cache-control: no-store');
  }
  expect(append).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
});
