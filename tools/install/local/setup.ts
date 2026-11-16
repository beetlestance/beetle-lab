import { join, dirname } from 'node:path';
import { validatePrimitive } from '@beetle/contracts';
import { configNames } from '../src/configuration.js';
import { lstat, realpath } from 'node:fs/promises';
import { canonical, digest, fields } from '../src/capture.js';
import { ProvisionError } from '../types.js';
import type { LocalOptions } from './config.js';
import { deployment } from './config.js';
import { absent, LocalFiles } from './files.js';
import type { Operation } from './files.js';

function recovery(condition: unknown): asserts condition { if (!condition) throw new ProvisionError('recovery_required'); }
function receiptDigests(raw: string, request: string): Record<string, unknown> {
  const receipt: unknown = JSON.parse(raw);
  fields(receipt, ['version', 'operationId', 'installationId', 'requestDigest', 'phase', 'authority', 'configDigests']);
  recovery(receipt.version === 1 && receipt.phase === 'ready' && receipt.requestDigest === digest(canonical(JSON.parse(request))));
  for (const id of [receipt.operationId, receipt.installationId, receipt.authority]) recovery(validatePrimitive('uuid', id).ok);
  fields(receipt.configDigests, configNames);
  for (const hash of Object.values(receipt.configDigests)) recovery(typeof hash === 'string' && /^[a-f0-9]{64}$/u.test(hash));
  return receipt.configDigests;
}
async function installation(files: LocalFiles, root: string, request: string): Promise<'fresh' | 'ready'> {
  const names = await files.names(root, 4);
  if (names.length === 0) return 'fresh';
  recovery(names.length === 4 && ['installation.json', 'config', 'backend', 'agent'].every(name => names.includes(name)));
  const hashes = receiptDigests(await files.read(join(root, 'installation.json')), request);
  for (const name of ['config', 'backend', 'agent']) await files.directory(join(root, name), false);
  const config = join(root, 'config'); const actual = await files.names(config, configNames.length);
  recovery(actual.length === configNames.length && configNames.every(name => actual.includes(name)));
  for (const name of configNames) recovery(digest(await files.read(join(config, name))) === hashes[name]);
  return 'ready';
}
async function prepareDirectory(files: LocalFiles, directory: string): Promise<void> {
  recovery(await realpath(dirname(directory)) === dirname(directory));
  let create = false;
  try { await lstat(directory); } catch (cause) { if (!absent(cause)) throw cause; create = true; }
  await files.directory(directory, create);
}
async function configure(files: LocalFiles, options: LocalOptions): Promise<'created' | 'unchanged'> {
  const directory = options.directory; const names = await files.names(directory, 2);
  const expected = deployment(options); const setup = join(directory, 'setup'); const data = join(directory, 'data');
  if (names.length === 0) {
    await files.directory(setup, true); await files.directory(data, true);
    for (const [name, value] of expected) await files.write(join(setup, name), value);
    return 'created';
  }
  recovery(names.length === 2 && names.includes('setup') && names.includes('data'));
  await files.directory(setup, false); await files.directory(data, false);
  const actual = await files.names(setup, 3); recovery(actual.length === 3 && [...expected.keys()].every(name => actual.includes(name)));
  for (const [name, value] of expected) {
    if (await files.read(join(setup, name)) !== value) throw new ProvisionError('conflict');
  }
  return 'unchanged';
}
/** Finite config IO; failures preserve all exclusive creations for explicit recovery. */
export async function prepareLocalDeployment(options: LocalOptions, operation: Operation): Promise<string> {
  const files = new LocalFiles(options, operation);
  try {
    await prepareDirectory(files, options.directory); const status = await configure(files, options);
    const state = await installation(files, join(options.directory, 'data'), deployment(options).get('request.json')!);
    return `local_${status}_${state}`;
  } finally { await files.close(); }
}
