import { HistorySamples } from './samples.js';
import { captureMetricWindow, metricSeriesIdentity, projectMetricSeries } from '@beetle/contracts/metrics';
import { liveMetricScopeMatches, validateApi } from '@beetle/contracts/api';
import type { LiveMetricHistory } from '@beetle/contracts/api';
import { OutputFailure } from '../output/index.js';
import type { OutputIO } from '../output/index.js';
import type { CapturedOptions } from './options.js';
import type { PrefixFiles } from './files.js';
import { PrefixLines } from './lines.js';
import { fields, required } from './records.js';
import { targetSamples } from './target.js';
export type PrefixHistory = LiveMetricHistory;

function header(input: unknown, lane: 'data' | 'index', options: CapturedOptions): void {
  const value = fields(input, ['format', 'version', 'scope', 'dataArtifactId']);
  const scope = validateApi('LiveMetricScope', value.scope);
  if (
    !scope.ok ||
    !liveMetricScopeMatches(scope.value, options.scope) ||
    value.version !== 1 ||
    value.format !== (lane === 'data' ? 'beetle-k6-metric-windows' : 'beetle-k6-metric-index') ||
    typeof value.dataArtifactId !== 'string' ||
    value.dataArtifactId.toLowerCase() !== options.prefix.data.artifactId.toLowerCase()
  )
    throw new OutputFailure('integrity');
}
/** Both prefix hashes and all records are verified, even when only 900 windows are retained. */
export async function scan(files: PrefixFiles, options: CapturedOptions, owner: OutputIO): Promise<PrefixHistory> {
  const data = new PrefixLines(files, 'data', options.prefix.data);
  const index = new PrefixLines(files, 'index', options.prefix.index);
  header((await required(data, 1024)).value, 'data', options);
  header((await required(index, 1024)).value, 'index', options);
  const selected = new Map(options.frame.subset.selected.map((row) => [metricSeriesIdentity(row), row.ordinal]));
  const result: PrefixHistory = {
    prefix: options.prefix,
    scope: options.scope,
    producerEpoch: options.frame.producerEpoch,
    subset: options.frame.subset,
    subsetDigest: options.frame.subsetDigest,
    sampled: options.prefix.windows > 900,
    samples: [],
  };
  if (options.prefix.target) result.targetSamples = await targetSamples(files, options, owner);
  const limit = Math.min(900, options.prefix.windows);
  let next = 1;
  let previousEnd = -1;
  const samples = new HistorySamples(result);
  let selectedCount = 0;
  for (let sequence = 1; sequence <= options.prefix.windows; sequence++) {
    owner.check();
    const row = await required(data, 1048576);
    const position = (await required(index, 256)).value;
    const window = checkedWindow(row, position, sequence, previousEnd);
    previousEnd = window.endTimeMs;
    if (sequence === next) {
      const series = window.series.flatMap((value) => {
        const ordinal = selected.get(metricSeriesIdentity(value));
        return ordinal === undefined ? [] : [projectMetricSeries(value, ordinal)];
      });
      const sample = { sequence, startTimeMs: window.startTimeMs, endTimeMs: window.endTimeMs, series };
      samples.add(sample);
      selectedCount++;
      next =
        limit === 1
          ? Number.POSITIVE_INFINITY
          : 1 + Math.floor((selectedCount * (options.prefix.windows - 1)) / (limit - 1));
    }
  }
  if (previousEnd !== options.prefix.endTimeMs || (await data.next(256)) || (await index.next(256)))
    throw new OutputFailure('integrity');
  data.verify();
  index.verify();
  owner.check();
  result.samples = samples.values();
  result.sampled = result.samples.length < options.prefix.windows;
  return result;
}

function checkedWindow(
  row: Awaited<ReturnType<typeof required>>,
  input: unknown,
  sequence: number,
  previousEnd: number,
) {
  const position = fields(input, ['sequence', 'startTimeMs', 'endTimeMs', 'offset', 'length']);
  const record = fields(row.value, ['kind', 'sequence', 'window']);
  if (record.kind !== 'window' || record.sequence !== sequence) throw new OutputFailure('integrity');
  const window = windowValue(record.window);
  if (
    position.sequence !== sequence ||
    position.offset !== row.offset ||
    position.length !== row.bytes ||
    position.startTimeMs !== window.startTimeMs ||
    position.endTimeMs !== window.endTimeMs ||
    window.startTimeMs < previousEnd
  )
    throw new OutputFailure('integrity');
  return window;
}
function windowValue(input: unknown) {
  try {
    return captureMetricWindow(input);
  } catch {
    throw new OutputFailure('integrity');
  }
}
