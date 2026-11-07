import { encodeJson } from '@beetle/contracts';
import type { RuntimePlan } from './prepare.js';
import { failure } from './types.js';
import type { CreateSpec, DockerMount, InspectEvidence, Result } from './types.js';

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
export function containerId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => same(value, right[index]));
  }
  const a = record(left);
  const b = record(right);
  if (!a || !b) return false;
  return Object.keys(a).length === Object.keys(b).length
    && Object.entries(b).every(([key, value]) => Object.hasOwn(a, key) && same(a[key], value));
}
function exactFields(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => same(actual[key], value));
}
function empty(value: unknown): boolean {
  return value === null || Array.isArray(value) && value.length === 0;
}
function optionalEmptyObject(value: unknown): boolean {
  return value === undefined || value === null || record(value) !== undefined && Object.keys(value as object).length === 0;
}
const hostDefaults: Record<string, unknown> = {
  ContainerIDFile: '', VolumeDriver: '', ConsoleSize: [0, 0], Cgroup: '', OomScoreAdj: 0, Isolation: '',
  CgroupParent: '', BlkioWeight: 0, CpuShares: 0, CpuPeriod: 0, CpuQuota: 0, CpuRealtimePeriod: 0, CpuRealtimeRuntime: 0,
  CpusetCpus: '', CpusetMems: '', KernelMemory: 0, KernelMemoryTCP: 0, MemoryReservation: 0,
  MemorySwappiness: null, CpuCount: 0, CpuPercent: 0, IOMaximumIOps: 0, IOMaximumBandwidth: 0,
};
const emptyHostArrays = ['Ulimits', 'BlkioWeightDevice', 'BlkioDeviceReadBps', 'BlkioDeviceWriteBps',
  'BlkioDeviceReadIOps', 'BlkioDeviceWriteIOps'];
