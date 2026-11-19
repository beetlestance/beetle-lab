import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { INSTALLATION_RECEIPT_BYTES, selectInstalledConfiguration } from '@beetle/contracts/installation-generation';
import { captureInstalledConfiguration } from '../../../agent/src/bootstrap/index.js';
import { captureInstallationRecord } from '../../../app/src/bootstrap/configuration.js';
import { BindingChangedError, ProvisionError } from '../types.js';
import type { ProvisionContext, ProvisionRequest } from '../types.js';
import { canonical, capture, digest } from './capture.js';
import { configurationStatePath, paths } from './configuration.js';
import { captureOriginSelector } from './origin-selector.js';
import type { OriginSelector } from './origin-selector.js';
import { PrivateFiles } from './files.js';
import { parse } from './receipt.js';

const absent = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';
const decode = (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value);
function valid(condition: unknown): asserts condition {
  if (!condition) throw new ProvisionError('recovery_required');
}
type Baseline = {
  receipt: Record<string, unknown>;
  agent: string;
  installation: string;
  backendAgent: string;
  origin?: OriginSelector;
};
/** The provisioned receipt without the selector-only fields, so only baseline files are selected. */
function baselineReceipt(value: unknown): Record<string, unknown> | undefined {
  valid(value !== null && typeof value === 'object' && !Array.isArray(value));
  const { generation: _generation, upgradeFence: _fence, ...receipt } = value as Record<string, unknown>;
  void _generation;
  void _fence;
  return receipt.phase === 'ready' ? receipt : undefined;
}
async function readBaseline(files: PrivateFiles, root: string): Promise<Baseline | undefined> {
  let bytes: Uint8Array;
  try {
    await files.pin(root);
    bytes = await files.read(join(root, 'installation.json'), INSTALLATION_RECEIPT_BYTES);
  } catch (cause) {
    // No provisioned receipt yet: interrupted first setup resumes with this release's request.
    if (absent(cause)) return undefined;
    throw cause;
  }
  const receipt = baselineReceipt(parse(bytes));
  if (!receipt) return undefined;
  await files.pin(join(root, 'config'));
  const p = paths(root);
  const [agent, installation, backendAgent] = await Promise.all(
    [p.agent, p.installation, p.backendAgent].map(async (path) => decode(await files.read(path))),
  );
  const origin = await selectedOrigin(files, root);
  return {
    receipt,
    agent: agent!,
    installation: installation!,
    backendAgent: backendAgent!,
    ...(origin ? { origin } : {}),
  };
}
/** The selector's changed origin, if any; an absent selector (older installation) has none. */
async function selectedOrigin(files: PrivateFiles, root: string): Promise<OriginSelector | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await files.read(configurationStatePath(root), INSTALLATION_RECEIPT_BYTES);
  } catch (cause) {
    if (absent(cause)) return undefined;
    throw cause;
  }
  const selector = record(parse(bytes));
  return Object.hasOwn(selector, 'origin') ? captureOriginSelector(selector.origin) : undefined;
}
function record(value: unknown): Record<string, unknown> {
  valid(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
/** Bindings the baseline configuration records, as fixed names; values never leave this function. */
function changedBindings(request: ProvisionRequest, agent: unknown, backendAgent: unknown): string[] {
  const a = record(agent);
  const installation = record(a.installation);
  const engines = a.engines;
  valid(Array.isArray(engines) && engines.length > 0);
  const network = record(record(record(engines[0]).profile).network);
  const checks: [string, unknown, unknown][] = [
    ['root', a.journalDirectory, paths(request.root).agentJournal],
    ['agent_container', installation.agentContainer, request.agentContainer],
    ['target_network', network.name, request.targetNetwork],
    ['docker_socket', a.dockerSocket, request.dockerSocket],
    ['agent_origin', record(backendAgent).origin, request.agentOrigin],
  ];
  return checks.filter(([, installed, requested]) => installed !== requested).map(([name]) => name);
}
/**
 * Decision 031: an existing installation keeps the settings and admission policy it was
 * provisioned with. Returns this release's request with `installationValues` and
 * `agentPolicy` read from the baseline configuration (through their owning decoders), so a
 * changed starter default neither re-pins nor refuses it; the receipt's request digest still
 * proves everything else. Without a ready baseline the request is returned unchanged.
 * Recorded bindings that differ are refused by name (`binding_changed`), never re-pinned.
 * `formerOrigin` is the origin the installation would have recorded before decision 032 (the
 * loopback port); an installation set up with it refuses a changed origin as `external_origin`.
 */
export async function installedRequest(
  request: ProvisionRequest,
  context: ProvisionContext,
  formerOrigin?: string,
  originCandidates?: readonly string[],
): Promise<ProvisionRequest> {
  // Upgrade actions carry a longer overall deadline; each configuration step gets at most 30 s.
  const step = { ...context, deadline: Math.min(context.deadline, performance.now() + 30_000) };
  const c = capture(request, step);
  const files = new PrivateFiles(c);
  let baseline: Baseline | undefined;
  try {
    baseline = await readBaseline(files, c.request.root);
  } finally {
    await files.close();
  }
  if (!baseline) return c.request;
  try {
    const request = pinned(c.request, baseline, step);
    return originCandidates
      ? recordedOrigin(request, baseline, step, originCandidates)
      : originChecked(request, baseline, step, formerOrigin);
  } catch (cause) {
    if (cause instanceof ProvisionError) throw cause;
    throw new ProvisionError('recovery_required', { cause });
  }
}
function pinned(request: ProvisionRequest, baseline: Baseline, context: ProvisionContext): ProvisionRequest {
  const select = (name: 'agent.json' | 'installation.json' | 'backend-agent.json', text: string) =>
    selectInstalledConfiguration(baseline.receipt, name, text, digest);
  const agentFile = select('agent.json', baseline.agent);
  const changed = changedBindings(request, agentFile, select('backend-agent.json', baseline.backendAgent));
  if (changed.length) throw new BindingChangedError(changed);
  const agent = captureInstalledConfiguration(agentFile);
  const installation = captureInstallationRecord(select('installation.json', baseline.installation));
  return capture({ ...request, installationValues: installation.values, agentPolicy: agent.configuration }, context)
    .request;
}
/**
 * For `setup origin`: the request as recorded, whichever origin it was recorded with. The
 * baseline is the selector's when a change exists, else the candidate (`--from`, or the
 * target when an earlier change returned to the baseline) whose digest matches.
 */
function recordedOrigin(
  request: ProvisionRequest,
  baseline: Baseline,
  context: ProvisionContext,
  candidates: readonly string[],
): ProvisionRequest {
  if (baseline.origin) return capture({ ...request, externalOrigin: baseline.origin.baseline }, context).request;
  for (const externalOrigin of candidates) {
    const recorded = capture({ ...request, externalOrigin }, context).request;
    if (digest(canonical(recorded)) === baseline.receipt.requestDigest) return recorded;
  }
  throw new BindingChangedError(['external_origin']);
}
/**
 * Decision 032: an installation serves its recorded origin unless `setup origin` changed it.
 * A changed origin is resolved back to the baseline the request digest was recorded with.
 */
function originChecked(request: ProvisionRequest, baseline: Baseline, context: ProvisionContext, former?: string) {
  if (baseline.origin) {
    if (request.externalOrigin !== baseline.origin.current) throw new BindingChangedError(['external_origin']);
    return capture({ ...request, externalOrigin: baseline.origin.baseline }, context).request;
  }
  const recorded = baseline.receipt.requestDigest;
  if (!former || former === request.externalOrigin || digest(canonical(request)) === recorded) return request;
  const before = capture({ ...request, externalOrigin: former }, context).request;
  if (digest(canonical(before)) === recorded) throw new BindingChangedError(['external_origin']);
  return request;
}
