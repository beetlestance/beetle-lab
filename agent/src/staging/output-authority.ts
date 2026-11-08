import { join } from 'node:path';
import { isRuntimePlan, runtimeName } from '../backends/docker/index.js';
import type { RuntimePlan } from '../backends/docker/index.js';
import { MAX_RESOURCE_VALUE } from '../admission/index.js';
import { scopeSnapshot } from './authority.js';
import { snapshot } from './bounds.js';
import { data, ScanFailure } from './output-budget.js';
import { rootIdentity } from './root.js';
import type { RootIdentity } from './root.js';
import type { OutputScanRequest } from './output-types.js';
import type { VerifiedRoot } from './types.js';
type CreateSpec = RuntimePlan['spec'];

export interface OutputAuthority {
  readonly identity: RootIdentity;
  readonly directory: string;
  readonly outputBytes: bigint;
  readonly minimumFreeBytes: number;
}
function integer(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function labels(spec: CreateSpec, expected: Record<string, string>): boolean {
  return Object.entries(expected).every(([key, value]) => spec.Labels[key] === value);
}
function limits(raw: Pick<OutputScanRequest, 'outputBytes' | 'minimumFreeBytes'>): void {
  if (!integer(raw.outputBytes, MAX_RESOURCE_VALUE) || raw.outputBytes === 0
    || !integer(raw.minimumFreeBytes, Number.MAX_SAFE_INTEGER)) throw new ScanFailure('invalid_input');
}
export function outputAuthority(root: VerifiedRoot, input: OutputScanRequest): OutputAuthority {
  const identity = rootIdentity(root); const config = identity.configuration;
  const raw = snapshot({ key: data(input, 'key'), outputBytes: data(input, 'outputBytes'),
    minimumFreeBytes: data(input, 'minimumFreeBytes') }, 2048) as Pick<OutputScanRequest, 'key' | 'outputBytes' | 'minimumFreeBytes'>;
  const key = scopeSnapshot(raw.key);
  limits(raw);
  const plan = data(input, 'plan');
  if (!isRuntimePlan(plan)) throw new ScanFailure('invalid_input');
  const spec = snapshot(data(plan, 'spec'), 65_536) as CreateSpec;
  const name = runtimeName({ ...key, installationId: config.installationId });
  const directory = join(config.stagingRoot, name, 'output');
  if (data(plan, 'name') !== name || spec.User !== config.user) throw new ScanFailure('invalid_input');
  if (!labels(spec, { 'dev.beetle.installation': config.installationId.toLowerCase(),
    'dev.beetle.organization': key.organizationId.toLowerCase(), 'dev.beetle.workspace': key.workspaceId.toLowerCase(),
    'dev.beetle.attempt': key.attemptId.toLowerCase(), 'dev.beetle.generation': String(key.generation) })) throw new ScanFailure('invalid_input');
  const mounts = spec.HostConfig.Mounts.filter(mount => mount.Target === '/beetle/output');
  if (mounts.length !== 1 || mounts[0]?.Type !== 'bind' || mounts[0].Source !== directory || mounts[0].ReadOnly !== false) throw new ScanFailure('invalid_input');
  return Object.freeze({ identity, directory, outputBytes: BigInt(raw.outputBytes), minimumFreeBytes: raw.minimumFreeBytes });
}
