import { join } from 'node:path';
import { validatePrimitive } from '@beetle/contracts';
import { generationDigest } from '@beetle/contracts/installation-generation';
import type { ConfigurationGeneration } from '@beetle/contracts/installation-generation';
import { readColdSettings, applyColdMemoryChange } from '../../../app/src/adapters/outbound/sqlite/cold-inspection/index.js';
import { RecoveryIO, RecoveryError, openColdSource, sourceLayout, nativeDatabase, checkDestination } from '../../recovery/offline.js';
import { capture, canonical, digest, check, requireInput } from '../src/capture.js';
import type { Captured } from '../src/capture.js';
import type { ProvisionRequest, ProvisionContext } from '../types.js';
import { ProvisionError } from '../types.js';
import { configNames, configurations, generationRequest } from '../src/configuration.js';
import { inspect } from '../src/inspection.js';
import { validateCommittedGeneration } from '../src/authority.js';
import { planMemoryChange } from './policy.js';
import { filesFor, readState, publishState } from './state.js';
import type { State, PendingMemoryChange } from './state.js';
import type { PrivateFiles } from '../src/files.js';
const stranded = new Set<object>();
let active = false;
async function verifyBaseline(c: Captured, files: PrivateFiles, state: State, operationId: string): Promise<void> {
  const names = await files.names(join(c.request.root, 'config'), [...configNames, 'configuration-state.json',
    `.installation-${operationId}-prepare`, `.installation-${operationId}-commit`]);
  requireInput(configNames.every(name => names.includes(name)));
  for (const name of configNames) {
    const bytes = await files.read(join(c.request.root, 'config', name), name === 'agent-token' ? 128 : 262144);
    requireInput(digest(new TextDecoder('utf-8', {fatal:true}).decode(bytes)) === state.receipt.configDigests[name]);
  }
}
async function effectiveRequest(c: Captured, files: PrivateFiles, state: State): Promise<ProvisionRequest> {
  if (!state.receipt.generation) return c.request;
  const decode = (value: Uint8Array) => new TextDecoder('utf-8', {fatal:true}).decode(value);
  return generationRequest(c, state.receipt, {
    agent:decode(await files.read(join(c.request.root,'config/agent.json'))),
    installation:decode(await files.read(join(c.request.root,'config/installation.json'))),
  });
}
async function planned(c: Captured, files: PrivateFiles, state: State, expected: PendingMemoryChange['expectedSettings'],
  change: Pick<MemoryChangeInput, 'memoryBytes' | 'operationId'>): Promise<PendingMemoryChange> {
  const {memoryBytes, operationId} = change;
  const old = await effectiveRequest(c, files, state);
  const plan = planMemoryChange(old, expected, memoryBytes, c.context);
  const target = capture(plan.request, c.context); const facts = await inspect(target);
  const values = configurations(target, state.receipt.installationId, facts);
  const intent = {version:1 as const, operationId, installationId:state.receipt.installationId,
    previousDigest:c.requestDigest, configurations:values as ConfigurationGeneration['configurations']};
  return {operationId, memoryBytes, expectedSettings:expected,
    generation:{...intent, digest:generationDigest(intent, digest)}};
}
export interface MemoryChangeInput {
  readonly request: ProvisionRequest;
  readonly memoryBytes: number;
  readonly operationId: string;
}
interface MemoryChangeResult {installationId: string; operationId: string; status: 'changed' | 'unchanged'}
interface Owners {
  readonly io: RecoveryIO;
  files?: PrivateFiles;
  source?: Awaited<ReturnType<typeof openColdSource>>;
  cleanupUnknown: boolean;
}
function completed(state: State, input: MemoryChangeInput): boolean {
  return !state.pending && state.receipt.generation?.operationId === input.operationId;
}
async function commitMemory(c: Captured, owners: Owners, state: State, input: MemoryChangeInput): Promise<void> {
  const files = owners.files!; const source = owners.source!; const io = owners.io;
  const custody = source.metadataCustody;
  const database = io.acquireSync(() => nativeDatabase.open(custody), db => db.close());
  try {
    checkDestination(custody);
    database.value.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA cache_size=-2048; PRAGMA mmap_size=0;');
    const expected = state.pending?.expectedSettings ?? readColdSettings(database.value, source.captured.installation);
    const pending = await planned(c, files, state, expected, input);
    if (state.pending) requireInput(canonical(state.pending) === canonical(pending));
    else {
      await publishState(c, state, pending, false);
      state = {receipt:state.receipt, pending, absent:false};
    }
    const effective = await effectiveRequest(c, files, state);
    applyColdMemoryChange(database.value, {expected, memoryBytes:input.memoryBytes, operationId:input.operationId,
      ceilings:{pool:effective.installationValues.pool, perRun:{...effective.installationValues.perRunCeilings, memoryBytes:input.memoryBytes},
        supportedProfiles:effective.installationValues.supportedProfiles}});
    check(c.context); await io.close(database);
    await publishState(c, state, pending, true);
  } finally { await io.close(database); }
}
async function perform(c: Captured, owners: Owners, input: MemoryChangeInput): Promise<MemoryChangeResult> {
  const files = owners.files = await filesFor(c);
  const state = await readState(c, files);
  await verifyBaseline(c, files, state, input.operationId); check(c.context);
  if (state.receipt.generation) await validateCommittedGeneration(c, state.receipt.installationId, state.receipt);
  if (completed(state, input)) {
    const current = await effectiveRequest(c, files, state);
    requireInput(current.installationValues.perRunCeilings.memoryBytes === input.memoryBytes);
    return {installationId:state.receipt.installationId, operationId:input.operationId, status:'unchanged'};
  }
  if (state.pending) requireInput(state.pending.operationId === input.operationId && state.pending.memoryBytes === input.memoryBytes);
  const source = owners.source = await openColdSource(owners.io, sourceLayout(c.request.root), {docker:c.context.docker,
    agentWorkerUrl:c.context.agentWorkerUrl, metadataWorkerUrl:c.context.backendWorkerUrl,
    baseline:true, receipt:state.receipt, expectedAgentConfigPath:join(c.request.root,'config/agent.json')});
  requireInput(source.captured.installationId === state.receipt.installationId && source.captured.journalAuthority === state.receipt.authority);
  await commitMemory(c, owners, state, input);
  return {installationId:state.receipt.installationId, operationId:input.operationId, status:'changed'};
}
async function drain(owners: Owners, failure: unknown): Promise<void> {
  const outcomes = await Promise.allSettled([owners.files?.close(), owners.io.closeAll()]);
  if (owners.cleanupUnknown || outcomes.some(outcome => outcome.status === 'rejected')) {
    stranded.add(owners); throw new ProvisionError('cleanup', {cause:failure});
  }
  try { owners.source?.agentLease.close(); owners.source?.backendLease.close(); }
  catch (cause) {stranded.add(owners); throw new ProvisionError('cleanup', {cause});}
  active = false;
}
/** Explicit offline operation. Caller stops services and holds its packaging gate, if present. */
export async function changeInstalledMemory(input: MemoryChangeInput, context: ProvisionContext): Promise<MemoryChangeResult> {
  if (active || stranded.size) throw new ProvisionError('conflict');
  requireInput(validatePrimitive('uuid', input.operationId).ok);
  const c = capture(input.request, context);
  const owners: Owners = {io:new RecoveryIO(c.context), cleanupUnknown:false}; active = true;
  let result: MemoryChangeResult | undefined; let failure: unknown; let failed = false;
  try { result = await perform(c, owners, input); }
  catch (error) {
    failure = error; failed = true;
    owners.cleanupUnknown = (error instanceof ProvisionError || error instanceof RecoveryError) && error.code === 'cleanup';
  }
  await drain(owners, failure);
  if (failed) throw failure;
  requireInput(result !== undefined); return result;
}
