import { encodeCanonicalJson } from '@beetle/contracts';
import { captureLiveMetricHistory, liveMetricScopeMatches } from '@beetle/contracts/api';
import type { LiveMetricHash, LiveMetricHistory } from '@beetle/contracts/api';
import type { RunExecutionReader, RunLiveMetricQuery } from '../../ports/run-live-metrics.js';
import type { RunnerLiveHistoryGateway, RunLiveHistoryService } from '../../ports/run-live-history.js';
import type { MetricReadContext } from '../../ports/run-metrics.js';
import { MetricReadError } from '../../ports/run-metrics.js';
import { captureLiveAttemptQuery, captureLiveAttemptBinding } from '../live-attempt/index.js';
import { MetricReadOperation } from '../metric-read-lifetime/index.js';
interface Options {
  executions: RunExecutionReader;
  gateway?: RunnerLiveHistoryGateway;
  hash: LiveMetricHash;
}
/** One finite bootstrap; current physical binding is checked before and after remote IO. */
export function createRunLiveHistoryService(options: Options): RunLiveHistoryService {
  const read = options.executions.getRunExecution.bind(options.executions);
  const remote = options.gateway?.liveHistory.bind(options.gateway);
  const hash = options.hash;
  const active = new Map<MetricReadOperation, Promise<unknown>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  async function capture(query: RunLiveMetricQuery, owner: MetricReadOperation): Promise<LiveMetricHistory> {
    owner.check();
    const before = captureLiveAttemptBinding(await read({ id: query.id, scope: query.scope }), query);
    owner.check();
    if (!remote) throw new MetricReadError('unavailable');
    const result = await remote({ ...before.key.attempt, journalAuthority: before.journalAuthority }, owner.signal);
    owner.check();
    if (!result.ok) throw new MetricReadError('unavailable');
    let value: LiveMetricHistory;
    try {
      value = captureLiveMetricHistory(result.value, hash);
    } catch {
      throw new MetricReadError('unavailable');
    }
    if (!liveMetricScopeMatches(value.scope, before.key.attempt)) throw new MetricReadError('unavailable');
    const after = captureLiveAttemptBinding(await read({ id: query.id, scope: query.scope }), query);
    owner.check();
    if (encodeCanonicalJson(before, 1024) !== encodeCanonicalJson(after, 1024))
      throw new MetricReadError('unavailable');
    return value;
  }
  return Object.freeze({
    reader: Object.freeze({
      getRunLiveHistory(input: RunLiveMetricQuery, context: MetricReadContext) {
        if (closed || active.size >= 1) return Promise.reject(new MetricReadError(closed ? 'closed' : 'busy'));
        let query: RunLiveMetricQuery;
        let owner: MetricReadOperation;
        try {
          query = captureLiveAttemptQuery(input);
          owner = new MetricReadOperation(context, 30000);
        } catch (error) {
          return Promise.reject(error);
        }
        const original = Promise.resolve()
          .then(() => capture(query, owner))
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
