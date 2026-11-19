import { expect, it } from 'vitest';
import { chmod, lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { NamespaceBinding, verifyInstallation } from '../../src/staging/index.js';
import { TaskInventory } from '../../src/task-inventory/index.js';
import { NativeRemoval } from '../../src/native-removal/index.js';
import { NativeReceipt } from '../../src/native-receipt/index.js';
import { RetirementPipeline } from '../../src/retirement-pipeline/index.js';
import { producerBarrierFacts } from '../../src/producer-retirement/index.js';
import type { TaskDirectoryFacts, TaskReconciliation } from '../../src/staging-namespace/index.js';
import { payload } from '../backends/docker/fixtures.js';
import { renumberRoot } from '../staging/fixtures.js';
import { fixture } from './fixtures.js';
import { initialize, JOURNAL_SCHEMA_VERSION } from '../../src/journal/schema.js';
const f = fixture();
const operation = () => ({ deadline: performance.now() + 10000 });
type Env = Awaited<ReturnType<typeof f.inventory>>;
const tk = (e: Env) => ({ ...e.key, generation: 1 as const });
async function tree(path: string): Promise<string[]> {
  return (await readdir(path, { recursive: true })).map(String).sort();
}
async function observed(task: string): Promise<TaskDirectoryFacts> {
  const fact = async (path: string) => {
    const s = await lstat(path, { bigint: true });
    return { dev: String(s.dev), ino: String(s.ino), uid: String(s.uid), gid: String(s.gid), mode: String(s.mode) };
  };
  return { task: await fact(task), input: await fact(join(task, 'input')), output: await fact(join(task, 'output')), secrets: await fact(join(task, 'secrets')) };
}
/** A new start: verify the installation and bind the recorded namespace again, then compose cleanup on that root. */
async function restart(e: Env) {
  const verified = await verifyInstallation({ configuration: e.configuration, transport: e.transport, operation: operation() });
  if (!verified.ok) throw new Error(verified.reason);
  const binding = new NamespaceBinding({ root: verified.value, journal: e.owner.stagingNamespace, journalAuthority: await e.owner.journalAuthority(), operation: operation() });
  try { await binding.bind(); } finally { await binding.close(); }
  const inventory = new TaskInventory({ journal: e.owner, root: verified.value });
  const removal = new NativeRemoval({ journal: e.owner, root: verified.value });
  const receipt = new NativeReceipt({ journal: e.owner, root: verified.value, removal });
  const pipeline = new RetirementPipeline({ journal: e.owner, producer: e.coordinator, runtime: e.runtime, inventory, removal, receipt, maximumSteps: 16 });
  const effects: string[] = [];
  const ports = { inventory: e.ports, removal: { ...e.ports,
    unlink: async (path: string) => { effects.push(path); await unlink(path); },
    rmdir: async (path: string) => { effects.push(path); await rmdir(path); } } };
  const request = producerBarrierFacts(e.producer, e.owner.retirements).intent.request;
  return { pipeline, ports, effects, request, close: async () => { await pipeline.close(); await receipt.close(); await removal.close(); await inventory.close(); } };
}
async function settle<T>(work: { result: Promise<T>; settled: Promise<void> }): Promise<T> {
  try { return await work.result; } finally { await work.settled.catch(() => undefined); }
}

it('reconciles a renumbered task folder after proving the runtime absent, then cleans it against the new facts', async () => {
  const e = await f.inventory();
  const recordedTask = await e.owner.stagingNamespace.readTask(tk(e));
  if (recordedTask?.state !== 'prepared') throw new Error('Missing prepared task');
  await renumberRoot(e.rootPath);
  const s = await restart(e);
  try {
    await expect(settle(s.pipeline.tickWithPorts(s.request, operation(), s.ports))).rejects.toMatchObject({ reason: 'unavailable' });
    expect(await e.owner.cleanupPlans.read(e.key)).toBeNull();
    const live = await observed(e.task);
    const outcome = await settle(s.pipeline.reconcileWithPorts(s.request, operation(), s.ports));
    expect(outcome).toMatchObject({ state: 'reconciled', reconciliation: { directories: live, taskNamespaceIdentity: recordedTask.anchor.taskNamespaceIdentity } });
    expect(await e.owner.stagingNamespace.readTaskReconciliation(tk(e))).toEqual(outcome.state === 'reconciled' ? outcome.reconciliation : null);
    // The anchor and its identity are unchanged; only the facts cleanup checks against moved.
    expect(await e.owner.stagingNamespace.readTask(tk(e))).toEqual(recordedTask);
    expect(await settle(s.pipeline.reconcileWithPorts(s.request, operation(), s.ports))).toEqual({ state: 'current' });
    expect(s.effects).toEqual([]);
    expect(await settle(s.pipeline.tickWithPorts(s.request, operation(), s.ports))).toMatchObject({ state: 'cleaned' });
    const plan = await e.owner.cleanupPlans.read(e.key);
    expect(plan?.plan.entries.find((entry) => entry.path === 'output')?.native).toEqual(live.output);
    await expect(lstat(e.task)).rejects.toMatchObject({ code: 'ENOENT' });
    // A plan now exists, so no later reconciliation can be recorded for this attempt.
    await expect(e.owner.stagingNamespace.reconcileTask(tk(e), outcome.state === 'reconciled' ? outcome.reconciliation : (null as never))).rejects.toMatchObject({ code: 'conflict' });
  } finally { await s.close(); }
});

it('recovers A→B→A: replaces a recorded B with the anchor facts A and cleans against A, anchor unchanged', async () => {
  const e = await f.inventory();
  const recorded = await e.owner.stagingNamespace.readTask(tk(e));
  if (recorded?.state !== 'prepared') throw new Error('Missing prepared task');
  const s = await restart(e);
  try {
    const original = await observed(e.task);
    expect(original).toEqual(recorded.anchor.directories);
    // B: an earlier start observed the folders at other numbers and recorded them.
    const shifted = Object.fromEntries(Object.entries(original).map(([role, fact]) => [role, { ...fact, ino: String(BigInt(fact.ino) + 1_000_000n) }])) as unknown as TaskDirectoryFacts;
    const b: TaskReconciliation = { protocolVersion: 1, taskNamespaceIdentity: recorded.anchor.taskNamespaceIdentity, retirementRequestDigest: producerBarrierFacts(e.producer, e.owner.retirements).intent.requestDigest, directories: shifted };
    expect(await e.owner.stagingNamespace.reconcileTask(tk(e), b)).toEqual(b);
    // Cleanup now checks B, which no longer exists physically, and refuses.
    await expect(settle(s.pipeline.tickWithPorts(s.request, operation(), s.ports))).rejects.toMatchObject({ reason: 'unavailable' });
    expect(await e.owner.cleanupPlans.read(e.key)).toBeNull();
    // A: the folders are back at the anchor's numbers; reconciliation records A over B.
    const outcome = await settle(s.pipeline.reconcileWithPorts(s.request, operation(), s.ports));
    expect(outcome).toEqual({ state: 'reconciled', reconciliation: { ...b, directories: original } });
    expect(await e.owner.stagingNamespace.readTaskReconciliation(tk(e))).toEqual({ ...b, directories: original });
    expect(await e.owner.stagingNamespace.readTask(tk(e))).toEqual(recorded);
    expect(await settle(s.pipeline.reconcileWithPorts(s.request, operation(), s.ports))).toEqual({ state: 'current' });
    expect(s.effects).toEqual([]);
    expect(await settle(s.pipeline.tickWithPorts(s.request, operation(), s.ports))).toMatchObject({ state: 'cleaned' });
    expect((await e.owner.cleanupPlans.read(e.key))?.plan.entries.find((entry) => entry.path === 'output')?.native).toEqual(original.output);
    await expect(lstat(e.task)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await s.close(); }
});

it('records nothing when the folders still match the recorded facts', async () => {
  const e = await f.inventory();
  const s = await restart(e);
  try {
    expect(await settle(s.pipeline.reconcileWithPorts(s.request, operation(), s.ports))).toEqual({ state: 'current' });
    expect(await e.owner.stagingNamespace.readTaskReconciliation(tk(e))).toBeNull();
    expect(await settle(s.pipeline.tickWithPorts(s.request, operation(), s.ports))).toMatchObject({ state: 'cleaned' });
  } finally { await s.close(); }
});

it('refuses a renumbered folder whose mode no longer matches the recorded ownership', async () => {
  const e = await f.inventory();
  await renumberRoot(e.rootPath);
  await chmod(join(e.task, 'input'), 0o750);
  const before = await tree(e.task);
  const s = await restart(e);
  try {
    await expect(settle(s.pipeline.reconcileWithPorts(s.request, operation(), s.ports))).rejects.toMatchObject({ reason: 'unavailable' });
    expect(await e.owner.stagingNamespace.readTaskReconciliation(tk(e))).toBeNull();
    expect(await tree(e.task)).toEqual(before);
    expect(s.effects).toEqual([]);
  } finally { await s.close(); }
});

it('refuses while a container with the task runtime name exists again', async () => {
  const e = await f.inventory();
  await renumberRoot(e.rootPath);
  e.docker.state = payload(e.plan, 'running');
  const s = await restart(e);
  try {
    await expect(settle(s.pipeline.reconcileWithPorts(s.request, operation(), s.ports))).rejects.toBeTruthy();
    expect(await e.owner.stagingNamespace.readTaskReconciliation(tk(e))).toBeNull();
    expect(s.effects).toEqual([]);
  } finally { await s.close(); }
});

it('refuses once a cleanup plan was stored from facts observed before the root was renumbered', async () => {
  const e = await f.inventory();
  const work = e.inventory.prepareWithPorts(e.token, operation(), e.ports);
  const result = await work.result;
  await work.quiesced;
  await work.close();
  if (!result.ok) throw new Error(result.reason);
  await e.inventory.persist(result.observation, operation());
  const stored = await e.owner.cleanupPlans.read(e.key);
  expect(stored).not.toBeNull();
  await renumberRoot(e.rootPath);
  const before = await tree(e.task);
  const s = await restart(e);
  try {
    await expect(settle(s.pipeline.reconcileWithPorts(s.request, operation(), s.ports))).rejects.toMatchObject({ reason: 'conflict' });
    const recorded = await e.owner.stagingNamespace.readTask(tk(e));
    if (recorded?.state !== 'prepared') throw new Error('Missing prepared task');
    const direct = { protocolVersion: 1 as const, taskNamespaceIdentity: recorded.anchor.taskNamespaceIdentity, retirementRequestDigest: stored!.plan.retirementRequestDigest, directories: await observed(e.task) };
    await expect(e.owner.stagingNamespace.reconcileTask(tk(e), direct)).rejects.toMatchObject({ code: 'conflict' });
    expect(await e.owner.stagingNamespace.readTaskReconciliation(tk(e))).toBeNull();
    // The stored plan still names the old facts, so removal refuses rather than deleting new files.
    await expect(settle(s.pipeline.tickWithPorts(s.request, operation(), s.ports))).rejects.toBeTruthy();
    expect(s.effects).toEqual([]);
    expect(await tree(e.task)).toEqual(before);
  } finally { await s.close(); }
});

it('keeps the SQL guards: no cleared, altered or post-plan reconciliation reaches the row', async () => {
  const e = await f.inventory();
  await renumberRoot(e.rootPath);
  const s = await restart(e);
  let reconciled: TaskReconciliation;
  try {
    const outcome = await settle(s.pipeline.reconcileWithPorts(s.request, operation(), s.ports));
    if (outcome.state !== 'reconciled') throw new Error('Expected reconciliation');
    reconciled = outcome.reconciliation;
    expect(await settle(s.pipeline.tickWithPorts(s.request, operation(), s.ports))).toMatchObject({ state: 'cleaned' });
  } finally { await s.close(); }
  await e.inventory.close(); await e.runtime.close(); await e.coordinator.close(); await e.owner.close();
  const db = initialize(e.journalPath);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(JOURNAL_SCHEMA_VERSION);
    const update = (value: unknown) => () => db.prepare('UPDATE task_staging_namespaces SET reconciliation_json=? WHERE attempt_id=?').run(value === null ? null : JSON.stringify(value), e.key.attemptId);
    const moved = { ...reconciled, directories: { ...reconciled.directories, task: { ...reconciled.directories.task, ino: '1' } } };
    const loose = { ...reconciled, directories: { ...reconciled.directories, input: { ...reconciled.directories.input, mode: String(0o40750) } } };
    expect(update(null)).toThrow(/invalid task reconciliation/);
    expect(update(moved)).toThrow(/invalid task reconciliation/);
    expect(update(loose)).toThrow();
    expect(JSON.parse(String(db.prepare('SELECT reconciliation_json FROM task_staging_namespaces WHERE attempt_id=?').get(e.key.attemptId)?.reconciliation_json))).toEqual(reconciled);
  } finally { db.close(); }
});
