import { configurationNames } from '@beetle/contracts/installation-generation';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ProvisionContext, ProvisionRequest, ProvisionResult } from './types.js';
import { ProvisionError } from './types.js';
import { capture, check, digest, canonical } from './src/capture.js';
import type { Captured } from './src/capture.js';
import { PrivateFiles } from './src/files.js';
import { inspect } from './src/inspection.js';
import { configurations, configNames, directories, paths, configurationStatePath, generationRequest } from './src/configuration.js';
import { authority, validateCommittedGeneration } from './src/authority.js';
import { jsonBytes, readReceipt, verifyConfigs } from './src/receipt.js';
import type { Receipt } from './src/receipt.js';
export { ProvisionError } from './types.js';
export type { ProvisionRequest, ProvisionContext, ProvisionResult, ProvisionErrorCode } from './types.js';

const owners = new Map<string, PrivateFiles>();
async function layout(c: Captured, files: PrivateFiles, create: boolean): Promise<void> {
  for (const name of directories) await files.directory(join(c.request.root, name), create);
}
async function journalFiles(c: Captured, files: PrivateFiles, fresh: boolean): Promise<void> {
  const journal = join(paths(c.request.root).agentJournal, 'journal.sqlite');
  if (fresh) await files.write(journal, new Uint8Array());
  else {
    await files.metadata(journal); await files.metadata(journal + '.authority.sqlite');
    for (const suffix of ['-wal', '-shm', '.authority.sqlite-journal']) await files.metadata(journal + suffix, true);
  }
}
async function create(c: Captured, files: PrivateFiles): Promise<ProvisionResult> {
  const installationId = randomUUID(); const operationId = randomUUID();
  const receipt: Receipt = { version: 1, operationId, installationId, requestDigest: c.requestDigest,
    phase: 'initializing', authority: null, configDigests: {} };
  await files.write(paths(c.request.root).receipt, jsonBytes(receipt));
  const facts = await inspect(c);
  let values: Record<string, unknown>;
  try { values = configurations(c, installationId, facts); }
  catch (cause) { throw new ProvisionError('invalid_input', { cause }); }
  await layout(c, files, true);
  for (const name of configNames) {
    const bytes = name === 'agent-token' ? Buffer.from(randomBytes(48).toString('base64url')) : jsonBytes(values[name]);
    receipt.configDigests[name] = digest(Buffer.from(bytes).toString('utf8'));
    await files.write(join(c.request.root, 'config', name), bytes);
  }
  await journalFiles(c, files, true);
  receipt.authority = await authority(c, files, installationId);
  await journalFiles(c, files, false);
  check(c.context); receipt.phase = 'ready';
  await files.write(configurationStatePath(c.request.root), jsonBytes(receipt));
  await files.ready(receipt, operationId);
  return Object.freeze({ installationId, status: 'created', paths: paths(c.request.root) });
}
async function verifiedConfiguration(c:Captured,files:PrivateFiles):Promise<Receipt>{
  await layout(c, files, false);
  const receipt = await readReceipt(c, files);
  await verifyConfigs(c, files, receipt);
  const facts = await inspect(c);
  let expected: Record<string, unknown>;
  try {
    const decode = (value: Uint8Array) => new TextDecoder('utf-8',{fatal:true}).decode(value);
    const active = receipt.generation ? capture(generationRequest(c,receipt,{
      agent:decode(await files.read(paths(c.request.root).agent)),
      installation:decode(await files.read(paths(c.request.root).installation)),
    }),c.context) : c;
    expected = configurations(active, receipt.installationId, facts);
  }
  catch (cause) { throw new ProvisionError('recovery_required', { cause }); }
  for (const name of configurationNames) {
    const matches = receipt.generation
      ? canonical(expected[name]) === canonical(receipt.generation.configurations[name])
      : digest(Buffer.from(jsonBytes(expected[name])).toString('utf8')) === receipt.configDigests[name];
    if (!matches) throw new ProvisionError('recovery_required');
  }
  await journalFiles(c, files, false);
  if (receipt.generation) await validateCommittedGeneration(c, receipt.installationId);
  return receipt;
}
async function replay(c:Captured,files:PrivateFiles):Promise<ProvisionResult>{
  const receipt=await verifiedConfiguration(c,files);
  await authority(c, files, receipt.installationId, receipt.authority!);
  await files.sync(c.request.root); check(c.context);
  return Object.freeze({ installationId: receipt.installationId, status: 'unchanged', paths: paths(c.request.root) });
}
/** Explicit offline installation. Never called by serving startup as missing-state recovery. */
function translate(cause: unknown, c: Captured, existing: boolean): never {
  if (cause instanceof ProvisionError && cause.code === 'cleanup') throw cause;
  check(c.context);
  if (cause instanceof ProvisionError) throw cause;
  throw new ProvisionError(existing ? 'recovery_required' : 'io', { cause });
}
export async function provisionFreshInstallation(request: ProvisionRequest, context: ProvisionContext): Promise<ProvisionResult> {
  const c = capture(request, context); check(c.context);
  if (owners.size !== 0) throw new ProvisionError('conflict');
  const files = new PrivateFiles(c); owners.set(c.request.root, files);
  let existing = false; let cleanupFailed = false;
  try {
    await files.root();
    const names = await files.names(c.request.root, ['installation.json', 'config', 'agent', 'backend']);
    existing = names.length > 0;
    if (existing && !names.includes('installation.json')) throw new ProvisionError('recovery_required');
    return existing ? await replay(c, files) : await create(c, files);
  } catch (cause) {
    cleanupFailed = cause instanceof ProvisionError && cause.code === 'cleanup';
    return translate(cause, c, existing);
  } finally {
    await files.close();
    if (files.clean && !cleanupFailed) owners.delete(c.request.root);
  }
}

/** Read-only configuration custody only; never opens Journal or grants authority. */
export async function inspectReadyConfiguration(request:ProvisionRequest,context:ProvisionContext):Promise<{readonly installationId:string;readonly readiness:'configuration_only';readonly paths:ProvisionResult['paths']}>{
 const c=capture(request,context);check(c.context);if(owners.size!==0)throw new ProvisionError('conflict');
 const files=new PrivateFiles(c);owners.set(c.request.root,files);let cleanupFailed=false;
 try{
  await files.pin(c.request.root);const receipt=await verifiedConfiguration(c,files);check(c.context);
  return Object.freeze({installationId:receipt.installationId,readiness:'configuration_only',paths:paths(c.request.root)});
 }catch(cause){cleanupFailed=cause instanceof ProvisionError&&cause.code==='cleanup';return translate(cause,c,true);}
 finally{await files.close();if(files.clean&&!cleanupFailed)owners.delete(c.request.root);}
}
