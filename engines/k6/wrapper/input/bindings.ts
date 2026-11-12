import { createHash } from 'node:crypto';
import { encodeJson, installedDescriptorDigest, validate } from '@beetle/contracts';
import type { EngineManifest, Offer, ProtocolName, ProtocolTypes, StagedAttempt } from '@beetle/contracts';
import { InputError } from './types.js';
import type { OpenStagedOptions } from './types.js';

export const configSchema = 'https://beetle.test/contracts/engines/k6/v1/suite';
export const resultSchema = 'https://beetle-lab.dev/contracts/runner/v1/engine-result';
export function digest(bytes: string | Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export function text(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new InputError('utf8'); }
}
export function decode<N extends ProtocolName>(name: N, bytes: Uint8Array, maximum: number): ProtocolTypes[N] {
  try {
    const value: unknown = JSON.parse(text(bytes));
    // Also bound JSON depth/nodes before recursive schema consumers or freezing.
    encodeJson(value, maximum);
    const checked = validate(name, value);
    if (checked.ok) return checked.value;
  } catch (error) { if (error instanceof InputError) throw error; }
  throw new InputError('schema');
}
export function freeze<T>(value: T): T {
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) continue;
    pending.push(...Object.values(item)); Object.freeze(item);
  }
  return value;
}
function portableName(name: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u.test(name) && !name.endsWith('.')
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(name);
}
export function checkMapping(staging: StagedAttempt, offer: Offer): void {
  if (staging.inputFiles.length !== offer.inputs.length) throw new InputError('binding');
  const ids = new Set<string>();
  offer.inputs.forEach((input, index) => {
    const mapping = staging.inputFiles[index]!;
    if (ids.has(input.id.toLowerCase()) || mapping.inputId !== input.id
      || mapping.fileName !== `input-${String(index).padStart(3, '0')}.bin`) throw new InputError('binding');
    ids.add(input.id.toLowerCase());
  });
  const names = (offer.secretReferences ?? []).map(secret => secret.name);
  if (names.length !== staging.secretNames.length || names.some(name => !portableName(name))
    || new Set(names.map(name => name.toLowerCase())).size !== names.length
    || staging.secretNames.some(name => !names.includes(name))) throw new InputError('secret_binding');
}
export function checkBindings(input: { staging: StagedAttempt; offer: Offer; manifest: EngineManifest;
  offerBytes: Uint8Array; manifestBytes: Uint8Array; options: OpenStagedOptions }): void {
  const { staging, offer, manifest, options } = input;
  if (digest(input.offerBytes) !== staging.offerSha256 || digest(input.manifestBytes) !== staging.manifestSha256) throw new InputError('binding');
  const fields = ['organizationId', 'workspaceId', 'attemptId', 'intentDigest'] as const;
  if (fields.some(field => staging[field] !== offer[field])) throw new InputError('binding');
  for (const [field, expected] of Object.entries(options.expected ?? {})) {
    if (!Object.hasOwn(staging, field) || staging[field as keyof StagedAttempt] !== expected) throw new InputError('binding');
  }
  checkAssignmentBinding(staging,options);
  checkEngine(options, offer, manifest);
  checkMapping(staging, offer);
}
function checkEngine(options: OpenStagedOptions, offer: Offer, manifest: EngineManifest): void {
  const installed = options.installed;
  if (installed.id !== 'k6' || installed.configSchema !== configSchema || installed.resultSchema !== (options.exportAssignment ? 'https://beetle-lab.dev/contracts/runner/v1/export-result' : resultSchema)
    || manifest.engineId !== installed.id || offer.engine.id !== installed.id
    || manifest.engineVersion !== installed.version || offer.engine.configVersion !== installed.configVersion) throw new InputError('binding');
  checkManifest(offer, manifest,installed.resultSchema);
}
function checkManifest(offer: Offer, manifest: EngineManifest, expectedResult: string): void {
  let manifestDigest: string;
  try { manifestDigest = installedDescriptorDigest('manifest', manifest, digest); }
  catch { throw new InputError('binding'); }
  if (offer.installedIdentity.manifestDigest !== manifestDigest) throw new InputError('binding');
  if (manifest.schemas.config !== configSchema || manifest.schemas.result !== expectedResult
    || offer.engine.imageDigest !== manifest.imageDigest) throw new InputError('binding');
  if (offer.requiredCapabilities.some(capability => !manifest.capabilities.includes(capability))) throw new InputError('binding');
  const budgetFields = ['cpuMillis', 'memoryBytes', 'pids', 'timeoutMs', 'outputBytes'] as const;
  if (budgetFields.some(field => offer.budget[field] < manifest.minimumBudget[field])) throw new InputError('binding');
}

function checkAssignmentBinding(staging:StagedAttempt,options:OpenStagedOptions):void {
  const expected=options.exportAssignment;const binding=staging.assignment;
  if (!expected && !binding) return;
  if (!expected || !binding || expected.purpose !== binding.purpose || expected.assignmentDigest !== binding.assignmentDigest
    || staging.generation !== 1) throw new InputError('binding');
}