function additionalHostDefaults(host: Record<string, unknown>, spec: CreateSpec): boolean {
  return Object.entries(host).every(([key, value]) => {
    if (Object.hasOwn(spec.HostConfig, key)) return true;
    if (Object.hasOwn(hostDefaults, key)) return same(value, hostDefaults[key]);
    if (emptyHostArrays.includes(key)) return empty(value);
    return key === 'Annotations' && optionalEmptyObject(value);
  });
}
function controls(host: Record<string, unknown>, spec: CreateSpec): boolean {
  const arrays = ['CapAdd', 'Devices', 'DeviceRequests', 'Binds', 'VolumesFrom', 'GroupAdd', 'DeviceCgroupRules',
    'Links', 'ExtraHosts', 'Dns', 'DnsOptions', 'DnsSearch'];
  const objects = ['PortBindings', 'Sysctls', 'StorageOpt'];
  const excluded = ['Mounts', ...arrays, ...objects];
  const fixed = Object.fromEntries(Object.entries(spec.HostConfig).filter(([key]) => !excluded.includes(key)));
  if (!exactFields(host, fixed)) return false;
  if (!arrays.every(key => empty(host[key]))) return false;
  return objects.every(key => optionalEmptyObject(host[key])) && additionalHostDefaults(host, spec);
}
function bindOptions(input: unknown, expected: DockerMount): boolean {
  const options = record(input);
  if (!options) return false;
  return Object.entries(expected.BindOptions).every(([key, value]) =>
    options[key] === value || value === false && options[key] === undefined)
    && Object.keys(options).every(key => Object.hasOwn(expected.BindOptions, key));
}
function requestedMount(input: unknown, expected: DockerMount): boolean {
  const mount = record(input);
  if (!mount || !bindOptions(mount.BindOptions, expected)) return false;
  const actual = { ...mount, ReadOnly: mount.ReadOnly === undefined ? false : mount.ReadOnly };
  const optional = ['Consistency', 'VolumeOptions', 'TmpfsOptions', 'ClusterOptions'];
  if (mount.Consistency !== undefined && mount.Consistency !== '') return false;
  if (!optional.slice(1).every(key => mount[key] === undefined || mount[key] === null)) return false;
  const allowed = ['Type', 'Source', 'Target', 'ReadOnly', 'BindOptions', ...optional];
  return exactFields(actual, { Type: expected.Type, Source: expected.Source, Target: expected.Target, ReadOnly: expected.ReadOnly })
    && Object.keys(mount).every(key => allowed.includes(key));
}
function requestedMounts(input: unknown, spec: CreateSpec): boolean {
  if (!Array.isArray(input) || input.length !== spec.HostConfig.Mounts.length) return false;
  return spec.HostConfig.Mounts.every(expected => {
    const matches = input.filter(item => record(item)?.Target === expected.Target);
    return matches.length === 1 && requestedMount(matches[0], expected);
  });
}
function summaryOptions(mount: Record<string, unknown>, expected: DockerMount): boolean {
  if (mount.BindOptions !== undefined && !bindOptions(mount.BindOptions, expected)) return false;
  const allowed = ['Type', 'Name', 'Source', 'Destination', 'Driver', 'Mode', 'RW', 'Propagation', 'BindOptions'];
  const mode = mount.Mode;
  return Object.keys(mount).every(key => allowed.includes(key))
    && (mode === undefined || mode === '' || mode === (expected.ReadOnly ? 'ro' : 'rw'))
    && ['Name', 'Driver'].every(key => mount[key] === undefined || mount[key] === '');
}
function mountEvidence(value: unknown, spec: CreateSpec): boolean {
  if (!Array.isArray(value) || value.length !== spec.HostConfig.Mounts.length) return false;
  return spec.HostConfig.Mounts.every(expected => {
    const matches = value.filter(item => record(item)?.Destination === expected.Target);
    if (matches.length !== 1) return false;
    const mount = record(matches[0]);
    return mount?.Type === 'bind' && mount.Source === expected.Source
      && mount.RW === !expected.ReadOnly && mount.Propagation === 'rprivate' && summaryOptions(mount, expected);
  });
}
function disabledHealthcheck(input: unknown): boolean {
  const healthcheck = record(input);
  if (!healthcheck || !same(healthcheck.Test, ['NONE'])) return false;
  const zeroDefaults = ['Interval', 'Timeout', 'StartPeriod', 'StartInterval', 'Retries'];
  return Object.entries(healthcheck).every(([key, value]) => key === 'Test' || zeroDefaults.includes(key) && value === 0);
}
function configuration(config: Record<string, unknown>, plan: RuntimePlan): boolean {
  const expected = plan.spec;
  const labels = record(config.Labels);
  if (!labels || !exactFields(labels, { ...expected.Labels })) return false;
  const actual = { ...config, NetworkDisabled: config.NetworkDisabled === undefined ? false : config.NetworkDisabled };
  if (!same(config.Env, expected.Env) && !(expected.Env.length === 0 && config.Env === null)) return false;
  return disabledHealthcheck(config.Healthcheck) && exactFields(actual, { Image: expected.Image, User: expected.User,
    Entrypoint: expected.Entrypoint, Cmd: expected.Cmd, WorkingDir: expected.WorkingDir,
    NetworkDisabled: expected.NetworkDisabled, StopSignal: expected.StopSignal });
}
function projectState(state: Record<string, unknown>, id: string): Result<InspectEvidence> {
  if (typeof state.Status !== 'string' || typeof state.Running !== 'boolean'
    || typeof state.OOMKilled !== 'boolean' || !Number.isInteger(state.ExitCode)) return failure('malformed');
  const known = ['created', 'running', 'exited', 'restarting'].includes(state.Status);
  if (!consistentState(state)) return failure('malformed');
  return { ok: true, value: { id, state: known ? state.Status as InspectEvidence['state'] : 'unknown',
    exitCode: state.Status === 'exited' ? state.ExitCode as number : null, oomKilled: state.OOMKilled } };
}
function consistentState(state: Record<string, unknown>): boolean {
  if (!['Paused', 'Restarting', 'Dead'].every(key => typeof state[key] === 'boolean')) return false;
  return state.Running === ['running', 'restarting'].includes(state.Status as string)
    && state.Restarting === (state.Status === 'restarting')
    && state.Paused === (state.Status === 'paused') && state.Dead === (state.Status === 'dead');
}
function owned(data: Record<string, unknown>, plan: RuntimePlan): boolean {
  const config = record(data.Config);
  const host = record(data.HostConfig);
  return !!config && !!host && data.Name === `/${plan.name}` && data.Image === plan.spec.Image
    && configuration(config, plan) && controls(host, plan.spec)
    && requestedMounts(host.Mounts, plan.spec) && mountEvidence(data.Mounts, plan.spec) && networks(data.NetworkSettings, plan.spec);
}
function networks(input: unknown, spec: CreateSpec): boolean {
  const settings = record(input);
  if (spec.NetworkDisabled && settings?.Networks === null) return true;
  const attached = record(settings?.Networks);
  if (!attached) return false;
  const names = Object.keys(attached);
  if (spec.NetworkDisabled) return names.length === 0 || names.length === 1 && names[0] === 'none';
  return names.length === 1 && names[0] === spec.HostConfig.NetworkMode;
}

/** Rejects malformed or foreign identity before exposing a fixed, secret-free projection. */
export function inspectEvidence(input: unknown, plan: RuntimePlan): Result<InspectEvidence> {
  try {
    const data = record(JSON.parse(encodeJson(input, 1_048_576)) as unknown);
    if (!data || !containerId(data.Id)) return failure('malformed');
    const state = record(data.State);
    if (!state) return failure('malformed');
    if (!owned(data, plan)) return failure('conflict');
    return projectState(state, data.Id);
  } catch { return failure('malformed'); }
}

function apiVersion(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^1\.[0-9]{1,3}$/u.test(value)) return undefined;
  return Number(value.slice(2));
}
export function compatibleVersion(input: unknown): boolean {
  const data = record(input);
  if (!data) return false;
  const minimum = apiVersion(data.MinAPIVersion);
  const maximum = apiVersion(data.ApiVersion);
  return minimum !== undefined && maximum !== undefined && minimum <= 47 && maximum >= 47 && minimum <= maximum;
}
export function supportedDaemon(input: unknown): boolean {
  const data = record(input);
  if (!data) return false;
  return ['MemoryLimit', 'SwapLimit', 'CpuCfsPeriod', 'CpuCfsQuota', 'PidsLimit'].every(key => data[key] === true)
    && data.OSType === 'linux' && recursiveReadOnlyKernel(data.KernelVersion);
}
function recursiveReadOnlyKernel(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const version = /^(\d{1,2})\.(\d{1,3})(?:[.-]|$)/u.exec(value);
  if (!version) return false;
  const major = Number(version[1]);
  return major > 5 || major === 5 && Number(version[2]) >= 12;
}
