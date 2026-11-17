import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { captureLiveMetricSnapshot, liveMetricScopeMatches } from '@beetle/contracts/api';
import type { LiveMetricReply } from '../../../ports/run-live-metrics.js';
import type { LiveMetricSnapshot } from '@beetle/contracts/api';
import type { RunnerAttemptIdentity } from '../../../ports/runner.js';
import { scopeHeaders } from './identity.js';
import { nativeCall } from './native.js';
import { protocolReply } from './transport.js';
import type { Connection } from './transport.js';

/** Finite advisory read, never an event ACK or durable result. */
export function readLiveMetrics(
  connection: Connection,
  identity: RunnerAttemptIdentity,
  signal?: AbortSignal,
): Promise<LiveMetricReply> {
  return connection.credits
    .run<{ frame: LiveMetricSnapshot; freshUntilMonotonicMs: number }>('live', signal, async (original) => {
      if (identity.generation !== 1) return { ok: false, error: { kind: 'request' } };
      const started = performance.now();
      const deadline = started + 5000;
      const response = await nativeCall(
        {
          origin: connection.origin,
          method: 'GET',
          path: `/runner/v1/attempts/${encodeURIComponent(identity.attemptId)}/live-metrics`,
          headers: { authorization: `Bearer ${connection.token}`, ...scopeHeaders(identity) },
          body: undefined,
          signal: original.signal,
          responseBytes: 65536,
        },
        connection.io,
      );
      if (!response.ok) return { ok: false, error: { kind: response.kind } };
      if (response.status !== 200) return protocolReply(response, identity);
      let frame: LiveMetricSnapshot;
      let freshUntilMonotonicMs: number;
      try {
        frame = liveFrame(response.value, identity);
        freshUntilMonotonicMs = receiptExpiry(response.liveFreshForMs, started);
      } catch {
        return { ok: false, error: { kind: 'response', status: response.status } };
      }
      const failure = original.failure();
      if (failure || original.signal.aborted) return { ok: false, error: { kind: failure ?? 'cancelled' } };
      if (performance.now() >= deadline) return { ok: false, error: { kind: 'timeout' } };
      return { ok: true, value: { frame, freshUntilMonotonicMs } };
    })
    .then((result) =>
      result.ok
        ? { ok: true, value: result.value.frame, freshUntilMonotonicMs: result.value.freshUntilMonotonicMs }
        : result,
    );
}

function liveFrame(input: unknown, identity: RunnerAttemptIdentity): LiveMetricSnapshot {
  const frame = captureLiveMetricSnapshot(input, (text) => createHash('sha256').update(text).digest('hex'));
  if (
    !liveMetricScopeMatches(frame.scope, identity) ||
    frame.publishedAtMs - Math.min(frame.capturedAtMs, frame.endTimeMs) > 6000
  )
    throw new Error();
  return frame;
}

/** Debit the whole original request through physical close; never compare peer UTC. */
function receiptExpiry(input: unknown, started: number): number {
  if (typeof input !== 'string' || !/^([1-9][0-9]{0,3})$/.test(input) || Number(input) > 6000)
    throw new Error('freshness');
  const expires = started + Number(input);
  if (performance.now() >= expires) throw new Error('freshness');
  return expires;
}
