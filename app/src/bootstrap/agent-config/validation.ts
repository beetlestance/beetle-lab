import {checkedExportConfiguration} from '../../adapters/outbound/execution-profiles/index.js';
import type {ExportProfilePin} from '../../ports/exports.js';
import { isAbsolute, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import { validate } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import type { AgentConnectionConfiguration } from '../../ports/runner.js';
import type { RunProfilePin } from '../../ports/runs.js';
import { AgentConfigurationError } from './error.js';

const schemaDigest = createK6ConfigSchema(text => createHash('sha256').update(text).digest('hex')).schemaDigest;

function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new AgentConfigurationError();
}
function object(input: unknown, fields: readonly string[]): Record<string, unknown> {
  requireValue(input !== null && typeof input === 'object' && !Array.isArray(input));
  const value = input as Record<string, unknown>;
  requireValue(Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)));
  return value;
}
export function absolutePath(input: unknown): string {
  requireValue(typeof input === 'string' && Buffer.byteLength(input) <= 4096 && !input.includes('\0'));
  requireValue(isAbsolute(input) && normalize(input) === input && input !== '/');
  return input;
}
function origin(input: unknown): string {
  requireValue(typeof input === 'string' && input.length <= 2048);
  requireValue([...input].every(character => character.charCodeAt(0) >= 0x20 && character.charCodeAt(0) !== 0x7f));
  requireValue(/^http:\/\/[^/\\?#\s]+\/?$/iu.test(input) && !input.includes('@'));
  const url = new URL(input);
  requireValue(url.protocol === 'http:' && url.username === '' && url.password === '');
  return url.origin;
}
function profile(input: unknown): RunProfilePin {
  const value = object(input, ['engine', 'installedIdentity', 'requiredCapabilities']);
  requireValue(validateApi('RunEngine', value.engine).ok && validate('InstalledIdentity', value.installedIdentity).ok);
  const capabilities = value.requiredCapabilities;
  requireValue(Array.isArray(capabilities) && capabilities.length <= 64);
  requireValue(new Set(capabilities).size === capabilities.length);
  requireValue(capabilities.every(capability => validateApi('EngineProfile', capability).ok));
  const pin = value as unknown as RunProfilePin;
  requireValue(pin.installedIdentity.schemaDigest === schemaDigest);
  Object.freeze(pin.engine); Object.freeze(pin.installedIdentity); Object.freeze(pin.requiredCapabilities);
  return Object.freeze(pin);
}
function identities(pin: RunProfilePin): string {
  const i = pin.installedIdentity;
  return JSON.stringify([i.manifestId, i.profileId, i.catalogVersion, i.manifestDigest, i.profileDigest, i.schemaDigest]);
}
function profiles(input: unknown): readonly RunProfilePin[] {
  requireValue(Array.isArray(input) && input.length >= 1 && input.length <= 32);
  const pins = input.map(profile);
  const aliases = new Set(pins.map(pin => pin.engine.profileId));
  const installed = new Set(pins.map(identities));
  const selectors = new Set(pins.map(pin => JSON.stringify([pin.engine.id, pin.engine.imageDigest, pin.engine.configVersion])));
  requireValue(aliases.size === pins.length && installed.size === pins.length && selectors.size === pins.length);
  return Object.freeze(pins);
}
export function configuration(input: unknown, installationId: string): AgentConnectionConfiguration {
  const extra = input !== null && typeof input === 'object' && Object.hasOwn(input, 'exportProfiles') ? ['exportProfiles'] : [];
  const value = object(input, ['version', 'origin', 'tokenFile', 'expectedInstallationId', 'profiles',
    'storageAllocationBytes', 'freeSpaceReserveBytes', ...extra]);
  requireValue(validateApi('Uuid', installationId).ok && value.expectedInstallationId === installationId);
  requireValue(value.version === 1);
  const {allocation,reserve}=storageLimits(value);
  const pins = profiles(value.profiles);
  const exports = extra.length ? checkedExportConfiguration({profiles: value.exportProfiles as readonly ExportProfilePin[], pendingLimit: 4096}, {profiles: pins, pendingLimit: 4096}).profiles : undefined;
  return Object.freeze({ version: 1, ...(exports === undefined ? {} : {exportProfiles: exports}), origin: origin(value.origin), tokenFile: absolutePath(value.tokenFile),
    expectedInstallationId: installationId, profiles: pins,
    storageAllocationBytes: allocation, freeSpaceReserveBytes: reserve });
}
export function token(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const value = text.endsWith('\n') ? text.slice(0, -1) : text;
  requireValue(/^[A-Za-z0-9_-]{43,128}$/.test(value));
  return value;
}

function storageLimits(value:Record<string,unknown>){
  const allocation = value.storageAllocationBytes;
  const reserve = value.freeSpaceReserveBytes;
  requireValue(Number.isSafeInteger(allocation) && typeof allocation === 'number' && allocation > 0);
  requireValue(Number.isSafeInteger(reserve) && typeof reserve === 'number' && reserve >= 0 && allocation > reserve);
  return {allocation,reserve};
}
