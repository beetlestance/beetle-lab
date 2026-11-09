import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveInstalledIdentity, validate } from '@beetle/contracts';
import type { EngineManifest, Offer, StagedAttempt } from '@beetle/contracts';
import type { SuiteConfig } from '../../compiler/suite/index.js';
import { openStagedInput } from '../../wrapper/input/index.js';
import type { OpenStagedOptions, StagedInput } from '../../wrapper/input/index.js';

export const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export const uuid = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export const now = 1_800_000_000_000;
/** Content binding for synthetic wrapper tests; never an approved agent profile. */
export function syntheticInstalledIdentity(manifest: EngineManifest): Offer['installedIdentity'] {
  return deriveInstalledIdentity({ manifest, profile: { synthetic: true, backend: 'fixture-only' },
    identity: { manifestId: 'wrapper-fixture', profileId: 'synthetic-wrapper-profile',
      catalogVersion: 1, schemaDigest: 'f'.repeat(64) } }, hash);
}
export function suite(reference: Offer['inputs'][number]): SuiteConfig {
  return { version: 1, target: 'https://example.invalid/api',
    loadPlan: { version: 1, scenarios: [{ id: 'main', name: 'main', executor: 'per-vu-iterations',
      startTime: '0s', gracefulStop: '0s', vus: 1, iterations: 1, maxDuration: '1s' }], slos: [] },
    datasets: [{ id: 'users', kind: 'json', selection: 'byVu', input: { ...reference } }],
    secrets: [{ name: '_TOKEN', provider: 'mounted', locator: 'token-ref', version: 'v1' }],
    requests: [{ id: 'get', name: 'get', method: 'GET', path: '/{{data.users.name}}',
      query: {}, headers: { Authorization: '{{secret._TOKEN}}' }, assertions: [] }],
    selections: [{ scenarioId: 'main', entries: [{ requestId: 'get', weight: 1, wait: { durationMs: 0, jitterMs: 0 } }] }],
  };
}
export interface Fixture {
  root: string; options: OpenStagedOptions; controller: AbortController;
  offer: Offer; manifest: EngineManifest; staging: StagedAttempt;
  save(hashes?: boolean): Promise<void>; cleanup(): Promise<void>;
}
export async function fixture(): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'w09-staged-input-')));
  const inputRoot = join(root, 'input'); const secretRoot = join(root, 'secrets');
  await mkdir(inputRoot); await mkdir(secretRoot);
  const content = '[{"name":"one"}]';
  const reference = { id: uuid(5), sha256: hash(content), bytes: Buffer.byteLength(content) };
  const budget = { cpuMillis: 1000, memoryBytes: 536_870_912, pids: 128, timeoutMs: 60_000, outputBytes: 1_048_576 };
  const manifest: EngineManifest = { protocolVersion: '1.0', engineId: 'k6', engineVersion: 'fixture-1', imageDigest: 'sha256:' + 'b'.repeat(64),
    protocolRange: { minimum: '1.0', maximum: '1.0' }, schemas: { config: 'https://beetle.test/contracts/engines/k6/v1/suite',
      result: 'https://beetle-lab.dev/contracts/runner/v1/engine-result' }, capabilities: ['http'],
    supportedControls: ['cpu', 'memory', 'pids', 'timeout', 'output'], defaultBudget: { ...budget }, minimumBudget: { ...budget, timeoutMs: 1 },
    backends: ['docker'], network: { required: true, profile: 'target-egress' },
    phases: ['validate', 'prepare', 'execute', 'collect', 'seal'].map(phase => ({ phase: phase as EngineManifest['phases'][number]['phase'],
      timeoutMs: 1000, workUnits: 1, outputBytes: 1024 })), entrypoint: { executable: 'wrapper', arguments: [] } };
  const offer: Offer = { protocolVersion: '1.0', organizationId: uuid(1), workspaceId: uuid(2), attemptId: uuid(3),
    intentDigest: 'a'.repeat(64), engine: { id: 'k6', imageDigest: manifest.imageDigest, configVersion: 1 },
    installedIdentity: syntheticInstalledIdentity(manifest),
    inputs: [reference], budget, executionPolicy: { mode: 'parallel', preferIdle: true }, requiredCapabilities: ['http'],
    secretReferences: [{ name: '_TOKEN', provider: 'mounted', reference: 'token-ref', version: 'v1' }], config: suite(reference) };
  const staging: StagedAttempt = { protocolVersion: '1.0', organizationId: offer.organizationId, workspaceId: offer.workspaceId,
    attemptId: offer.attemptId, generation: 7, intentDigest: offer.intentDigest, specDigest: 'c'.repeat(64),
    offerSha256: '', manifestSha256: '', deadlineMs: now + 60_000, stagingPolicyVersion: 1,
    inputFiles: [{ inputId: reference.id, fileName: 'input-000.bin' }], secretNames: ['_TOKEN'] };
  const controller = new AbortController();
  const options: OpenStagedOptions = { inputRoot, secretRoot, uid: process.getuid!(), headerTimeoutMs: 5000,
    installed: { id: 'k6', version: manifest.engineVersion, configVersion: 1, configSchema: manifest.schemas.config as OpenStagedOptions['installed']['configSchema'],
      resultSchema: manifest.schemas.result }, signal: controller.signal, wallNow: () => now };
  const save = async (hashes = true): Promise<void> => {
    const rawOffer = JSON.stringify(offer); const rawManifest = JSON.stringify(manifest);
    if (hashes) { staging.offerSha256 = hash(rawOffer); staging.manifestSha256 = hash(rawManifest); }
    await writeFile(join(inputRoot, 'offer.json'), rawOffer);
    await writeFile(join(inputRoot, 'manifest.json'), rawManifest);
    await writeFile(join(inputRoot, 'staging.json'), JSON.stringify(staging));
  };
  await writeFile(join(inputRoot, 'input-000.bin'), content);
  await writeFile(join(secretRoot, '_TOKEN'), 'SECRET_SENTINEL_NEVER_READ');
  await save();
  for (const [name, value] of [['Offer', offer], ['EngineManifest', manifest], ['StagedAttempt', staging]] as const) {
    if (!validate(name, value).ok) throw new Error(`Invalid fixture ${name}`);
  }
  return { root, options, controller, offer, manifest, staging, save, cleanup: () => rm(root, { recursive: true, force: true }) };
}
export async function opened(options: OpenStagedOptions): Promise<StagedInput> {
  const operation = openStagedInput(options);
  const result = await operation.result; await operation.quiesced;
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
}
