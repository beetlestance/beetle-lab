import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
const methods = new Map([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
]);
const inline = new Map([
  ['one', 'A'],
  ['two', 'B'],
]);
const json = new Map([
  ['J1', 'JT1'],
  ['J2', 'JT2'],
]);
const csv = new Map([
  ['one,first', 'a"b'],
  ['two\nsecond', 't2'],
]);
const counts = {
  ready: 0,
  total: 0,
  malformed: 0,
  rejected: 0,
  methods: Object.fromEntries([...methods.values()].map((method) => [method, 0])),
};
const perVu = new Map<number, { method: string; count: number }>();
const seen = { inline: new Set<string>(), json: new Set<string>(), csv: new Set<string>(), numbers: new Set<string>() };
const bodyInput = '{"source":"immutable body input"}';
async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const part of request) {
    const chunk = Buffer.from(part as Uint8Array);
    bytes += chunk.length;
    assert(bytes <= 8192 && chunks.length < 64);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes).toString('utf8');
}
function fields(request: IncomingMessage, url: URL, user: string, method: string) {
  const query = url.searchParams;
  const identity = Number(query.get('identity'));
  assert(Number.isSafeInteger(identity) && identity >= 1 && identity <= 10);
  assert.equal(request.headers['x-identity'], String(identity));
  assert.equal(query.get('jsonUser'), identity % 2 === 1 ? 'J1' : 'J2');
  assert.equal(query.get('n'), String(1 + ((identity - 1) % 3) * 2));
  assert(inline.has(user));
  assert.equal(inline.get(user), query.get('inlineToken'));
  assert(json.has(query.get('jsonUser')!));
  assert.equal(json.get(query.get('jsonUser')!), query.get('jsonToken'));
  assert(csv.has(query.get('csvName')!));
  assert.equal(csv.get(query.get('csvName')!), query.get('csvToken'));
  assert(['1', '3', '5'].includes(query.get('n')!));
  assert.equal(request.headers['x-inline-user'], user);
  for (const [name, header] of [
    ['inlineToken', 'x-inline-token'],
    ['jsonUser', 'x-json-user'],
    ['jsonToken', 'x-json-token'],
    ['csvToken', 'x-csv-token'],
    ['n', 'x-number'],
  ] as const)
    assert.equal(request.headers[header], query.get(name));
  const previous = perVu.get(identity);
  if (previous) {
    assert.equal(previous.method, method);
    assert(++previous.count <= 2);
  } else {
    assert(perVu.size < 10);
    perVu.set(identity, { method, count: 1 });
  }
  seen.inline.add(user);
  seen.json.add(query.get('jsonUser')!);
  seen.csv.add(query.get('csvName')!);
  seen.numbers.add(query.get('n')!);
}
function payload(method: string, value: string, url: URL, user: string, contentType: string | undefined) {
  if (method === 'GET') {
    assert.equal(value, '');
    return;
  }
  assert.equal(contentType, method === 'PUT' ? 'text/plain' : 'application/json');
  if (method === 'PUT') {
    assert.equal(value, bodyInput);
    return;
  }
  if (method === 'PATCH') {
    assert.deepEqual(JSON.parse(value), { source: 'immutable body input' });
    return;
  }
  assert.deepEqual(JSON.parse(value), {
    user,
    token: url.searchParams.get('inlineToken'),
    jsonUser: url.searchParams.get('jsonUser'),
    csvName: url.searchParams.get('csvName'),
    number: 'n=' + url.searchParams.get('n'),
    literal: [null, true, 42],
  });
}
function response(reply: ServerResponse, status: number, value: string) {
  reply.writeHead(status, { 'Content-Type': 'application/json', 'X-Fixture': 'native-ok' });
  reply.end(value);
}
async function handle(request: IncomingMessage, reply: ServerResponse) {
  try {
    const url = new URL(request.url ?? '/', 'http://target');
    if (url.pathname === '/counts') {
      assert.equal(request.method, 'GET');
      response(
        reply,
        200,
        JSON.stringify({
          ...counts,
          perVu: Object.fromEntries(perVu),
          seen: Object.fromEntries(Object.entries(seen).map(([key, value]) => [key, [...value]])),
        }),
      );
      return;
    }
    if (++counts.total > 128) process.exit(3);
    if (url.pathname === '/ready') {
      assert(++counts.ready <= 3);
      response(reply, counts.ready === 1 ? 503 : 200, JSON.stringify({ message: 'fixture-ready' }));
      return;
    }
    if (url.pathname === '/malformed') {
      assert(++counts.malformed <= 3);
      response(reply, 200, '{broken');
      return;
    }
    const parts = url.pathname.split('/');
    assert.equal(parts.length, 4);
    assert.equal(parts[1], 'native');
    const method = methods.get(parts[2]!);
    assert(method);
    assert.equal(request.method, method);
    assert(++counts.methods[method]! <= 4);
    const user = decodeURIComponent(parts[3]!);
    fields(request, url, user, method);
    payload(method, await body(request), url, user, request.headers['content-type']);
    response(reply, 200, JSON.stringify({ message: 'fixture-ok', count: 1, users: [{ id: 1 }] }));
  } catch {
    counts.rejected++;
    response(reply, 500, 'fixture rejected');
  }
}
export function createTarget() {
  const server = createServer({ maxHeaderSize: 16384 }, (request, reply) => {
    void handle(request, reply);
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  createTarget().listen(8080, '0.0.0.0');
