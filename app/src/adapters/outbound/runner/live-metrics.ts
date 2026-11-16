import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { captureLiveMetricSnapshot, liveMetricScopeMatches } from '@beetle/contracts/api';
import type { ClientResult } from '@beetle/contracts';
import type { LiveMetricSnapshot } from '@beetle/contracts/api';
import type { RunnerAttemptIdentity } from '../../../ports/runner.js';
import { scopeHeaders } from './identity.js';
import { nativeCall } from './native.js';
import { protocolReply } from './transport.js';
import type { Connection } from './transport.js';

/** Finite advisory read, never an event ACK or durable result. */
export function readLiveMetrics(connection: Connection, identity: RunnerAttemptIdentity,
  signal?: AbortSignal): Promise<ClientResult<LiveMetricSnapshot>> {
  return connection.credits.run<LiveMetricSnapshot>('live', signal, async original => {
    if (identity.generation !== 1) return {ok: false, error: {kind: 'request'}};
    const started = Date.now(); const deadline = performance.now() + 5000;
    const response = await nativeCall({origin: connection.origin, method: 'GET',
      path: `/runner/v1/attempts/${encodeURIComponent(identity.attemptId)}/live-metrics`,
      headers: {authorization: `Bearer ${connection.token}`, ...scopeHeaders(identity)}, body: undefined,
      signal: original.signal, responseBytes: 65536}, connection.io);
    if (!response.ok) return {ok: false, error: {kind: response.kind}};
    if (response.status !== 200) return protocolReply(response, identity);
    let frame: LiveMetricSnapshot;
    try {
      frame = liveFrame(response.value, identity, started);
    } catch {return {ok: false, error: {kind: 'response', status: response.status}};}
    const failure = original.failure();
    if (failure || original.signal.aborted) return {ok: false, error: {kind: failure ?? 'cancelled'}};
    if (performance.now() >= deadline) return {ok: false, error: {kind: 'timeout'}};
    return {ok: true, value: frame};
  });
}

function liveFrame(input: unknown, identity: RunnerAttemptIdentity, started: number): LiveMetricSnapshot {
  const frame = captureLiveMetricSnapshot(input, text => createHash('sha256').update(text).digest('hex'));
  const now = Date.now();
  if (!liveMetricScopeMatches(frame.scope, identity) || now < started || !Number.isSafeInteger(now)
    || [frame.capturedAtMs, frame.publishedAtMs, frame.endTimeMs].some(time => time > now || now - time > 6000)) throw new Error();
  return frame;
}
