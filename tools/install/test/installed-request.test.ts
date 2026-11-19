import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { provisionFreshInstallation } from '../index.js';
import { installedRequest } from '../src/installed-request.js';
import { capture, canonical, digest } from '../src/capture.js';
import { readInstalled } from '../upgrade/apply.js';
import { BindingChangedError, ProvisionError } from '../types.js';
import type { ProvisionRequest } from '../types.js';
import { fixture } from './fixtures.js';

const f = fixture();
const requestDigest = async (root: string) => (JSON.parse(await readFile(join(root, 'installation.json'), 'utf8')) as { requestDigest: string }).requestDigest;
function changedDefaults(request: ProvisionRequest): ProvisionRequest {
  const values = request.installationValues;
  return { ...request,
    installationValues: { ...values, pool: { ...values.pool, freeSpaceReserveBytes: values.pool.freeSpaceReserveBytes + 4096 } },
    agentPolicy: { ...request.agentPolicy, controlReserve: { ...request.agentPolicy.controlReserve, cpuMillis: 750 } } };
}

it('returns the request unchanged before any installation exists', async () => {
  const e = await f.setup();
  expect(canonical(await installedRequest(e.request, e.context))).toBe(canonical(e.request));
});

it('keeps the installed settings and policy when this release ships different defaults', async () => {
  const e = await f.setup();
  await provisionFreshInstallation(e.request, e.context);
  const shipped = changedDefaults(e.request);
  expect(digest(canonical(shipped))).not.toBe(await requestDigest(e.root));
  const pinned = await installedRequest(shipped, e.context);
  expect(pinned.agentPolicy).toEqual(e.request.agentPolicy);
  expect(pinned.installationValues).toEqual(e.request.installationValues);
  expect(digest(canonical(pinned))).toBe(await requestDigest(e.root));
  const installed = await readInstalled(capture(pinned, e.context));
  expect(installed.evaluation.current).toBe(true);
  // Upgrade actions pass a 30-minute overall deadline; the rebuild still captures within 30 s steps.
  const upgrade = { ...e.context, deadline: performance.now() + 30 * 60_000 };
  expect(canonical(await installedRequest(shipped, upgrade))).toBe(canonical(pinned));
});

it('refuses changed recorded bindings by fixed name and still proves the rest by digest', async () => {
  const e = await f.setup();
  await provisionFreshInstallation(e.request, e.context);
  const renamed = { ...e.request, agentContainer: 'beetle-other-agent', targetNetwork: 'beetle-other-targets' };
  const refusal = await installedRequest(renamed, e.context).catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(BindingChangedError);
  expect((refusal as BindingChangedError).items).toEqual(['agent_container', 'target_network']);
  // An unrecorded difference (the engine template) passes through and is left to the digest check.
  const engine = { ...e.request.engine, tmpfsBytes: e.request.engine.tmpfsBytes * 2 };
  const pinned = await installedRequest({ ...e.request, engine }, e.context);
  expect(digest(canonical(pinned))).not.toBe(await requestDigest(e.root));
  await expect(readInstalled(capture(pinned, e.context))).rejects.toMatchObject({ code: 'recovery_required' });
});

it('fails closed when a baseline configuration no longer matches its receipt digest', async () => {
  const e = await f.setup();
  const result = await provisionFreshInstallation(e.request, e.context);
  const { writeFile } = await import('node:fs/promises');
  const agent = JSON.parse(await readFile(result.paths.agent, 'utf8')) as { configuration: { maxConcurrent: number } };
  agent.configuration.maxConcurrent += 1;
  await writeFile(result.paths.agent, JSON.stringify(agent), { mode: 0o600 });
  const refusal = await installedRequest(changedDefaults(e.request), e.context).catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(ProvisionError);
  expect(refusal).not.toBeInstanceOf(BindingChangedError);
});

it('refuses a changed origin by fixed name until an origin-change command exists (decision 032)', async () => {
  const e = await f.setup();
  await provisionFreshInstallation(e.request, e.context);
  const moved = { ...e.request, externalOrigin: 'https://lab.example.internal' };
  const refusal = await installedRequest(moved, e.context, e.request.externalOrigin).catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(BindingChangedError);
  expect((refusal as BindingChangedError).items).toEqual(['external_origin']);
  // The unchanged origin, and installed defaults that differ, still pin as before.
  const pinned = await installedRequest(changedDefaults(e.request), e.context, e.request.externalOrigin);
  expect(digest(canonical(pinned))).toBe(await requestDigest(e.root));
});
