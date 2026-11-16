import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { captureGeneration, generationDigest, selectInstalledConfiguration } from '../src/installation-generation/index.js';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const installationId = '00000000-0000-4000-8000-000000000001';
const operationId = '00000000-0000-4000-8000-000000000002';
function fixture() {
  const baseline = JSON.stringify({ id: installationId, values: { memoryBytes: 512 } });
  const previousDigest = 'a'.repeat(64);
  const intent = { version: 1 as const, operationId, installationId, previousDigest,
    configurations: { 'installation.json': { id: installationId, values: { memoryBytes: 1024 } },
      'backend-agent.json': { version: 1, expectedInstallationId: installationId },
      'agent.json': { installation: { installationId }, memoryBytes: 1024 } } };
  const generation = { ...intent, digest: generationDigest(intent, digest) };
  const receipt = { version: 1, phase: 'ready', installationId, requestDigest: previousDigest,
    configDigests: { 'installation.json': digest(baseline) }, generation };
  return { baseline, generation, receipt };
}
it('selects the same committed generation for every configuration consumer and detaches it', () => {
  const f = fixture();
  expect(selectInstalledConfiguration(f.receipt, 'installation.json', f.baseline, digest)).toEqual({ id: installationId, values: { memoryBytes: 1024 } });
  const captured = captureGeneration(f.generation, installationId, f.receipt.requestDigest, digest);
  const nested = captured.configurations['installation.json'] as { values: { memoryBytes: number } };
  nested.values.memoryBytes = 99;
  expect(f.generation.configurations['installation.json']).toEqual({ id: installationId, values: { memoryBytes: 1024 } });
});
it('keeps the original ready receipt compatible without silently replacing its baseline', () => {
  const f = fixture(); const { generation: _generation, ...receipt } = f.receipt; void _generation;
  expect(selectInstalledConfiguration(receipt, 'installation.json', f.baseline, digest)).toEqual(JSON.parse(f.baseline));
  expect(() => selectInstalledConfiguration(receipt, 'installation.json', f.baseline + ' ', digest)).toThrow();
});
it.each(['initializing', 'reconfiguring', 'ready-other', null])('refuses unfinished or unknown receipt state %s', phase => {
  const f = fixture();
  expect(() => selectInstalledConfiguration({ ...f.receipt, phase }, 'installation.json', f.baseline, digest)).toThrow();
});
it.each(['installationId', 'operationId', 'previousDigest', 'digest', 'configurations'] as const)('rejects generation mutation of %s', key => {
  const f = fixture(); const changed = { ...f.generation, [key]: key === 'configurations' ? {} : 'tampered' };
  expect(() => captureGeneration(changed, installationId, f.receipt.requestDigest, digest)).toThrow();
});
it('rejects extra generation fields and oversized configurations', () => {
  const f = fixture();
  expect(() => captureGeneration({ ...f.generation, extra: true }, installationId, f.receipt.requestDigest, digest)).toThrow();
  const intent = { ...f.generation, configurations: { ...f.generation.configurations, 'agent.json': { padding: 'x'.repeat(131072) } } };
  expect(() => generationDigest(intent, digest)).toThrow();
});
