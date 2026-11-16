import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runClient } from '../../../src/client/cli/main.js';
let root: string;
beforeEach(async () => {root = await mkdtemp(join(tmpdir(), 'beetle-client-auth-'));});
afterEach(async () => {await rm(root, {recursive: true, force: true});});
const endpoint = 'http://synthetic.invalid'; const origin = 'http://localhost:8080';
const token = 'T'.repeat(43); const cookie = 'C'.repeat(43); const csrfToken = 'S'.repeat(43);
function common() {return ['--endpoint', endpoint, '--origin', origin, '--session-file', join(root, 'session')];}
function capture() {const stdout: string[] = []; const stderr: string[] = []; return {stdout, stderr,
  streams: {stdout: {write: async (value: string) => {stdout.push(value);}}, stderr: {write: async (value: string) => {stderr.push(value);}}}};}
function session() {return {scope: 'local-admin', expiresAt: new Date(Date.now() + 3600000).toISOString(), csrfToken};}
function response(setCookie = `beetle_session=${cookie}; Path=/api/v2/; HttpOnly; SameSite=Strict; Max-Age=28800`) {
  return new Response(JSON.stringify(session()), {headers: {'content-type': 'application/json', 'set-cookie': setCookie}});
}
it('refuses an existing credential destination before consuming the startup token', async () => {
  await writeFile(join(root, 'token'), token, {mode: 0o600}); await writeFile(join(root, 'session'), 'preserve', {mode: 0o600}); let calls = 0; const output = capture();
  expect(await runClient(['pair', ...common(), '--token-file', join(root, 'token')], output.streams, async () => {calls++; return response();})).toBe(2);
  expect(calls).toBe(0); expect(await readFile(join(root, 'session'), 'utf8')).toBe('preserve'); expect(output.stdout).toEqual([]);
});
it.each(['missing', 'wrong_path', 'secure_on_http', 'two_cookies'])('rejects invalid cookie provenance: %s', async variant => {
  await writeFile(join(root, 'token'), token, {mode: 0o600}); const output = capture(); let calls = 0; let observed: RequestInit | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    calls++; observed = init;
    if (variant === 'missing') return new Response(JSON.stringify(session()), {headers: {'content-type': 'application/json'}});
    if (variant === 'wrong_path') return response(`beetle_session=${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
    if (variant === 'secure_on_http') return response(`beetle_session=${cookie}; Path=/api/v2/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure`);
    const result = response(); result.headers.append('set-cookie', 'extra=canary'); return result;
  };
  expect(await runClient(['pair', ...common(), '--token-file', join(root, 'token')], output.streams, fetcher)).toBe(3);
  expect(calls).toBe(1); expect(observed?.redirect).toBe('error'); expect(new Headers(observed?.headers).get('x-beetle-pair')).toBe('1'); expect(output.stdout).toEqual([]); expect(output.stderr.join('')).not.toContain(cookie); expect(output.stderr.join('')).not.toContain(csrfToken);
  await expect(readFile(join(root, 'session'))).rejects.toMatchObject({code: 'ENOENT'});
});
it('preserves a destination introduced during pairing and never retries the lost file outcome', async () => {
  await writeFile(join(root, 'token'), token, {mode: 0o600}); let calls = 0; const output = capture();
  const fetcher: typeof fetch = async () => {calls++; await writeFile(join(root, 'session'), 'other data', {mode: 0o600}); return response();};
  expect(await runClient(['pair', ...common(), '--token-file', join(root, 'token')], output.streams, fetcher)).toBe(3);
  expect(calls).toBe(1); expect(await readFile(join(root, 'session'), 'utf8')).toBe('other data'); expect(output.stdout).toEqual([]);
  expect(output.stderr.join('')).not.toContain(cookie);
});
it.each(['endpoint', 'origin', 'unknown', 'expired'])('rejects credential %s without issuing HTTP', async variant => {
  const grant: Record<string, unknown> = {version: 1, endpoint, origin, cookie, session: session()};
  if (variant === 'endpoint') grant.endpoint = 'http://other.invalid';
  if (variant === 'origin') grant.origin = 'http://localhost:8081';
  if (variant === 'unknown') grant.extra = 'canary';
  if (variant === 'expired') grant.session = {...session(), expiresAt: '2020-01-01T00:00:00.000Z'};
  await writeFile(join(root, 'session'), JSON.stringify(grant), {mode: 0o600}); const output = capture(); let calls = 0;
  const exit = await runClient(['result', ...common(), '--organization', '00000000-0000-4000-8000-000000000001', '--workspace', '00000000-0000-4000-8000-000000000002', '--run', '00000000-0000-4000-8000-000000000005'], output.streams, async () => {calls++; throw new Error('canary');});
  expect(exit).toBe(variant === 'expired' ? 5 : 2); expect(calls).toBe(0); expect(output.stderr.join('')).not.toContain('canary'); expect(output.stdout).toEqual([]);
});
it('returns a fixed IO exit when diagnostic output itself fails', async () => {
  const exit = await runClient(['invalid'], {stdout: {write: async () => {}}, stderr: {write: async () => {throw new Error('secret canary');}}});
  expect(exit).toBe(3);
});
