import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import { performance } from 'node:perf_hooks';
import { encodeCanonicalJson, validate } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { ProvisionContext, ProvisionRequest } from '../types.js';
import { ProvisionError } from '../types.js';

export function requireInput(condition: unknown): asserts condition {
  if (!condition) throw new ProvisionError('invalid_input');
}
export function fields(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  requireInput(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireInput(Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)));
}
export function path(value: unknown, maximum = 1024): asserts value is string {
  requireInput(typeof value === 'string' && value.length > 1 && value.length <= maximum);
  requireInput(isAbsolute(value) && normalize(value) === value && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127));
}
function origin(value: unknown, privateOnly: boolean): void {
  requireInput(typeof value === 'string' && value.length <= 2048);
  const url = new URL(value);
  requireInput(url.origin === value && (url.protocol === 'http:' || !privateOnly && url.protocol === 'https:'));
}
function requestValues(r: ProvisionRequest): void {
  fields(r, ['root', 'uid', 'gid', 'externalOrigin', 'agentOrigin', 'dockerSocket', 'agentContainer', 'agentImage',
    'engineImage', 'targetNetwork', 'installationValues', 'agentPolicy', 'engine']);
  path(r.root, 400); path(r.dockerSocket);
  ownership(r);
  origin(r.externalOrigin, false); origin(r.agentOrigin, true);
  for (const name of [r.agentContainer, r.targetNetwork]) requireInput(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(name));
  for (const image of [r.agentImage, r.engineImage]) requireInput(typeof image === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/u.test(image));
  requireInput(validateApi('InstallationValues', r.installationValues).ok);
}
function ownership(r: ProvisionRequest): void {
  requireInput(Number.isInteger(r.uid) && r.uid > 0 && r.uid <= 999999999 && r.uid === process.getuid?.());
  requireInput(Number.isInteger(r.gid) && r.gid > 0 && r.gid <= 999999999 && r.gid === process.getgid?.());

}
function engineValues(r: ProvisionRequest): void {
  const e = r.engine;
  fields(e, ['manifest', 'manifestId', 'profileId', 'catalogVersion', 'configVersion', 'tmpfsBytes']);
  requireInput(validate('EngineManifest', e.manifest).ok && e.manifest.engineId === 'k6');
  for (const id of [e.manifestId, e.profileId]) requireInput(typeof id === 'string' && /^[A-Za-z0-9_.-]{1,128}$/u.test(id));
  requireInput(Number.isSafeInteger(e.catalogVersion) && e.catalogVersion > 0 && e.configVersion === 1);
  requireInput(Number.isSafeInteger(e.tmpfsBytes) && e.tmpfsBytes > 0);
  const supported = r.installationValues.supportedProfiles;
  requireInput(supported.length === 1 && supported[0] === e.profileId && r.installationValues.runDefaults.engineProfile === e.profileId);
}
export const canonical = (value: unknown): string => encodeCanonicalJson(value, 262_144);
export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
export interface Captured { request: ProvisionRequest; context: ProvisionContext; requestDigest: string }
export function capture(request: ProvisionRequest, context: ProvisionContext): Captured {
  try {
    const json = canonical(request); const r = JSON.parse(json) as ProvisionRequest;
    requestValues(r); engineValues(r);
    const signal = context.signal; const deadline = context.deadline;
    requireInput(signal instanceof AbortSignal && Number.isFinite(deadline) && deadline <= performance.now() + 30_000);
    const agentWorkerUrl = new URL(context.agentWorkerUrl.href); const backendWorkerUrl = new URL(context.backendWorkerUrl.href);
    requireInput(agentWorkerUrl.protocol === 'file:' && backendWorkerUrl.protocol === 'file:');
    const transport = context.docker; const docker = { request: transport.request.bind(transport) };
    return { request: r, requestDigest: digest(json), context: { docker, signal, deadline, agentWorkerUrl, backendWorkerUrl } };
  } catch (cause) { throw new ProvisionError('invalid_input', { cause }); }
}
export function check(context: Pick<ProvisionContext, 'signal' | 'deadline'>): void {
  if (context.signal.aborted) throw new ProvisionError('cancelled');
  if (performance.now() >= context.deadline) throw new ProvisionError('deadline');
}
