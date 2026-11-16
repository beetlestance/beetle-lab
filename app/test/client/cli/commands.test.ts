import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApiClient } from '@beetle/contracts/api';
import { runClient } from '../../../src/client/cli/main.js';
import { execute } from '../../../src/client/cli/execute.js';
import { operation, runValue } from '../../application/runs/fixture.js';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'beetle-client-commands-'));
  await writeFile(join(root, 'session'), JSON.stringify({version: 1, endpoint: 'http://synthetic.invalid', origin: 'http://localhost', cookie: 'C'.repeat(43),
    session: {scope: 'local-admin', expiresAt: new Date(Date.now() + 3600000).toISOString(), csrfToken: 'S'.repeat(43)}}), {mode: 0o600});
});
afterEach(async () => {await rm(root, {recursive: true, force: true});});
function common() {return ['--endpoint', 'http://synthetic.invalid', '--origin', 'http://localhost', '--session-file', join(root, 'session')];}
function streams() {const stdout: string[] = []; const stderr: string[] = []; return {stdout, stderr, ports: {
  stdout: {write: async (value: string) => {stdout.push(value);}}, stderr: {write: async (value: string) => {stderr.push(value);}}}};}
it.each(['malformed', 'oversized', 'unknown_field'])('refuses %s run input before fetch', async variant => {
  const request = join(root, 'request'); const content = variant === 'malformed' ? '{' : variant === 'oversized' ? 'x'.repeat(4097) : JSON.stringify({...operation().request, extra: 'secret canary'});
  await writeFile(request, content); let calls = 0; const output = streams();
  expect(await runClient(['run', ...common(), '--request-file', request], output.ports, async () => {calls++; throw new Error('Unexpected fetch');})).toBe(2);
  expect(calls).toBe(0); expect(output.stdout).toEqual([]); expect(output.stderr.join('')).not.toContain('canary');
});
it('rejects cross-workspace cancel and five-run/case-duplicate comparison before fetch', async () => {
  const request = join(root, 'request'); const body = operation().request; const run = runValue(); let calls = 0;
  const fetcher: typeof fetch = async () => {calls++; throw new Error('Unexpected fetch');};
  await writeFile(request, JSON.stringify({scope: {...body.scope, workspaceId: '00000000-0000-4000-8000-000000000099'}, requestId: body.requestId}));
  expect(await runClient(['cancel', ...common(), '--organization', run.scope.organizationId, '--workspace', run.scope.workspaceId, '--run', run.id, '--request-file', request], streams().ports, fetcher)).toBe(2);
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  for (const ids of [Array.from({length: 5}, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`), [a, a.toUpperCase()]]) {
    await writeFile(request, JSON.stringify({scope: body.scope, runIds: ids, metric: null}));
    expect(await runClient(['compare', ...common(), '--request-file', request], streams().ports, fetcher)).toBe(2);
  }
  expect(calls).toBe(0);
});
it.each([400, 413, 422])('maps definitive HTTP %i invalid input to2 without retry', async status => {
  const request = join(root, 'request'); await writeFile(request, JSON.stringify(operation().request)); let calls = 0;
  const fetcher: typeof fetch = async () => {calls++; return new Response(JSON.stringify({code: 'invalid_value', message: 'Invalid value', requestId: operation().request.requestId, retryable: false, fields: []}), {status, headers: {'content-type': 'application/json'}});};
  expect(await runClient(['run', ...common(), '--request-file', request], streams().ports, fetcher)).toBe(2); expect(calls).toBe(1);
});
it.each(['run', 'cancel'] as const)('rejects late terminal %s replay before its timer fires', async command => {
  const request = join(root, 'request'); const body = operation().request; await writeFile(request, JSON.stringify(command === 'run' ? body : {scope: body.scope, requestId: body.requestId}));
  const base = createApiClient({baseUrl: 'http://synthetic.invalid', fetch: async () => {throw new Error('Unexpected fetch');}}); let now = 0;
  const api = {...base, createRun: async () => {now = 5001; return {ok: true as const, value: {...runValue(), state: 'finished' as const, outcome: 'passed' as const}};},
    cancelRun: async () => {now = 5001; return {ok: true as const, value: {...runValue(), state: 'cancelled' as const, outcome: 'inconclusive' as const, cancellationRequested: true}};}};
  await expect(execute({options: {command, endpoint: 'http://synthetic.invalid', origin: 'http://localhost', sessionFile: join(root, 'session'), requestFile: request, waitMs: 5000,
    run: {organizationId: body.scope.organizationId, workspaceId: body.scope.workspaceId, runId: runValue().id}},
    api, signal: new AbortController().signal, deadline: 5000, clock: {now: () => now, sleep: async () => {}}})).rejects.toMatchObject({code: 'outcome_unknown', exit: 3, requestId: body.requestId});
});
