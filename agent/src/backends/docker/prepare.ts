import { createHash } from 'node:crypto';
import { isAbsolute, join, normalize } from 'node:path';
import { RUNNER_MAXIMUM_OFFER_BYTES, encodeJson, validate, validatePrimitive } from '@beetle/contracts';
import type { EngineManifest, Offer } from '@beetle/contracts';
import { failure } from './types.js';
import { validImageBaseline } from './image-baseline.js';
import type { CreateSpec, DockerMount, InstallationProfile, PrepareInput, Result, StagedRoots } from './types.js';

const budgetKeys = ['cpuMillis', 'memoryBytes', 'pids', 'timeoutMs', 'outputBytes'] as const;
const hash = (input: unknown): string => createHash('sha256').update(encodeJson(input, 65_536)).digest('hex');
export const normalizeIdentity = (value: string): string => value.toLowerCase();

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function validRoot(value: string): boolean {
  return typeof value === 'string' && value.length <= 512 && isAbsolute(value)
    && value !== '/' && normalize(value) === value && !value.split('/').includes('..')
    && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && !/(?:^|\/)(?:docker\.sock|containerd\.sock|proc|sys|dev|run|var\/run)(?:\/|$)/u.test(value);
}
function validProfile(profile: InstallationProfile): boolean {
  if (!validatePrimitive('uuid', profile.installationId).ok || !validRoot(profile.stagingRoot)) return false;
  if (!/^[1-9][0-9]{0,8}:[1-9][0-9]{0,8}$/u.test(profile.user)) return false;
  if (!Number.isSafeInteger(profile.tmpfsBytes) || profile.tmpfsBytes < 4096 || profile.tmpfsBytes > 67_108_864) return false;
  return validImageBaseline(profile)
    && budgetKeys.every(key => Number.isSafeInteger(profile.maximumBudget[key]) && profile.maximumBudget[key] > 0);
}
function approved(offer: Offer, manifest: EngineManifest, profile: InstallationProfile): boolean {
  if (offer.engine.id !== manifest.engineId || offer.engine.imageDigest !== manifest.imageDigest) return false;
  if (manifest.imageDigest !== profile.imageDigest || !manifest.backends.includes('docker')) return false;
  if (!approvedEntryPoint(manifest, profile)) return false;
  if (offer.requiredCapabilities.some(capability => !manifest.capabilities.includes(capability))) return false;
  if (!['cpu', 'memory', 'pids'].every(control => manifest.supportedControls.includes(control as 'cpu'))) return false;
  if (!approvedNetwork(manifest, profile)) return false;
  return budgetKeys.every(key => offer.budget[key] >= manifest.minimumBudget[key]
    && offer.budget[key] <= profile.maximumBudget[key]);
}
function approvedEntryPoint(manifest: EngineManifest, profile: InstallationProfile): boolean {
  return manifest.entrypoint.executable === profile.entrypoint.executable
    && hash(manifest.entrypoint.arguments) === hash(profile.entrypoint.arguments);
}
function approvedNetwork(manifest: EngineManifest, profile: InstallationProfile): boolean {
  return profile.network.profile === manifest.network.profile
    && !(manifest.network.required && profile.network.profile === 'none');
}
function validGeneration(value: number): boolean { return Number.isSafeInteger(value) && value >= 1; }
function networkName(profile: InstallationProfile): string | undefined {
  if (profile.network.profile === 'none') return profile.network.name === 'none' ? 'none' : undefined;
  if (profile.network.profile !== 'target-egress') return undefined;
  return /^beetle-[a-z0-9][a-z0-9_-]{0,63}$/u.test(profile.network.name) ? profile.network.name : undefined;
}
function mounts(roots: StagedRoots, profile: InstallationProfile, name: string): DockerMount[] | undefined {
  const taskRoot = join(profile.stagingRoot, name);
  const result: DockerMount[] = [];
  for (const key of ['input', 'output', 'secrets'] as const) {
    const source = roots[key];
    if (key === 'secrets' && source === undefined) continue;
    if (source !== join(taskRoot, key) || !validRoot(source)) return undefined;
    result.push({ Type: 'bind', Source: source, Target: `/beetle/${key}`,
      ReadOnly: key !== 'output', BindOptions: { Propagation: 'rprivate', NonRecursive: false,
        CreateMountpoint: false, ReadOnlyNonRecursive: false, ReadOnlyForceRecursive: key !== 'output' } });
  }
  return result;
}

export function runtimeName(input: { installationId: string; organizationId: string;
  workspaceId: string; attemptId: string; generation: number }): string {
  const identity = [input.installationId, input.organizationId, input.workspaceId, input.attemptId]
    .map(normalizeIdentity);
  return `beetle-${hash([...identity, input.generation])}`;
}

