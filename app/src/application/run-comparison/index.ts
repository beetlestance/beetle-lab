import { encodeJson } from '@beetle/contracts';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { comparisonFields, comparisonWarnings, runComparisonSnapshotMatches, validateApi, RUN_COMPARISON_BYTES } from '@beetle/contracts/api';
import type { RunComparisonRequest, RunComparisonItem, RunComparisonSnapshot } from '@beetle/contracts/api';
import type { RunComparisonOptions, RunComparisonService } from '../../ports/run-comparison.js';
import { ComparisonError } from '../../ports/run-comparison.js';
import type { MetricReadContext } from '../../ports/run-metrics.js';
import { MetricReadOperation } from '../metric-read-lifetime/index.js';
import { captureRequest } from './capture.js';
import { loadSources, reconcile } from './source.js';
import { environment, summary } from './environment.js';
import { revisionDifferences } from './diff.js';
import { baselineBinding, peerKey } from './logical.js';
import { emptyMetric, readMetric } from './metrics.js';
/** One read-only admitted comparison; its promise retains actual originals through cleanup. */
export function createRunComparisonService(input: RunComparisonOptions): RunComparisonService {
  const options: RunComparisonOptions = {runs: {getRun: input.runs.getRun.bind(input.runs)},
    results: {getRunResult: input.results.getRunResult.bind(input.results)}, suites: {getRevision: input.suites.getRevision.bind(input.suites)},
    metrics: {lookupRunMetricSeries: input.metrics.lookupRunMetricSeries.bind(input.metrics)}, digest: input.digest};
  const schema = createK6ConfigSchema(options.digest);
  let active: {owner: MetricReadOperation; original: Promise<RunComparisonSnapshot>} | undefined;
  let closed = false; let closing: Promise<void> | undefined;
  async function execute(request: RunComparisonRequest, owner: MetricReadOperation): Promise<RunComparisonSnapshot> {
    const sources = await loadSources(request, options, schema, owner); owner.check(); const baseline = sources[0]!;
    const binding = request.metric ? baselineBinding(baseline.config, request.metric) : null;
    const items: RunComparisonItem[] = [];
    for (const source of sources) {
      owner.check();
      const item: RunComparisonItem = {run: source.run, result: summary(source), environment: environment(source, options.digest),
        differences: {fields: [], configChanges: [], limited: false}, warnings: [], metric: emptyMetric('not_requested')};
      if (items.length > 0) {
        item.differences = {...revisionDifferences(baseline.revision, source.revision), fields: comparisonFields(items[0]!, item)};
      }
      if (request.metric && binding) {
        const key = source.result === null ? request.metric : peerKey(source.config, request.metric, binding);
        item.metric = await readMetric(source, key, options.metrics, owner);
      }
      item.warnings = comparisonWarnings(item); items.push(item);
    }
    await reconcile(sources, options, owner); owner.check();
    const value = JSON.parse(encodeJson({scope: request.scope, baselineRunId: request.runIds[0]!, metric: request.metric,
      metricBinding: binding, items}, RUN_COMPARISON_BYTES)) as unknown;
    const checked = validateApi('RunComparisonSnapshot', value);
    if (!checked.ok || !runComparisonSnapshotMatches(checked.value, request)) throw new ComparisonError('unavailable');
    owner.check(); return checked.value;
  }
  return Object.freeze({compare(input: RunComparisonRequest, context: MetricReadContext) {
    if (closed || active) return Promise.reject(new ComparisonError(closed ? 'closed' : 'busy'));
    let request: RunComparisonRequest; let owner: MetricReadOperation;
    try {request = captureRequest(input); owner = new MetricReadOperation(context);} catch (error) {return Promise.reject(error);}
    const original = Promise.resolve().then(() => execute(request, owner)).finally(() => {owner.dispose(); active = undefined;});
    active = {owner, original}; return original;
  }, close() {
    closed = true; active?.owner.controller.abort();
    closing ??= Promise.allSettled([active?.original]).then(() => undefined); return closing;
  }});
}
