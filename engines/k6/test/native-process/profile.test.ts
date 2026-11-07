import { chmod, link, mkdir, rename, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createNativeProcess, ProcessBoundaryError } from '../../wrapper/process/index.js';
import { validateProfile, validateRuntimeHost } from '../../wrapper/process/profile.js';
import { ownedFiles } from './files.js';
import { harness, options } from './fixtures.js';

it('snapshots managed options and rejects non-managed/malformed trusted profiles', () => {
  for (const attempt of [{ mode: 'standalone', timeoutMs: 1 }, { mode: 'managed', timeoutMs: 0, deadlineMs: 2 }]) {
    expect(() => createNativeProcess(options({ attempt: attempt as ReturnType<typeof options>['attempt'] })))
      .toThrowError(ProcessBoundaryError);
  }
  expect(() => createNativeProcess(options({ script: '/outside/suite.js' }))).toThrowError('profile');
  expect(() => createNativeProcess(options({ binary: 'k6' }))).toThrowError('profile');
  expect(() => createNativeProcess(options({ binary: '/owned/../k6' }))).toThrowError('profile');
  expect(() => createNativeProcess(options({ maxDiagnosticBytes: 65_537 }))).toThrowError('profile');
  expect(() => createNativeProcess(options({ maxMetricStreamBytes: Infinity }))).toThrowError('profile');
});
it('limits production host profiles to Linux amd64/arm64', () => {
  expect(() => validateRuntimeHost('linux', 'x64')).not.toThrow();
  expect(() => validateRuntimeHost('linux', 'arm64')).not.toThrow();
  expect(() => validateRuntimeHost('darwin', 'arm64')).toThrowError('profile');
  expect(() => validateRuntimeHost('linux', 'ppc64')).toThrowError('profile');
});
it('validates an owned regular script and truly empty baked config before effects', async () => {
  const input = await ownedFiles(); await expect(validateProfile(input)).resolves.toBeUndefined();
  await writeFile(input.emptyConfig, '{"cloud":true}');
  await expect(validateProfile(input)).rejects.toThrowError('profile');
});
it('rejects preexisting summary paths including broken symlinks', async () => {
  const input = await ownedFiles(); await symlink('/missing', join(input.directory, 'beetle-evidence.json'));
  await expect(validateProfile(input)).rejects.toThrowError('profile');
});
it.each(['script', 'emptyConfig'] as const)('rejects %s symlinks', async key => {
  const input = await ownedFiles(); const original = input[key] + '.original'; await rename(input[key], original);
  await symlink(original, input[key]); await expect(validateProfile(input)).rejects.toThrowError('profile');
});
it('rejects hardlinked/oversized/nonregular scripts and writable output roots', async () => {
  const hardlink = await ownedFiles(); await link(hardlink.script, hardlink.script + '.other');
  await expect(validateProfile(hardlink)).rejects.toThrowError('profile');
  const oversized = await ownedFiles(); await truncate(oversized.script, 67_108_865);
  await expect(validateProfile(oversized)).rejects.toThrowError('profile');
  const nonregular = await ownedFiles(); await rename(nonregular.script, nonregular.script + '.old');
  await mkdir(nonregular.script); await expect(validateProfile(nonregular)).rejects.toThrowError('profile');
  const writable = await ownedFiles(); await chmod(writable.directory, 0o777);
  await expect(validateProfile(writable)).rejects.toThrowError('profile');
});
it('sanitizes profile failure and does not invoke a child', async () => {
  const h = harness({}, { validate: async () => { throw new Error('SECRET'); } });
  const result = await h.actor.run(); expect(result).toMatchObject({ cause: 'profile', state: 'not_started' });
  expect(JSON.stringify(result)).not.toContain('SECRET'); expect(h.spawn).not.toHaveBeenCalled(); await h.actor.close();
});
