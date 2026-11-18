import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { LIVE_HISTORY_BYTES, captureLiveMetricHistory, liveMetricScopeMatches } from '@beetle/contracts/api';
import type { ClientResult } from '@beetle/contracts';
import type { LiveMetricHistory } from '@beetle/contracts/api';
import type { RunnerAttemptIdentity } from '../../../ports/runner.js';
import { scopeHeaders } from './identity.js';
import { nativeCall } from './native.js';
import { protocolReply } from './transport.js';
import type { Connection } from './transport.js';
export function readLiveHistory(
  connection: Connection,
  identity: RunnerAttemptIdentity,
  signal?: AbortSignal,
): Promise<ClientResult<LiveMetricHistory>> {
  return connection.credits.run<LiveMetricHistory>('history', signal, async (original) => {
    if (identity.generation !== 1) return { ok: false, error: { kind: 'request' } };
    const deadline = performance.now() + 30000;
    const response = await nativeCall(
      {
        origin: connection.origin,
        method: 'GET',
        path: `/runner/v1/attempts/${encodeURIComponent(identity.attemptId)}/live-history`,
        headers: { authorization: `Bearer ${connection.token}`, ...scopeHeaders(identity) },
        body: undefined,
        signal: original.signal,
        responseBytes: LIVE_HISTORY_BYTES,
      },
      connection.io,
    );
    if (!response.ok) return { ok: false, error: { kind: response.kind } };
    if (response.status !== 200) return protocolReply(response, identity);
    try {
      const value = captureLiveMetricHistory(response.value, (text) => createHash('sha256').update(text).digest('hex'));
      if (!liveMetricScopeMatches(value.scope, identity))
        return { ok: false, error: { kind: 'response', status: 200 } };
      const failure = original.failure();
      if (failure || original.signal.aborted) return { ok: false, error: { kind: failure ?? 'cancelled' } };
      if (performance.now() >= deadline) return { ok: false, error: { kind: 'timeout' } };
      return { ok: true, value };
    } catch {
      return { ok: false, error: { kind: 'response', status: 200 } };
    }
  });
}
