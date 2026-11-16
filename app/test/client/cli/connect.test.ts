import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runClient } from '../../../src/client/cli/main.js';
let root: string; beforeEach(async () => {root = await mkdtemp(join(tmpdir(), 'beetle-local-connect-'));});
afterEach(async () => {await rm(root, {recursive: true, force: true});});
const cookie = 'C'.repeat(43); const csrfToken = 'S'.repeat(43);
function args() {return ['connect','--endpoint','http://backend:4311','--origin','http://localhost:8080','--session-file',join(root,'session')];}
function output() {const stdout: string[] = []; const stderr: string[] = []; return {stdout, stderr,
  streams: {stdout: {write: async (value: string) => {stdout.push(value);}}, stderr: {write: async (value: string) => {stderr.push(value);}}}};}
function grant(mode: unknown = 'automatic', header = `beetle_session=${cookie}; Path=/api/v2/; HttpOnly; SameSite=Strict; Max-Age=28800`) {
  return new Response(JSON.stringify({scope: 'local-admin', csrfToken, expiresAt: new Date(Date.now() + 3600000).toISOString(), ...(mode === 'missing' ? {} : {accessMode: mode})}),
    {headers: {'content-type':'application/json','set-cookie': header}});
}
it('connects once without token-file access, binds the exact local protocol and writes only a private credential record', async () => {
  const result = output(); let calls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    calls++; expect(String(input)).toBe('http://backend:4311/api/v2/auth/local'); expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}'); const headers = new Headers(init?.headers); expect(headers.get('x-beetle-local')).toBe('1');
    expect(headers.get('x-beetle-pair')).toBeNull(); expect(headers.get('origin')).toBe('http://localhost:8080'); expect(headers.get('host')).toBe('localhost:8080');
    return grant();
  };
  expect(await runClient(args(), result.streams, fetcher)).toBe(0); expect(calls).toBe(1); expect(result.stdout).toEqual(['{"connected":true}\n']); expect(result.stderr).toEqual([]);
  expect((await stat(join(root,'session'))).mode & 0o777).toBe(0o600); expect(JSON.parse(await readFile(join(root,'session'),'utf8'))).toMatchObject({endpoint:'http://backend:4311',origin:'http://localhost:8080',cookie,session:{csrfToken,accessMode:'automatic'}});
  expect(result.stdout.join('')).not.toContain(cookie); expect(result.stdout.join('')).not.toContain(csrfToken);
});
it.each(['paired', 'missing', 'hosted'] as const)('refuses a missing/wrong automatic mode before writing credentials: %s', async mode => {
  const result = output(); let calls = 0;
  expect(await runClient(args(), result.streams, async () => {calls++; return grant(mode);})).toBe(3);
  expect(calls).toBe(1); await expect(readFile(join(root,'session'))).rejects.toMatchObject({code:'ENOENT'}); expect(result.stdout).toEqual([]);
});
it.each(['token-file','request-file','wait-ms'] as const)('rejects inapplicable --%s without HTTP effects', async flag => {
  const result = output(); let calls = 0; expect(await runClient([...args(),'--'+flag,'/unused'], result.streams, async () => {calls++; return grant();})).toBe(2); expect(calls).toBe(0);
});
it('preserves existing credential files before HTTP, and never retries a lost grant reply or leaks errors', async () => {
  const result = output(); let calls = 0; await writeFile(join(root,'session'),'preserve',{mode:0o600});
  expect(await runClient(args(),result.streams,async () => {calls++; return grant();})).toBe(2); expect(calls).toBe(0); expect(await readFile(join(root,'session'),'utf8')).toBe('preserve');
  const lost = output(); const changed = args(); changed[changed.length-1] = join(root,'fresh');
  expect(await runClient(changed,lost.streams,async () => {calls++; throw new Error('secret-'+csrfToken);})).toBe(3); expect(calls).toBe(1); expect(lost.stdout).toEqual([]); expect(lost.stderr.join('')).not.toContain(csrfToken);
  await expect(readFile(join(root,'fresh'))).rejects.toMatchObject({code:'ENOENT'});
});
it.each(['missing','two','wrong_path'] as const)('uses the shared strict cookie provenance rules: %s', async variant => {
  const result = output(); let calls = 0;
  const fetcher: typeof fetch = async () => {calls++; if (variant === 'missing') return new Response(await grant().text(),{headers:{'content-type':'application/json'}});
    const response = grant('automatic', variant === 'wrong_path' ? `beetle_session=${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800` : undefined);
    if (variant === 'two') response.headers.append('set-cookie','other=private'); return response;};
  expect(await runClient(args(),result.streams,fetcher)).toBe(3); expect(calls).toBe(1); expect(result.stdout).toEqual([]); await expect(readFile(join(root,'session'))).rejects.toMatchObject({code:'ENOENT'});
});
it('does not publish or persist a grant returned after cancellation', async () => {
  const result = output(); let calls = 0;
  const fetcher: typeof fetch = async () => {calls++; process.emit('SIGINT'); return grant();};
  expect(await runClient(args(),result.streams,fetcher)).toBe(3); expect(calls).toBe(1); expect(result.stdout).toEqual([]);
  await expect(readFile(join(root,'session'))).rejects.toMatchObject({code:'ENOENT'}); expect(result.stderr.join('')).not.toContain(cookie);
});
