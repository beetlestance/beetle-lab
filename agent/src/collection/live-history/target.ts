import { liveMetricScopeMatches, validateApi } from '@beetle/contracts/api';
import type { LiveTargetHistorySample } from '@beetle/contracts/api';
import { OutputFailure } from '../output/index.js';
import type { OutputIO } from '../output/index.js';
import type { CapturedOptions } from './options.js';
import type { PrefixFiles } from './files.js';
import { PrefixLines } from './lines.js';
import { fields, required } from './records.js';

/** Complete captured target prefix; no thinning, interpolation or missing-value coercion. */
export async function targetSamples(
  files: PrefixFiles,
  options: CapturedOptions,
  owner: OutputIO,
): Promise<LiveTargetHistorySample[]> {
  const target = options.prefix.target;
  if (!target) throw new OutputFailure('invalid_options');
  const lines = new PrefixLines(files, 'target', target.data);
  targetHeader((await required(lines, 1024)).value, options);
  const result: LiveTargetHistorySample[] = [];
  for (let sequence = 1; sequence <= target.samples; sequence++) {
    owner.check();
    const record = fields((await required(lines, 16384)).value, ['kind', 'sequence', 'sample']);
    const checked = validateApi('LiveTargetHistorySample', record.sample);
    if (record.kind !== 'sample' || record.sequence !== sequence || !checked.ok) throw new OutputFailure('integrity');
    result.push(checked.value);
  }
  if (await lines.next(16384)) throw new OutputFailure('integrity');
  lines.verify();
  owner.check();
  return result;
}

function targetHeader(input: unknown, options: CapturedOptions): void {
  const target = options.prefix.target!;
  const header = fields(input, ['format', 'version', 'scope', 'artifactId', 'intervalMs']);
  const scope = validateApi('LiveMetricScope', header.scope);
  if (
    header.format !== 'beetle-target-samples' ||
    header.version !== 1 ||
    !scope.ok ||
    !liveMetricScopeMatches(scope.value, options.scope) ||
    header.intervalMs !== target.intervalMs ||
    typeof header.artifactId !== 'string' ||
    header.artifactId.toLowerCase() !== target.data.artifactId.toLowerCase()
  )
    throw new OutputFailure('integrity');
}
