import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ExportJob } from '@beetle/contracts/api';
import { runClient } from '../../../src/client/cli/main.js';
import { parseOptions } from '../../../src/client/cli/options.js';
import { exportExit, waitForExport } from '../../../src/client/cli/exports.js';
import { createApiClient } from '@beetle/contracts/api';
import job from '../../../../contracts/fixtures/api/valid/export-job.json' with { type: 'json' };
import create from '../../../../contracts/fixtures/api/valid/create-export.json' with { type: 'json' };

let root: string;
const script = 'export default function () {}\n';
const sha256 = createHash('sha256').update(script).digest('hex');
const queued = () => structuredClone(job) as ExportJob;
const ready = (): ExportJob => ({ ...(job as ExportJob), state: 'ready', reason: null, artifact: { artifactId: job.id, bytes: Buffer.byteLength(script), sha256, name: 'suite.js', mediaType: 'text/javascript' } });
const scope = ['--organization', job.scope.organizationId, '--workspace', job.scope.workspaceId, '--export', job.id];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'beetle-client-exports-'));
  await writeFile(join(root, 'session'), JSON.stringify({ version: 1, endpoint: 'http://synthetic.invalid', origin: 'http://localhost', cookie: 'C'.repeat(43),
    session: { scope: 'local-admin', expiresAt: new Date(Date.now() + 3600000).toISOString(), csrfToken: 'S'.repeat(43) } }), { mode: 0o600 });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const common = () => ['--endpoint', 'http://synthetic.invalid', '--origin', 'http://localhost', '--session-file', join(root, 'session')];
function streams() {
  const stdout: string[] = []; const stderr: string[] = [];
  return { stdout, stderr, ports: { stdout: { write: async (value: string) => { stdout.push(value); } }, stderr: { write: async (value: string) => { stderr.push(value); } } } };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const urlOf = (input: unknown) => String(input instanceof URL ? input.href : input instanceof Request ? input.url : input);

it('parses closed export options and refuses relative or missing output paths', () => {
  expect(parseOptions(['export-status', ...common(), ...scope]).exportJob).toEqual({ organizationId: job.scope.organizationId, workspaceId: job.scope.workspaceId, exportId: job.id });
  expect(parseOptions(['export-download', ...common(), ...scope, '--out', join(root, 'suite.js')]).outFile).toBe(join(root, 'suite.js'));
  for (const argv of [['export-download', ...common(), ...scope], ['export-download', ...common(), ...scope, '--out', 'suite.js'],
    ['export-status', ...common(), '--organization', 'x', '--workspace', job.scope.workspaceId, '--export', job.id], ['export', ...common(), '--run', job.id]])
    expect(() => parseOptions(argv)).toThrow(expect.objectContaining({ code: 'invalid_input', exit: 2 }));
});

it.each([['ready', 0], ['failed', 3], ['unknown', 3], ['cancelled', 4], ['queued', 5], ['generating', 5]] as const)('maps export state %s to exit %i', (state, exit) => {
  const value = state === 'ready' ? ready() : ({ ...queued(), state, reason: state === 'failed' ? 'build_failed' : null } as ExportJob);
  expect(exportExit(value)).toBe(exit);
});

it('submits one export to the revision route and acknowledges without claiming readiness', async () => {
  const request = join(root, 'request'); await writeFile(request, JSON.stringify(create));
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: urlOf(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return json(queued(), 202);
  };
  const output = streams();
  expect(await runClient(['export', ...common(), '--request-file', request], output.ports, fetcher)).toBe(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ method: 'POST', body: create,
    url: `http://synthetic.invalid/api/v2/organizations/${create.scope.organizationId}/workspaces/${create.scope.workspaceId}/revisions/${create.revisionId}/exports` });
  expect(JSON.parse(output.stdout.join(''))).toMatchObject({ submitted: true, export: { state: 'queued' } });
});

it('waits sequentially for a terminal export and keeps pending at the deadline', async () => {
  const base = createApiClient({ baseUrl: 'http://synthetic.invalid', fetch: async () => { throw new Error('Unexpected network'); } });
  let now = 0; let reads = 0;
  const api = { ...base, getExport: async () => ({ ok: true as const, value: ++reads === 2 ? ready() : queued() }) };
  const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
  expect((await waitForExport({ api, job: queued(), deadline: 10000, signal: new AbortController().signal, clock })).state).toBe('ready');
  expect(reads).toBe(2);
  now = 0; reads = -10;
  expect((await waitForExport({ api, job: queued(), deadline: 3000, signal: new AbortController().signal, clock })).state).toBe('queued');
});

function downloader(body: string | Uint8Array, state = ready()) {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = urlOf(input); urls.push(url);
    return url.endsWith('/content') ? new Response(body, { status: 200 }) : json(state);
  };
  return { urls, fetcher };
}

it('downloads a ready script into a new file and verifies size and SHA-256', async () => {
  const out = join(root, 'suite.js'); const { urls, fetcher } = downloader(script); const output = streams();
  expect(await runClient(['export-download', ...common(), ...scope, '--out', out], output.ports, fetcher)).toBe(0);
  expect(await readFile(out, 'utf8')).toBe(script);
  expect((await stat(out)).mode & 0o777).toBe(0o600);
  expect(urls.at(-1)).toBe(`http://synthetic.invalid/api/v2/organizations/${job.scope.organizationId}/workspaces/${job.scope.workspaceId}/exports/${job.id}/content`);
  expect(JSON.parse(output.stdout.join(''))).toEqual({ downloaded: true, exportId: job.id, name: 'suite.js', bytes: Buffer.byteLength(script), sha256 });
});

it.each([['digest mismatch', script.toUpperCase()], ['short body', script.slice(1)], ['oversized body', script + 'x']])('removes the partial file on %s', async (_label, body) => {
  const out = join(root, 'suite.js'); const output = streams();
  expect(await runClient(['export-download', ...common(), ...scope, '--out', out], output.ports, downloader(body).fetcher)).toBe(3);
  await expect(stat(out)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(output.stdout).toEqual([]);
});

it('never overwrites an existing file and never fetches content for a job that is not ready', async () => {
  const out = join(root, 'suite.js'); await writeFile(out, 'keep');
  expect(await runClient(['export-download', ...common(), ...scope, '--out', out], streams().ports, downloader(script).fetcher)).toBe(2);
  expect(await readFile(out, 'utf8')).toBe('keep');
  const pending = downloader(script, queued());
  expect(await runClient(['export-download', ...common(), ...scope, '--out', join(root, 'other.js')], streams().ports, pending.fetcher)).toBe(5);
  expect(pending.urls.some((url) => url.endsWith('/content'))).toBe(false);
});
