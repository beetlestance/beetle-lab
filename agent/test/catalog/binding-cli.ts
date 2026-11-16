import { validateApi } from '@beetle/contracts/api';
import { encodeJson, RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import { createEngineCatalog, CatalogError } from '../../src/catalog/index.js';
import { registration } from './fixtures.js';

/** One-shot synthetic catalogue conformance fixture, with no runtime/providers. */
async function request(): Promise<Record<string, unknown>> {
  const maximum = RUNNER_MAXIMUM_OFFER_BYTES + 65536;
  const bytes = Buffer.alloc(maximum); let size = 0; let chunks = 0;
  for await (const chunk of process.stdin) {
    if (!Buffer.isBuffer(chunk) || ++chunks > 4096 || size + chunk.byteLength > maximum) throw new Error('request');
    chunk.copy(bytes, size); size += chunk.byteLength;
  }
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
  encodeJson(value, maximum);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request');
  return value as Record<string, unknown>;
}
async function main(): Promise<void> {
  const input = await request();
  if (!Object.keys(input).every(key => ['operation', 'budget', 'drift', 'offer'].includes(key))
    || (input.operation !== 'describe' && input.operation !== 'preflight') || typeof input.drift !== 'boolean') throw new Error('request');
  const budget = validateApi('Budget', input.budget);
  if (!budget.ok) throw new Error('request');
  const installed = registration();
  installed.manifest.minimumBudget = { ...budget.value }; installed.manifest.defaultBudget = { ...budget.value };
  if (input.drift) Object.assign(installed.profile, { tmpfsBytes: installed.profile.tmpfsBytes + 1 });
  const catalog = createEngineCatalog([installed]); const engine = catalog.engines[0]!;
  if (input.operation === 'describe') {
    process.stdout.write(encodeJson({ engine: { id: engine.manifest.engineId,
      imageDigest: engine.manifest.imageDigest, configVersion: engine.configVersion }, installedIdentity: engine.installedIdentity }, 65536));
    return;
  }
  try { catalog.preflight(input.offer); process.stdout.write('{"accepted":true}'); }
  catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    process.stdout.write(encodeJson({ accepted: false, reason: error.reason }, 65536));
  }
}
void main().catch(() => { process.stderr.write('Catalogue fixture failed\n'); process.exitCode = 1; });