/** Immutable private handle. Config and secret values are deliberately absent from the Docker specification. */
const planToken = Symbol('runtime-plan');
const plans = new WeakSet<object>();
export function isRuntimePlan(value: unknown): value is RuntimePlan {
  return value !== null && typeof value === 'object' && plans.has(value);
}
export class RuntimePlan {
  private constructor(readonly name: string, readonly specDigest: string, readonly spec: CreateSpec, token: symbol) {
    if (token !== planToken) throw new Error('invalid_runtime_plan');
    plans.add(this);
    freeze(this);
  }
  static prepare(input: PrepareInput): Result<RuntimePlan> {
    try {
      const snapshot = prepareSnapshot(input);
      if (!snapshot.ok) return snapshot;
      return { ok: true, value: RuntimePlan.#create(snapshot.value.name, snapshot.value.spec) };
    }
    catch { return failure('invalid_input'); }
  }
  static #create(name: string, spec: CreateSpec): RuntimePlan {
    const digest = hash(spec);
    const labelled = { ...spec, Labels: { ...spec.Labels, 'dev.beetle.spec': digest } };
    return new RuntimePlan(name, digest, labelled, planToken);
  }
}

function prepareSnapshot(input: PrepareInput): Result<{ name: string; spec: CreateSpec }> {
  const raw: unknown = JSON.parse(encodeJson(input.offer, RUNNER_MAXIMUM_OFFER_BYTES));
  const rawManifest: unknown = JSON.parse(encodeJson(input.manifest, 65_536));
  const profile = JSON.parse(encodeJson(input.profile, 65_536)) as InstallationProfile;
  const staged = JSON.parse(encodeJson(input.staged, 4096)) as StagedRoots;
  const offer = validate('Offer', raw);
  const manifest = validate('EngineManifest', rawManifest);
  if (!offer.ok || !manifest.ok) return failure('invalid_input');
  if (!validProfile(profile)) return failure('invalid_input');
  if (!validGeneration(input.generation)) return failure('invalid_input');
  if (input.requireHardOutputQuota) return failure('unsupported');
  if (!approved(offer.value, manifest.value, profile)) return failure('unsupported');
  const nanoCpus = offer.value.budget.cpuMillis * 1_000_000;
  if (!Number.isSafeInteger(nanoCpus)) return failure('unsupported');
  const name = runtimeName({ installationId: profile.installationId, ...offer.value, generation: input.generation });
  const boundMounts = mounts(staged, profile, name);
  const network = networkName(profile);
  if (!boundMounts || !network) return failure('invalid_input');
  return { ok: true, value: { name,
    spec: createSpec({ offer: offer.value, profile, generation: input.generation, boundMounts, nanoCpus, network }) } };
}

function createSpec(input: { offer: Offer; profile: InstallationProfile; generation: number;
  boundMounts: DockerMount[]; nanoCpus: number; network: string }): CreateSpec {
  const { offer, profile } = input;
  return {
    Image: profile.imageDigest, User: profile.user,
    Entrypoint: [profile.entrypoint.executable], Cmd: [...profile.entrypoint.arguments],
    Env: [...profile.effectiveImage.environment], Healthcheck: { Test: ['NONE'] }, StopSignal: 'SIGTERM',
    WorkingDir: '/beetle/input', NetworkDisabled: input.network === 'none',
    Labels: { 'dev.beetle.installation': normalizeIdentity(profile.installationId),
      'dev.beetle.organization': normalizeIdentity(offer.organizationId),
      'dev.beetle.workspace': normalizeIdentity(offer.workspaceId),
      'dev.beetle.attempt': normalizeIdentity(offer.attemptId),
      'dev.beetle.generation': String(input.generation), 'dev.beetle.intent': offer.intentDigest },
    HostConfig: { NanoCpus: input.nanoCpus, Memory: offer.budget.memoryBytes, MemorySwap: offer.budget.memoryBytes,
      PidsLimit: offer.budget.pids, ReadonlyRootfs: true, Privileged: false, CapDrop: ['ALL'], CapAdd: [],
      Runtime: profile.effectiveImage.defaultRuntime, OomKillDisable: false, Init: false,
      ShmSize: profile.tmpfsBytes,
      SecurityOpt: ['no-new-privileges:true'], NetworkMode: input.network,
      PidMode: '', IpcMode: 'private', UTSMode: '', CgroupnsMode: 'private',
      UsernsMode: '', GroupAdd: [], DeviceCgroupRules: [], Links: [], ExtraHosts: [], Dns: [], DnsOptions: [], DnsSearch: [],
      Sysctls: {}, StorageOpt: {},
      ReadonlyPaths: ['/proc/bus', '/proc/fs', '/proc/irq', '/proc/sys', '/proc/sysrq-trigger'],
      MaskedPaths: ['/proc/acpi', '/proc/asound', '/proc/interrupts', '/proc/kcore', '/proc/keys', '/proc/latency_stats',
        '/proc/timer_list', '/proc/timer_stats', '/proc/sched_debug', '/proc/scsi', '/sys/firmware', '/sys/devices/virtual/powercap'],
      PublishAllPorts: false, PortBindings: {}, Devices: [], DeviceRequests: [], Binds: [], VolumesFrom: [],
      RestartPolicy: { Name: 'no', MaximumRetryCount: 0 }, AutoRemove: false, Mounts: input.boundMounts,
      Tmpfs: { '/tmp': `rw,noexec,nosuid,nodev,size=${profile.tmpfsBytes},mode=1777` },
      LogConfig: { Type: 'none', Config: {} } },
  };
}

export const prepareRuntime = RuntimePlan.prepare;
