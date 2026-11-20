// Settings fixtures: installation, organization and workspace levels with the values the
// Penpot boards show, plus the retention preview and progress of the "Checkout" workspace.
import type { Api, Json } from '../harness.js';
import { NOW } from '../harness.js';
import { fixture, ids, signedIn } from './index.js';

const GB = 1_000_000_000;
const MIN = 60_000;

type Dict = Record<string, Json>;
const installation: Json = { kind: 'installation' };
const organizationSource: Json = { kind: 'organization', organizationId: ids.organization };
const workspaceSource: Json = { kind: 'workspace', organizationId: ids.organization, workspaceId: ids.workspace };
const budget = (timeoutMs: number, memoryBytes: number, cpuMillis: number, pids: number, outputBytes: number) => ({
  cpuMillis,
  memoryBytes,
  pids,
  timeoutMs,
  outputBytes,
});

/** Allowed ranges per budget leaf: the timeout may be at most 120 minutes, as the field-state board says. */
const ranges = {
  cpuMillis: { minimum: 1, maximum: 8000 },
  memoryBytes: { minimum: 1, maximum: 32 * GB },
  pids: { minimum: 1, maximum: 4096 },
  timeoutMs: { minimum: MIN, maximum: 120 * MIN },
  outputBytes: { minimum: 1, maximum: 20 * GB },
} as const;
type Leaf = keyof typeof ranges;
const leaves = Object.keys(ranges) as Leaf[];

/** Effective budget: each leaf with its value and where it comes from. */
function effective(values: Record<Leaf, number>, sources: Partial<Record<Leaf, Json>> = {}): Json {
  const base = fixture<Dict>('installation-settings').effective as { runDefaults: Dict };
  const budgetLeaves = Object.fromEntries(
    leaves.map((leaf) => [
      leaf,
      { value: values[leaf], source: sources[leaf] ?? installation, allowedRange: ranges[leaf] },
    ]),
  );
  return { ...base, runDefaults: { ...base.runDefaults, budget: budgetLeaves } };
}

const installationBudget = budget(60 * MIN, 8 * GB, 2000, 512, 2 * GB);

/** `/settings`: installation level, as the Installation board shows it. */
export function installationSettings(over: Dict = {}): Json {
  const base = fixture<Dict>('installation-settings');
  const values = base.values as Dict;
  return {
    ...base,
    effective: effective(installationBudget),
    values: {
      ...values,
      pool: {
        cpuMillis: 8000,
        memoryBytes: 16 * GB,
        pids: 4096,
        outputBytes: 20 * GB,
        concurrency: 2,
        storageBytes: 200 * GB,
        freeSpaceReserveBytes: 10 * GB,
      },
      perRunCeilings: budget(120 * MIN, 32 * GB, 8000, 4096, 20 * GB),
      runDefaults: { engineProfile: 'k6-local', budget: installationBudget },
      administratorName: 'Meera',
    },
    ...over,
  };
}

/** Host figures the Capacity board reports: 10 CPUs, 32 GB memory, 412 GB free disk. */
export function hostStatus(): Json {
  const base = fixture<Dict>('installation-status');
  const host = base.host as Dict;
  const disk = base.disk as Dict;
  return {
    ...base,
    generatedAt: NOW,
    host: {
      ...host,
      cpuCores: { status: 'measured', value: 10 },
      memoryTotalBytes: { status: 'measured', value: 32 * GB },
    },
    disk: { ...disk, backendFreeBytes: { status: 'measured', value: 412 * GB } },
  };
}

/** Organization level: memory is set here, everything else comes from the installation. */
export function organizationSettings(over: Dict = {}): Json {
  const base = fixture<Dict>('organization-settings');
  return {
    ...base,
    effective: effective({ ...installationBudget, memoryBytes: 4 * GB }, { memoryBytes: organizationSource }),
    overrides: { runDefaults: { budget: { memoryBytes: 4 * GB } } },
    ...over,
  };
}

/** Workspace level: longest run, processes and output are set here; memory comes from the organization. */
export function workspaceSettings(over: Dict = {}): Json {
  const base = fixture<Dict>('workspace-settings');
  const ws = workspaceSource;
  const org = organizationSource;
  const values = budget(30 * MIN, 4 * GB, 2000, 256, 2 * GB);
  const sources = { timeoutMs: ws, memoryBytes: org, pids: ws, outputBytes: ws };
  const retention = { value: { mode: 'enabled', ageDays: 90 }, source: org };
  const eff = effective(values, sources) as { runDefaults: Dict };
  return {
    ...base,
    effective: { ...eff, retention },
    overrides: { runDefaults: { budget: { timeoutMs: 30 * MIN, pids: 256, outputBytes: 2 * GB } } },
    ...over,
  };
}

/** Handlers for every settings read the three levels and the shell make. */
export function settingsApi(api: Api, version = 1): Api {
  return signedIn(api)
    .on('getOrganizationOverview', organizationOverviewStub())
    .on('getInstallationSettings', installationSettings({ version }))
    .on('getOrganizationSettings', organizationSettings({ version }))
    .on('getWorkspaceSettings', workspaceSettings({ version }))
    .on('getInstallationStatus', hostStatus());
}

const HOUR = 3_600_000;
function organizationOverviewStub(): Json {
  const overview = fixture<Dict>('organization-overview');
  const end = Date.parse(NOW);
  const activity = (overview.activity as { from: string; to: string }[]).map((bucket, index, all) => ({
    ...bucket,
    from: new Date(end - (all.length - index) * HOUR).toISOString(),
    to: new Date(end - (all.length - index - 1) * HOUR).toISOString(),
  }));
  return { ...overview, generatedAt: NOW, windowStart: new Date(end - 24 * HOUR).toISOString(), activity };
}

export const paths = {
  installation: '/settings',
  capacity: '/settings',
  upgrade: '/settings?view=upgrade',
  organization: `/organizations/${ids.organization}/settings`,
  workspace: `/organizations/${ids.organization}/workspaces/${ids.workspace}/settings`,
} as const;

/** Upgrade status for the three states the Upgrade view can show. */
export function upgradeStatus(state: 'open' | 'fenced' | 'draining'): Json {
  const base = fixture<Dict>('upgrade-status');
  const release = { name: '2.4.0', metadataSchema: 42 };
  if (state === 'fenced') return { ...base, generatedAt: NOW, release, phase: 'fenced' };
  const unfinished =
    state === 'draining'
      ? { runs: 1, exports: 1, uploads: 1, removals: 0 }
      : { runs: 0, exports: 0, uploads: 0, removals: 0 };
  return { ...base, generatedAt: NOW, release, phase: 'open', operationId: null, unfinished };
}
