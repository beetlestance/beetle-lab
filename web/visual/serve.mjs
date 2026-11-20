// Serves the built web app (web/dist) for screenshot tests. Unknown paths fall back to
// index.html, as the production frontend does. API calls never reach this server: every
// test answers them from fixtures before the request leaves the browser.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const root = new URL('../dist/', import.meta.url).pathname;
const port = Number(process.env.VISUAL_PORT ?? 4780);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

async function asset(pathname) {
  const path = normalize(join(root, decodeURIComponent(pathname)));
  if (!path.startsWith(root)) return null;
  try {
    return { body: await readFile(path), type: types[extname(path)] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  if (pathname.startsWith('/api/')) {
    response.writeHead(599).end('API requests must be answered by test fixtures');
    return;
  }
  const found = (pathname !== '/' && (await asset(pathname))) || (await asset('index.html'));
  if (!found) {
    response.writeHead(500).end('web/dist is missing; build the web app first');
    return;
  }
  response.writeHead(200, { 'content-type': found.type, 'cache-control': 'no-store' }).end(found.body);
}).listen(port, '127.0.0.1');
