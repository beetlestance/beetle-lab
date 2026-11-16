import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { parseLocalOptions } from '../local/config.js';
import { runLocalSetupCli } from '../local-cli.js';
const roots: string[] = [];
const args = (directory = '/synthetic/local'): string[] => ['--directory', directory, '--uid', String(process.getuid!()),
  '--gid', String(process.getgid!()), '--docker-gid', '0', '--docker-socket', '/synthetic/docker.sock', '--port', '8080', '--revision', 'abc123'];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(path => fs.rm(path, { recursive: true, force: true }))); });
it('accepts reordered exact pairs, deterministic default instance and explicit instance', () => {
  const first = parseLocalOptions(args()); expect(first.instance).toMatch(/^[a-f0-9]{16}$/);
  const input = args(); const reordered = [...input.slice(2), ...input.slice(0, 2)];
  expect(parseLocalOptions(reordered)).toEqual(first);
  expect(parseLocalOptions([...input, '--instance', 'synthetic-two']).instance).toBe('synthetic-two');
});
it.each([
  ['--port', '0'], ['--port', '65536'], ['--port', '08'], ['--uid', '0'], ['--gid', '0'], ['--docker-gid', '-1'],
  ['--revision', 'bad/tag'], ['--revision', 'latest\n'], ['--directory', '/synthetic/../local'],
  ['--directory', '/synthetic/$secret'], ['--directory', '/synthetic/a,b'], ['--directory', '/synthetic/a:b'],
  ['--directory', '/synthetic/a\nb'], ['--directory', '/synthetic/a\tb'], ['--docker-socket', 'relative'],
])('rejects invalid field %s %s', (key, value) => {
  const input = args(); input[input.indexOf(key) + 1] = value;
  expect(() => parseLocalOptions(input)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
});
it('rejects duplicate, unknown, missing, extra and foreign-owner arguments', () => {
  const duplicate = args(); duplicate[0] = '--port';
  const unknown = args(); unknown[0] = '--unknown';
  const owner = args(); owner[owner.indexOf('--uid') + 1] = String(process.getuid!() + 1);
  for (const input of [duplicate, unknown, owner, args().slice(0, -1), [...args(), '--extra', '1']]) {
    expect(() => parseLocalOptions(input)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  }
});
it('prints only fixed success/failure output and removes signal listeners', async () => {
  const parent = await fs.realpath(await fs.mkdtemp('/tmp/beetle-w330-cli-')); roots.push(parent); await fs.chmod(parent, 0o700); await fs.chown(parent, process.getuid!(), process.getgid!());
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true); const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const listeners = process.listenerCount('SIGTERM');
  expect(await runLocalSetupCli(args(join(parent, 'private')))).toBe(0);
  expect(stdout).toHaveBeenCalledWith('local_created_fresh\n');
  expect(await runLocalSetupCli(args(join(parent, 'private')))).toBe(0);
  expect(stdout).toHaveBeenCalledWith('local_unchanged_fresh\n');
  expect(await runLocalSetupCli(['CANARY_SECRET'])).toBe(2); expect(stderr).toHaveBeenCalledWith('invalid_input\n');
  await fs.chmod(join(parent, 'private'), 0o755);
  expect(await runLocalSetupCli(args(join(parent, 'private')))).toBe(1); expect(stderr).toHaveBeenCalledWith('unsafe_root\n');
  expect(process.listenerCount('SIGTERM')).toBe(listeners);
});
