import {expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import type {ApiClient, Run} from '@beetle/contracts/api';
import type {DockerTransport} from '../../../../agent/src/backends/docker/index.js';
import {longWindow} from './window.js';
it('does not finish failed observation until every issued stats original settles', async () => {
 const queued = JSON.parse(readFileSync('contracts/fixtures/api/valid/run.json', 'utf8')) as Run;
 const api = {getRun: async () => ({ok: false, error: {kind: 'timeout'}})} as unknown as ApiClient;
 let release!: () => void; const held = new Promise<void>(resolve => {release = resolve;}); let reads = 0; let settled = false; let checkpointed = false;
 const transport: DockerTransport = {request: async () => {
  const index = ++reads; if (index === 1) throw Error('early stats failure');
  if (index === 2) await held;
  return {ok: true, status: 200, body: {cpu_stats: {cpu_usage: {total_usage: 1}}, memory_stats: {usage: 100, stats: {anon: 50}}}};
 }};
 const work = longWindow({api, queued, subscribers: [api, api, api], transport,
  peers: ['frontend', 'backend', 'agent'].map((role, index) => ({role, id: String(index + 1).repeat(64), memory: 1024})),
  onActive: () => true, checkpoint: () => {checkpointed = true;}}).finally(() => {settled = true;});
 void work.catch(() => undefined);
 await new Promise(resolve => setTimeout(resolve, 0));
 expect(reads).toBe(3); expect(settled).toBe(false); expect(checkpointed).toBe(false);
 release(); await expect(work).rejects.toThrow();
 expect(settled).toBe(true); expect(checkpointed).toBe(true);
});

it('starts the span only after an owned running original is observed, not at API-active admission', async () => {
 const queued = JSON.parse(readFileSync('contracts/fixtures/api/valid/run.json', 'utf8')) as Run;
 let reads = 0; let checkpoint: unknown;
 const api = {getRun: async () => ({ok: true, value: {...queued, state: ++reads < 3 ? 'active' : 'errored'}}),
  getRunLiveMetrics: async () => ({ok: false, error: {kind: 'protocol', status: 503, protocol: {code: 'storage_unavailable'}}})} as unknown as ApiClient;
 const onActive = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
 const transport: DockerTransport = {request: async () => {throw Error('No peers in latch fixture');}};
 await expect(longWindow({api, queued, subscribers: [api, api, api], transport, peers: [], onActive,
  checkpoint: part => {checkpoint = part;}})).rejects.toThrow();
 expect(onActive).toHaveBeenCalledTimes(2); expect(reads).toBe(3);
 expect((checkpoint as {activeObservedAtMs: number}).activeObservedAtMs).toBeGreaterThanOrEqual(1900);
});
