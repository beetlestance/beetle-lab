import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runClient } from '../../../src/client/cli/main.js';

function streams() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, ports: { stdout: { write: async (value: string) => void stdout.push(value) }, stderr: { write: async (value: string) => void stderr.push(value) } } };
}
const noFetch = async () => {
  throw new Error('validate must not contact Beetle');
};

it('checks a request file offline against the command schema', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beetle-validate-'));
  const valid = join(dir, 'cancel.json');
  await writeFile(valid, await readFile('contracts/fixtures/api/valid/cancel-run.json'));
  const ok = streams();
  expect(await runClient(['validate', '--kind', 'cancel', '--request-file', valid], ok.ports, noFetch)).toBe(0);
  expect(JSON.parse(ok.stdout.join(''))).toEqual({ valid: true, kind: 'cancel', schema: 'CancelRunRequest' });
  const invalid = join(dir, 'extra.json');
  await writeFile(invalid, await readFile('contracts/fixtures/api/invalid/cancel-run-extra.json'));
  const refused = streams();
  expect(await runClient(['validate', '--kind', 'cancel', '--request-file', invalid, '--json'], refused.ports, noFetch)).toBe(2);
  expect(refused.stdout).toEqual([]);
  expect(JSON.parse(refused.stderr.join(''))).toEqual({ error: 'invalid_input' });
});

it.each([
  [['validate', '--kind', 'delete', '--request-file', '/x.json']],
  [['validate', '--kind', 'run', '--request-file', 'relative.json']],
  [['validate', '--kind', 'run']],
  [['validate', '--kind', 'run', '--kind', 'run']],
  [['validate', '--kind', 'run', '--request-file', '/missing/request.json']],
])('refuses malformed validate arguments: %j', async (argv) => {
  const output = streams();
  expect(await runClient(argv, output.ports, noFetch)).toBe(2);
});
