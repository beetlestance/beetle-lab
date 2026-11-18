import { expect, it, vi } from 'vitest';
import data from '../../../../../contracts/fixtures/api/valid/live-metric-history.json' with { type: 'json' };
import { captureLiveMetricHistory } from '@beetle/contracts/api';
import { HistoryReads } from './read.js';
import { deferred } from '../live-metrics/fixtures.js';
const hash = () => data.subsetDigest;
const value = () => captureLiveMetricHistory(data, hash);
const params = {
  organizationId: data.scope.organizationId,
  workspaceId: data.scope.workspaceId,
  attemptId: data.scope.attemptId,
  runId: '00000000-0000-4000-8000-000000000099',
};
const response = () => new Response(JSON.stringify(value()), { headers: { 'content-type': 'application/json' } });
const digest = async (bytes: Uint8Array) => {
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
it('reads a fixed scoped path and verifies the subset before returning history', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
  const reads = new HistoryReads({ fetch, digest, monotonic: () => 0 });
  expect(await reads.read({ params, signal: new AbortController().signal })).toEqual(value());
  expect(fetch.mock.calls[0]![0]).toContain(`/runs/${params.runId}/attempts/${params.attemptId}/metrics/live-history`);
  expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
});
it.each(['scope', 'digest'] as const)('refuses a mismatched history %s', async (kind) => {
  const current = value();
  if (kind === 'scope') {
    current.scope.generation = 2;
    current.prefix.scope.generation = 2;
  } else current.subsetDigest = 'f'.repeat(64);
  const reads = new HistoryReads({
    fetch: async () => new Response(JSON.stringify(current), { headers: { 'content-type': 'application/json' } }),
    digest,
    monotonic: () => 0,
  });
  await expect(reads.read({ params, signal: new AbortController().signal })).rejects.toThrow();
});
it('retains an ignored-abort fetch original and its single admission until settlement', async () => {
  const gate = deferred<Response>();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementationOnce(() => gate.promise)
    .mockImplementation(async () => response());
  const reads = new HistoryReads({ fetch, digest, monotonic: () => 0 });
  const abort = new AbortController();
  const first = reads.read({ params, signal: abort.signal });
  const rejected = expect(first).rejects.toThrow();
  await Promise.resolve();
  abort.abort();
  await expect(reads.read({ params, signal: new AbortController().signal })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  gate.resolve(response());
  await rejected;
  expect(await reads.read({ params, signal: new AbortController().signal })).toEqual(value());
});
it('retains an unabortable hash original and refuses late data', async () => {
  const gate = deferred<string>();
  const hashPort = vi.fn(digest).mockImplementationOnce(() => gate.promise);
  const reads = new HistoryReads({ fetch: async () => response(), digest: hashPort, monotonic: () => 0 });
  const abort = new AbortController();
  const first = reads.read({ params, signal: abort.signal });
  const rejected = expect(first).rejects.toThrow();
  await expect.poll(() => hashPort.mock.calls.length).toBe(1);
  abort.abort();
  await expect(reads.read({ params, signal: new AbortController().signal })).rejects.toThrow();
  gate.resolve(value().subsetDigest);
  await rejected;
});
it('does not invoke selection getters or issue work after a pre-dispatch abort', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
  const reads = new HistoryReads({ fetch, digest, monotonic: () => 0 });
  let invoked = false;
  const input = {
    get params() {
      invoked = true;
      return params;
    },
    signal: new AbortController().signal,
  };
  await expect(reads.read(input)).rejects.toThrow();
  expect(invoked).toBe(false);
  const abort = new AbortController();
  abort.abort();
  await expect(reads.read({ params, signal: abort.signal })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
