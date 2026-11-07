import { encodeJson } from '@beetle/contracts';
import type { RuntimePlan } from './prepare.js';
import { failure } from './types.js';
import type { CreateSpec, InspectEvidence, Result } from './types.js';

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
function controls(host: Record<string, unknown>, spec: CreateSpec): boolean {
  const arrays = ['CapAdd', 'Devices', 'DeviceRequests', 'Binds', 'VolumesFrom', 'GroupAdd', 'DeviceCgroupRules',
    'Links', 'ExtraHosts', 'Dns', 'DnsOptions', 'DnsSearch'];
  const objects = ['PortBindings', 'Sysctls', 'StorageOpt'];
  const excluded = ['Mounts', ...arrays, ...objects];
  const fixed = Object.fromEntries(Object.entries(spec.HostConfig).filter(([key]) => !excluded.includes(key)));
  if (!exactFields(host, fixed)) return false;
  if (!arrays.every(key => empty(host[key]))) return false;
  return objects.every(key => host[key] === null || record(host[key]) !== undefined && Object.keys(host[key] as object).length === 0);
}
function mountEvidence(value: unknown, spec: CreateSpec): boolean {
  if (!Array.isArray(value) || value.length !== spec.HostConfig.Mounts.length) return false;
  return spec.HostConfig.Mounts.every(expected => {
    const matches = value.filter(item => record(item)?.Destination === expected.Target);
    if (matches.length !== 1) return false;
    const mount = record(matches[0]);
    return mount?.Type === 'bind' && mount.Source === expected.Source
      && mount.RW === !expected.ReadOnly && mount.Propagation === 'rprivate';
  });
}
function configuration(config: Record<string, unknown>, plan: RuntimePlan): boolean {
  const expected = plan.spec;
  const labels = record(config.Labels);
  if (!labels || !exactFields(labels, { ...expected.Labels })) return false;
  return exactFields(config, { Image: expected.Image, User: expected.User,
    Entrypoint: expected.Entrypoint, Cmd: expected.Cmd, WorkingDir: expected.WorkingDir,
    NetworkDisabled: expected.NetworkDisabled });
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
    && mountEvidence(data.Mounts, plan.spec) && networks(data.NetworkSettings, plan.spec);
}
function networks(input: unknown, spec: CreateSpec): boolean {
  const settings = record(input);
  const attached = record(settings?.Networks);
  if (!attached) return false;
  const names = Object.keys(attached);
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
    && data.OSType === 'linux';
}
