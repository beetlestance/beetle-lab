import type { Receipt } from './receipt.js';
import { initializeBackendRecovery, openBackendServing } from '../../../app/src/bootstrap/recovery-control/index.js';
import type { BackendServingLease } from '../../../app/src/bootstrap/recovery-control/index.js';
import { join } from 'node:path';
import { installationStatePath, loadAgentConfiguration } from '../../../agent/src/bootstrap/index.js';
import type { LoadedAgentConfiguration } from '../../../agent/src/bootstrap/index.js';
import {
  initializeInstallationState,
  openServingState,
  InstallationStateError,
} from '../../../agent/src/installation-state/index.js';
import type { InitializingState, ServingState } from '../../../agent/src/installation-state/index.js';
import { openJournal } from '../../../agent/src/journal/index.js';
import type { Journal } from '../../../agent/src/journal/index.js';
import { loadBackendConfiguration } from '../../../app/src/bootstrap/configuration.js';
import type { Captured } from './capture.js';
import { check, canonical } from './capture.js';
import { paths } from './configuration.js';
import { ProvisionError } from '../types.js';
import type { PrivateFiles } from './files.js';

const retained = new Set<object>();
interface Owners {
  backend?: BackendServingLease;
  loaded?: LoadedAgentConfiguration;
  journal?: Journal;
  gate?: InitializingState | ServingState;
}
async function drain(owners: Owners): Promise<void> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => owners.loaded?.close()),
    Promise.resolve().then(() => owners.journal?.close()),
  ]);
  // The exclusive gate outlives provider and journal cleanup, including uncertain failures.
  const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (failures.length) {
    retained.add(owners);
    throw new ProvisionError('cleanup', { cause: new AggregateError(failures, 'Installation cleanup failed') });
  }
  try {
    owners.backend?.close();
    owners.gate?.close();
  } catch (cause) {
    retained.add(owners);
    throw new ProvisionError('cleanup', { cause });
  }
}
async function validateBackend(c: Captured, installationId: string, baseline: boolean, receipt?: Receipt) {
  const p = paths(c.request.root);
  const backend = await loadBackendConfiguration(
    {
      BEETLE_CONFIG_FILE: p.installation,
      BEETLE_AGENT_CONFIG_FILE: p.backendAgent,
      BEETLE_DATA_DIR: p.backendData,
      BEETLE_EXTERNAL_ORIGIN: c.request.externalOrigin,
    },
    c.context.backendWorkerUrl,
    baseline ? { baseline: true, receipt } : undefined,
  );
  if (backend.application.metadata.installation?.id !== installationId) throw new ProvisionError('recovery_required');
  return backend;
}

function loadAuthorityConfiguration(c: Captured, ready: boolean) {
  return loadAgentConfiguration(
    { BEETLE_AGENT_CONFIG_FILE: paths(c.request.root).agent },
    c.context.agentWorkerUrl,
    c.context.signal,
    ready ? undefined : { baseline: true },
  );
}
export async function authority(
  c: Captured,
  files: PrivateFiles,
  installationId: string,
  expected?: string,
): Promise<string> {
  const p = paths(c.request.root);
  const owners: Owners = {};
  let actual: string;
  try {
    check(c.context);
    await files.assertPins();
    owners.loaded = await loadAuthorityConfiguration(c, Boolean(expected));
    check(c.context);
    const runtime = owners.loaded.runtime;
    if (
      runtime.installation.installationId !== installationId ||
      runtime.journal.path !== join(p.agentJournal, 'journal.sqlite')
    ) {
      throw new ProvisionError('recovery_required');
    }
    const backend = await validateBackend(c, installationId, !expected);
    matchProfiles(backend, runtime.catalog);
    const backendGate = join(p.backendData, 'recovery-control.sqlite');
    if (!expected) initializeBackendRecovery(backendGate, installationId);
    owners.backend = openBackendServing(backendGate, installationId);
    check(c.context);
    const statePath = installationStatePath(runtime.journal.path);
    // Ready replay acquires exclusive serving authority before opening the journal.
    if (expected) owners.gate = openServingState(statePath);
    else owners.gate = initializeInstallationState(statePath);
    check(c.context);
    await files.assertPins();
    owners.journal = await openJournal(runtime.journal);
    check(c.context);
    actual = await owners.journal.journalAuthority();
    check(c.context);
    if (expected) {
      if (actual !== expected) throw new ProvisionError('recovery_required');
      (owners.gate as ServingState).assertJournalAuthority(actual);
    } else {
      await owners.journal.admission({
        kind: 'configure',
        configuration: { ...runtime.configuration, profiles: runtime.catalog.engines.map((engine) => engine.approved) },
      });
      check(c.context);
      (owners.gate as InitializingState).complete(actual);
    }
  } catch (cause) {
    if (cause instanceof InstallationStateError && cause.code === 'owned')
      throw new ProvisionError('conflict', { cause });
    throw cause;
  } finally {
    await drain(owners);
  }
  check(c.context);
  return actual;
}

function matchProfiles(
  backend: Awaited<ReturnType<typeof validateBackend>>,
  catalog: LoadedAgentConfiguration['runtime']['catalog'],
): void {
  const connection = backend.application.agent?.connection?.configuration;
  if (!connection) throw new ProvisionError('recovery_required');
  const profiles = [...connection.profiles, ...(connection.exportProfiles ?? []).map((item) => item.profile)];
  if (
    new Set(profiles.map((profile) => profile.engine.profileId)).size !== profiles.length ||
    profiles.length !== catalog.engines.length
  )
    throw new ProvisionError('recovery_required');
  for (const profile of profiles) {
    matchProfile(profile, catalog);
  }
}
/** Configuration readiness only; no Journal mutation or serving authority is granted. */
export async function validateCommittedGeneration(
  c: Captured,
  installationId: string,
  receipt?: Receipt,
): Promise<void> {
  const loaded = await loadAgentConfiguration(
    { BEETLE_AGENT_CONFIG_FILE: paths(c.request.root).agent },
    c.context.agentWorkerUrl,
    c.context.signal,
    receipt ? { baseline: true, receipt } : undefined,
  );
  try {
    const backend = await validateBackend(c, installationId, Boolean(receipt), receipt);
    if (loaded.runtime.installation.installationId !== installationId) throw new ProvisionError('recovery_required');
    matchProfiles(backend, loaded.runtime.catalog);
  } finally {
    await loaded.close();
  }
}

type Connection = NonNullable<
  NonNullable<Awaited<ReturnType<typeof validateBackend>>['application']['agent']>['connection']
>;
function matchProfile(
  profile: Connection['configuration']['profiles'][number],
  catalog: LoadedAgentConfiguration['runtime']['catalog'],
): void {
  const installed = catalog.engines.find((engine) => engine.validation.profileId === profile.engine.profileId);
  if (
    !installed ||
    canonical(installed.installedIdentity) !== canonical(profile.installedIdentity) ||
    installed.manifest.engineId !== profile.engine.id ||
    installed.profile.imageDigest !== profile.engine.imageDigest ||
    installed.configVersion !== profile.engine.configVersion ||
    canonical(installed.manifest.capabilities) !== canonical(profile.requiredCapabilities)
  )
    throw new ProvisionError('recovery_required');
}
