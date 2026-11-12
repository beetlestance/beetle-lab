import { expect, it } from 'vitest';
import { createApiClient } from '@beetle/contracts/api';
import type { ApiClient, Run } from '@beetle/contracts/api';
import { execute } from '../../../src/client/cli/execute.js';
import { runExit, waitForRun } from '../../../src/client/cli/wait.js';
import { deferred, runValue } from '../../application/runs/fixture.js';
const base = createApiClient({baseUrl: 'http://synthetic.invalid', fetch: async () => {throw new Error('Unexpected network');}});
const pending = (): Run => ({...runValue(), state: 'queued', outcome: 'pending'});
it.each([['finished', 'passed', 0], ['finished', 'failed', 1], ['errored', 'inconclusive', 3], ['cancelled', 'inconclusive', 4], ['queued', 'pending', 5]] as const)('maps only declared %s/%s to %i', (state, outcome, exit) => {
  expect(runExit({...runValue(), state, outcome})).toBe(exit);
});
it('polls sequentially with immutable identity and finite intervals until authoritative completion', async () => {
  let now = 0; let calls = 0; const sleeps: number[] = [];
  const api = {...base, getRun: async () => ({ok: true as const, value: ++calls === 2 ? {...runValue(), state: 'finished' as const, outcome: 'failed' as const} : pending()})};
  const result = await waitForRun({api, run: pending(), deadline: 10000, signal: new AbortController().signal,
    clock: {now: () => now, sleep: async ms => {sleeps.push(ms); now += ms;}}});
  expect(calls).toBe(2); expect(sleeps).toEqual([2000, 2000]); expect(runExit(result)).toBe(1);
});
it('retains pending after a held terminal reply arrives beyond the deadline', async () => {
  let now = 0; const held = deferred<Awaited<ReturnType<ApiClient['getRun']>>>(); let called = false;
  const api = {...base, getRun: () => {called = true; return held.promise;}}; const controller = new AbortController();
  const result = waitForRun({api, run: pending(), deadline: 5000, signal: controller.signal,
    clock: {now: () => now, sleep: async ms => {now += ms;}}});
  await Promise.resolve(); expect(called).toBe(true); now = 5001; controller.abort();
  held.resolve({ok: true, value: {...runValue(), state: 'finished', outcome: 'passed'}});
  expect(runExit(await result)).toBe(5);
});
it('refuses a late initial status reply and bounds even a stalled injected clock', async () => {
  let now = 0;
  const api = {...base, getRun: async () => {now = 5001; return {ok: true as const, value: {...runValue(), state: 'finished' as const, outcome: 'passed' as const}};}};
  await expect(execute({api, options: {command: 'status', endpoint: 'http://synthetic.invalid', origin: 'http://localhost', sessionFile: '/unused', waitMs: 5000,
    run: {organizationId: runValue().scope.organizationId, workspaceId: runValue().scope.workspaceId, runId: runValue().id}},
    signal: new AbortController().signal, deadline: 5000, clock: {now: () => now, sleep: async () => {}}})).rejects.toMatchObject({code: 'interrupted', exit: 5});
  let calls = 0;
  await waitForRun({api: {...base, getRun: async () => {calls++; return {ok: true, value: pending()};}}, run: pending(), deadline: 5000,
    signal: new AbortController().signal, clock: {now: () => 0, sleep: async () => {}}});
  expect(calls).toBe(1801);
});
