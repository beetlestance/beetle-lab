import { encodeCanonicalJson } from '@beetle/contracts';
import { captureLiveMetricSnapshot, liveMetricScopeMatches } from '@beetle/contracts/api';
import type { LiveMetricHash, LiveMetricSnapshot } from '@beetle/contracts/api';
import type {
  RunExecutionReader,
  RunLiveMetricQuery,
  RunLiveMetricsService,
  RunLiveMetricValue,
  RunnerLiveMetricGateway,
} from '../../ports/run-live-metrics.js';
import type { MetricReadContext } from '../../ports/run-metrics.js';
import { MetricReadError } from '../../ports/run-metrics.js';
import { captureLiveAttemptQuery, captureLiveAttemptBinding } from '../live-attempt/index.js';
import { MetricReadOperation } from '../metric-read-lifetime/index.js';
interface Options {
  executions: RunExecutionReader;
  gateway?: Pick<RunnerLiveMetricGateway, 'liveMetrics'>;
  hash: LiveMetricHash;
  monotonic(): number;
}
function assertFresh(
  frame: LiveMetricSnapshot,
  expected: LiveMetricSnapshot['scope'],
  expires: number,
  now: number,
): void {
  if (
    !liveMetricScopeMatches(frame.scope, expected) ||
    !Number.isFinite(expires) ||
    !Number.isFinite(now) ||
    now < 0 ||
    expires <= now ||
    expires - now > 6000 ||
    frame.publishedAtMs - Math.min(frame.capturedAtMs, frame.endTimeMs) > 6000
  )
    throw new MetricReadError('unavailable');
}
/** Two finite originals; no corpus, background loop, mutation or retry. */
export function createRunLiveMetricsService(options: Options): RunLiveMetricsService {
  const read = options.executions.getRunExecution.bind(options.executions);
  const remote = options.gateway?.liveMetrics.bind(options.gateway);
  const hash = options.hash;
  const monotonic = options.monotonic.bind(options);
  const active = new Map<MetricReadOperation, Promise<unknown>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  async function capture(q: RunLiveMetricQuery, owner: MetricReadOperation): Promise<RunLiveMetricValue> {
    owner.check();
    const before = captureLiveAttemptBinding(await read({ id: q.id, scope: q.scope }), q);
    owner.check();
    if (!remote) throw new MetricReadError('unavailable');
    const result = await remote({ ...before.key.attempt, journalAuthority: before.journalAuthority }, owner.signal);
    owner.check();
    if (!result.ok) throw new MetricReadError('unavailable');
    const frame = captureLiveMetricSnapshot(result.value, hash);
    const receivedMonotonic = monotonic();
    const expected = { ...before.key.attempt };
    assertFresh(frame, expected, result.freshUntilMonotonicMs, receivedMonotonic);
    const after = captureLiveAttemptBinding(await read({ id: q.id, scope: q.scope }), q);
    owner.check();
    if (encodeCanonicalJson(after, 1024) !== encodeCanonicalJson(before, 1024))
      throw new MetricReadError('unavailable');
    const finalMonotonic = monotonic();
    if (finalMonotonic < receivedMonotonic) throw new MetricReadError('unavailable');
    assertFresh(frame, expected, result.freshUntilMonotonicMs, finalMonotonic);
    return { frame, freshUntilMonotonicMs: result.freshUntilMonotonicMs, observedMonotonicMs: finalMonotonic };
  }
  return Object.freeze({
    reader: Object.freeze({
      getRunLiveMetrics(input: RunLiveMetricQuery, context: MetricReadContext) {
        if (closed || active.size >= 2) return Promise.reject(new MetricReadError(closed ? 'closed' : 'busy'));
        let q: RunLiveMetricQuery;
        let owner: MetricReadOperation;
        try {
          q = captureLiveAttemptQuery(input);
          owner = new MetricReadOperation(context, 5000);
        } catch (error) {
          return Promise.reject(error);
        }
        const original = Promise.resolve()
          .then(() => capture(q, owner))
          .finally(() => {
            owner.dispose();
            active.delete(owner);
          });
        active.set(owner, original);
        return owner.race(original);
      },
    }),
    close() {
      closed = true;
      for (const owner of active.keys()) owner.controller.abort();
      closing ??= Promise.allSettled([...active.values()]).then(() => undefined);
      return closing;
    },
  });
}
