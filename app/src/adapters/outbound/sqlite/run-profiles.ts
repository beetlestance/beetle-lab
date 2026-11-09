import { encodeJson } from '@beetle/contracts';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { validateApi } from '@beetle/contracts/api';
import type { RunProfilePin, RunConfiguration } from '../../../ports/runs.js';
export type { RunProfilePin, RunConfiguration } from '../../../ports/runs.js';
import { immutableSnapshot, requireRule } from '../../../domain/namespaces/index.js';
import { sha256 } from './input-values.js';

export const runConfigSchema = createK6ConfigSchema(sha256);
/** Private installation pins; never supplied by a browser enqueue request. */
export function checkedRunConfiguration(input: RunConfiguration): RunConfiguration {
  const copy = JSON.parse(encodeJson(input, 32768)) as RunConfiguration;
  requireRule(Object.keys(copy).every(key => ['profiles', 'pendingLimit'].includes(key)));
  requireRule(Number.isInteger(copy.pendingLimit) && copy.pendingLimit >= 1 && copy.pendingLimit <= 4096);
  requireRule(Array.isArray(copy.profiles) && copy.profiles.length <= 32);
  const names = new Set<string>(); const selectors = new Set<string>();
  for (const profile of copy.profiles) {
    checkedProfile(profile);
    const selector = JSON.stringify([profile.engine.id, profile.engine.imageDigest, profile.engine.configVersion]);
    requireRule(!names.has(profile.engine.profileId) && !selectors.has(selector));
    names.add(profile.engine.profileId); selectors.add(selector);
  }
  return immutableSnapshot(copy);
}
function checkedProfile(pin: RunProfilePin): void {
  requireRule(Object.keys(pin).every(key => ['engine', 'manifestDigest', 'profileDigest', 'schemaDigest', 'requiredCapabilities'].includes(key)));
  requireRule(validateApi('RunEngine', pin.engine).ok);
  for (const digest of [pin.manifestDigest, pin.profileDigest, pin.schemaDigest]) requireRule(typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest));
  requireRule(pin.schemaDigest === runConfigSchema.schemaDigest);
  requireRule(Array.isArray(pin.requiredCapabilities) && pin.requiredCapabilities.length <= 64);
  requireRule(new Set(pin.requiredCapabilities).size === pin.requiredCapabilities.length);
  pin.requiredCapabilities.forEach(capability => requireRule(validateApi('EngineProfile', capability).ok));
}
