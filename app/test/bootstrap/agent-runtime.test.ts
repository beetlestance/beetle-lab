import { expect, it } from 'vitest';
import { captureAgentRuntime, agentMetadata } from '../../src/bootstrap/agent-runtime.js';
import { settingsFixture } from '../domain/fixtures.js';
import { pin, credential } from './agent-config/fixture.js';
function fixture() {
  const settings = settingsFixture();
  const metadata = { path: '/synthetic/private/metadata.sqlite', workerUrl: new URL('file:///synthetic/worker.js'),
    installation: settings.chain.installation, runtime: { execution: { stagingBytes: 10485760, perRunStagingBytes: 2097152 }, ceilings: settings.runtime, observedAtMs: 100, expiresAtMs: 1100 } };
  const options = { dataRoot: '/synthetic/private', connection: { token: credential, configuration: {
    version: 1 as const, origin: 'http://127.0.0.1:1', tokenFile: '/synthetic/token', expectedInstallationId: metadata.installation.id,
    profiles: [pin()], storageAllocationBytes: 20000, freeSpaceReserveBytes: 2000 } } };
  return { metadata, options };
}
it('captures private values once and starts metadata unknown with the exact configured pins', () => {
  const { metadata, options } = fixture(); const captured = captureAgentRuntime(options, metadata);
  const configured = agentMetadata(metadata, captured);
  options.connection.token = 'replacement'; options.connection.configuration.profiles[0]!.installedIdentity.profileDigest = '3'.repeat(64);
  expect(captured.connection.token).toBe(credential);
  expect(configured.runtime).toBeNull(); expect(configured.runs?.profiles[0]!.installedIdentity.profileDigest).toBe('2'.repeat(64));
  expect(Object.isFrozen(captured.connection.configuration.profiles[0]!.installedIdentity)).toBe(true);
});
it('refuses inconsistent installation and filesystem ownership before startup effects', () => {
  const { metadata, options } = fixture();
  expect(() => captureAgentRuntime({ ...options, dataRoot: '/elsewhere' }, metadata)).toThrow();
  expect(() => captureAgentRuntime(options, metadata, '/elsewhere/inputs')).toThrow();
  const changed = structuredClone(options); changed.connection.configuration.expectedInstallationId = '00000000-0000-4000-8000-000000000099';
  expect(() => captureAgentRuntime(changed, metadata)).toThrow();
});
it('preserves existing programmatic metadata configuration when no agent was requested', () => {
  const { metadata } = fixture(); expect(agentMetadata(metadata, undefined)).toBe(metadata);
});
