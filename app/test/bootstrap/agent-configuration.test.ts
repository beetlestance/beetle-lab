import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { loadAgentConfiguration } from '../../src/bootstrap/agent-configuration.js';
import { credential, fixture, installationId, pin } from './agent-config/fixture.js';

describe('private installation configuration capture', () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { await f.cleanup(); });

  it('captures deeply frozen pins and an optional single LF token without rediscovery', async () => {
    await writeFile(f.tokenPath, `${credential}\n`);
    const loaded = await loadAgentConfiguration(f.path, installationId);
    expect(loaded).toEqual({ configuration: f.value, token: credential });
    for (const object of [loaded, loaded.configuration, loaded.configuration.profiles,
      loaded.configuration.profiles[0], loaded.configuration.profiles[0]!.engine,
      loaded.configuration.profiles[0]!.installedIdentity, loaded.configuration.profiles[0]!.requiredCapabilities]) {
      expect(Object.isFrozen(object)).toBe(true);
    }
    await writeFile(f.tokenPath, 'changed'); await f.write({});
    expect(loaded.token).toBe(credential); expect(loaded.configuration).toEqual(f.value);
  });
  it('accepts 32 distinct original engine/installed pins', async () => {
    await f.write({ ...f.value, profiles: Array.from({ length: 32 }, (_, index) => pin(index)) });
    expect((await loadAgentConfiguration(f.path, installationId)).configuration.profiles).toHaveLength(32);
  });
  it.each(['http://AGENT:80', 'http://agent:80/', 'HTTP://Agent/'])('captures normalized HTTP origin %s', async origin => {
    await f.write({ ...f.value, origin });
    expect((await loadAgentConfiguration(f.path, installationId)).configuration.origin).toBe('http://agent');
  });
  it.each(['version', 'origin', 'tokenFile', 'expectedInstallationId', 'profiles',
    'storageAllocationBytes', 'freeSpaceReserveBytes'])('rejects a missing %s field', async field => {
    const value: Record<string, unknown> = { ...f.value }; delete value[field]; await f.write(value);
    await expect(loadAgentConfiguration(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
  });
  it.each([
    null, [], {}, { extra: 'private-detail' }, { version: 2 }, { version: '1' },
    { origin: 'https://agent' }, { origin: 'http://user:private@agent' }, { origin: 'http://agent/private' },
    { origin: 'http://agent/?private' }, { origin: 'http://agent/#private' }, { origin: 'http://agent?' },
    { origin: 'http://@agent' }, { origin: 'http://agent/a/..' }, { origin: 'http://agent/%2e' },
    { origin: 'http://agent\\' }, { origin: 'http://age\tnt' }, { origin: 'http://agent\u0000' },
    { origin: ' http://agent' }, { origin: 'http://agent\n' }, { origin: `http://${'a'.repeat(2050)}` },
    { tokenFile: './private' }, { tokenFile: '/private/../token' }, { tokenFile: '/private//token' },
    { tokenFile: `/private/${'x'.repeat(4096)}` }, { tokenFile: '/private/\0token' },
    { expectedInstallationId: '00000000-0000-4000-8000-000000000002' },
    { storageAllocationBytes: 0 }, { storageAllocationBytes: 1.5 }, { storageAllocationBytes: Number.MAX_SAFE_INTEGER + 1 },
    { freeSpaceReserveBytes: -1 }, { freeSpaceReserveBytes: 1.5 }, { freeSpaceReserveBytes: 1000 },
    { freeSpaceReserveBytes: Number.MAX_SAFE_INTEGER + 1 }, { storageAllocationBytes: '1000' },
    { profiles: [] }, { profiles: Array.from({ length: 33 }, (_, index) => pin(index)) },
    { profiles: [null] }, { profiles: [{ ...pin(), extra: 'private' }] },
    { profiles: [{ ...pin(), engine: { ...pin().engine, extra: true } }] },
    { profiles: [{ ...pin(), engine: { ...pin().engine, imageDigest: 'unpinned' } }] },
    { profiles: [{ ...pin(), engine: { ...pin().engine, configVersion: 2 } }] },
    { profiles: [{ ...pin(), installedIdentity: { ...pin().installedIdentity, extra: true } }] },
    { profiles: [{ ...pin(), installedIdentity: { ...pin().installedIdentity, catalogVersion: 0 } }] },
    { profiles: [{ ...pin(), installedIdentity: { ...pin().installedIdentity, schemaDigest: '0'.repeat(64) } }] },
    { profiles: [{ ...pin(), requiredCapabilities: ['http', 'http'] }] },
    { profiles: [{ ...pin(), requiredCapabilities: ['path/private'] }] },
    { profiles: [{ ...pin(), requiredCapabilities: Array.from({ length: 65 }, (_, i) => `cap-${i}`) }] },
    { profiles: [pin(), { ...pin(1), engine: { ...pin(1).engine, profileId: pin().engine.profileId } }] },
    { profiles: [pin(), { ...pin(1), engine: { ...pin().engine, profileId: 'another' } }] },
    { profiles: [pin(), { ...pin(1), installedIdentity: pin().installedIdentity }] },
  ])('rejects invalid closed fields and profile bindings %#', async input => {
    await f.write(input && !Array.isArray(input) ? { ...f.value, ...input } : input);
    // An empty patch represents a closed object with every field absent.
    if (input && Object.keys(input).length === 0) await f.write(input);
    await expect(loadAgentConfiguration(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
  });
  it('validates the supplied installation UUID', async () => {
    await f.write({ ...f.value, expectedInstallationId: 'private-invalid-id' });
    await expect(loadAgentConfiguration(f.path, 'private-invalid-id')).rejects.toThrow('Agent configuration rejected');
  });
  it.each(['x'.repeat(42), 'x'.repeat(129), `${credential}\n\n`, `${credential}\r\n`, `${credential} `,
    `${credential.slice(0, -1)}.`, `\n${credential}`, `\ufeff${credential}`, ''])('rejects invalid bearer bytes %#', async value => {
    await writeFile(f.tokenPath, value);
    await expect(loadAgentConfiguration(f.path, installationId)).rejects.toThrow('Agent configuration rejected');
  });
  it.each([43, 128])('accepts bearer payload boundary %i', async size => {
    await writeFile(f.tokenPath, `${'_'.repeat(size)}\n`);
    expect((await loadAgentConfiguration(f.path, installationId)).token).toBe('_'.repeat(size));
  });
});
