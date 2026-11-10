import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openAgentRuntime } from '../../src/bootstrap/agent-runtime.js';
import type { OutputRuntimeOptions } from '../../src/ports/output-runtime.js';
import type { RunnerOutputAbsenceGateway } from '../../src/ports/output-absence.js';
import { storageFixture, settingsFixture } from '../storage/fixture.js';
import { pin, credential } from '../bootstrap/agent-config/fixture.js';
import { deferred, flush, outputOwnerFixture } from './fixture.js';
import { keyFor } from '../delivery/fixture.js';

const mocks = vi.hoisted(() => ({ gateway: vi.fn(), source: vi.fn(), outputs: vi.fn(), delivery: vi.fn() }));
vi.mock('../../src/adapters/outbound/runner/index.js', () => ({ createRunnerGateway: mocks.gateway, startDeliveryRuntime: mocks.delivery }));
vi.mock('../../src/adapters/outbound/capacity/index.js', () => ({ openCapacitySource: mocks.source }));
vi.mock('../../src/bootstrap/output-runtime/index.js', () => ({ openOutputRuntime: mocks.outputs }));
const fixture = storageFixture();
beforeEach(() => { for (const mock of Object.values(mocks)) mock.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

function configuration() {
  return { dataRoot: fixture.root(), connection: { token: credential, configuration: {
    version: 1 as const, origin: 'http://127.0.0.1:1', tokenFile: '/synthetic/token',
    expectedInstallationId: settingsFixture().chain.installation.id, profiles: [pin()],
    storageAllocationBytes: 20000, freeSpaceReserveBytes: 2000,
  } } };
}
async function setup() {
  const metadata = await fixture.open(); const f = outputOwnerFixture(mocks.delivery);
  const gateway: RunnerOutputAbsenceGateway = { ...f.gateway, output: vi.fn(() => { throw new Error('Synthetic output client'); }) };
  mocks.gateway.mockReturnValue(gateway); mocks.source.mockResolvedValue(f.source);
  mocks.outputs.mockResolvedValue(f.output);
  return { f, metadata, gateway, options: configuration() };
}
it('always provisions the actual output factory with installation metadata and a bound output-only shared gateway', async () => {
  const { f, metadata, gateway, options } = await setup();
  const held = deferred<typeof f.output>(); mocks.outputs.mockReturnValueOnce(held.promise);
  const runtimeOpening = openAgentRuntime(options, metadata); await flush();
  expect(mocks.outputs).toHaveBeenCalledOnce(); expect(f.source.sample).not.toHaveBeenCalled();
  expect(mocks.delivery).not.toHaveBeenCalled();
  const captured = mocks.outputs.mock.calls[0]![0] as OutputRuntimeOptions;
  expect(captured).toMatchObject({ dataRoot: options.dataRoot, freeSpaceReserveBytes: 2000 });
  expect(Object.keys(captured.outputs).sort()).toEqual(Object.keys(metadata.outputs).sort());
  expect(Object.keys(captured.finalizations)).toEqual(['finalize']); expect(Object.keys(captured.runs)).toEqual(['getRun']);
  expect(Object.isFrozen(captured.outputs)).toBe(true); expect(Object.keys(captured.gateway)).toEqual(['output', 'attempt']);
  const identity = { journalAuthority: '33333333-3333-4333-8333-333333333333', organizationId: 'org',
    workspaceId: 'workspace', attemptId: 'attempt', generation: 1, intentDigest: 'a'.repeat(64) };
  expect(() => captured.gateway.output(identity)).toThrow('Synthetic output client');
  expect(gateway.output).toHaveBeenCalledWith(identity); expect(vi.mocked(gateway.output).mock.contexts[0]).toBe(gateway);
  held.resolve(f.output); const runtime = await runtimeOpening;
  try {
    expect(mocks.gateway).toHaveBeenCalledOnce();
    expect(mocks.source).toHaveBeenCalledWith({ dataRoot: options.dataRoot, configuration: options.connection.configuration, gateway });
    expect(Object.isFrozen(f.options()?.gateway)).toBe(true);
  } finally { await runtime.close(); await fixture.close(metadata); }
});
it('binds output and delivery methods before held capacity provisioning despite later port method replacement', async () => {
  const { f, metadata, gateway, options } = await setup(); const held = deferred<typeof f.source>();
  const original = new Error('Synthetic captured method'); const replacement = new Error('Synthetic replacement method');
  const scan = vi.spyOn(metadata.outputs, 'scan').mockRejectedValue(original);
  const load = vi.spyOn(metadata.outputs, 'load').mockRejectedValue(original);
  const publish = vi.spyOn(metadata.outputs, 'recordPublication').mockRejectedValue(original);
  const finalize = vi.spyOn(metadata.finalizations, 'finalize').mockRejectedValue(original);
  const getRun = vi.spyOn(metadata.runs, 'getRun').mockRejectedValue(original);
  const dispatch = vi.spyOn(metadata.dispatch, 'scan').mockRejectedValue(original);
  const events = vi.spyOn(metadata.events, 'load').mockRejectedValue(original);
  mocks.source.mockReturnValueOnce(held.promise);
  const opening = openAgentRuntime(options, metadata); await flush(); expect(mocks.outputs).not.toHaveBeenCalled();
  metadata.outputs.scan = vi.fn(async () => { throw replacement; }); metadata.outputs.load = vi.fn(async () => { throw replacement; });
  metadata.outputs.recordPublication = vi.fn(async () => { throw replacement; });
  metadata.finalizations.finalize = vi.fn(async () => { throw replacement; }); metadata.runs.getRun = vi.fn(async () => { throw replacement; });
  metadata.dispatch.scan = vi.fn(async () => { throw replacement; }); metadata.events.load = vi.fn(async () => { throw replacement; });
  const attempt = gateway.attempt; gateway.attempt = vi.fn(() => { throw replacement; });
  held.resolve(f.source); const runtime = await opening;
  const captured = mocks.outputs.mock.calls[0]![0] as OutputRuntimeOptions;
  const delivery = f.options(); if (!delivery) throw new Error('Missing delivery options');
  const key = keyFor(); const binding = { key, journalAuthority: '33333333-3333-4333-8333-333333333333' };
  const identity = { ...key.attempt, journalAuthority: binding.journalAuthority };
  const artifact = { binding, sourceDigest: 'a'.repeat(64), manifestDigest: 'b'.repeat(64), ordinal: 0 };
  try {
    await expect(captured.outputs.scan({ limit: 1 })).rejects.toBe(original);
    await expect(captured.outputs.load(binding)).rejects.toBe(original);
    await expect(captured.outputs.recordPublication({ key: artifact, writerId: 'writer', expectedVersion: 1,
      receipt: { token: 'token', offset: 0, phase: 'published', identity: 'identity' } })).rejects.toBe(original);
    await expect(captured.finalizations.finalize({ ...artifact, expectedRunVersion: 1 })).rejects.toBe(original);
    await expect(captured.runs.getRun({ id: key.runId, scope: { kind: 'workspace',
      organizationId: key.attempt.organizationId, workspaceId: key.attempt.workspaceId } })).rejects.toBe(original);
    await expect(delivery.store.scan({ lane: 'queued', limit: 1 })).rejects.toBe(original);
    await expect(delivery.events.load(binding)).rejects.toBe(original);
    expect(() => delivery.gateway.attempt(identity)).toThrow('Unexpected client');
    expect(attempt).toHaveBeenCalledWith(identity); expect(gateway.attempt).not.toHaveBeenCalled();
    for (const [method, context] of [[scan, metadata.outputs], [load, metadata.outputs], [publish, metadata.outputs],
      [finalize, metadata.finalizations], [getRun, metadata.runs], [dispatch, metadata.dispatch], [events, metadata.events]] as const) {
      expect(method).toHaveBeenCalledOnce(); expect(method.mock.contexts[0]).toBe(context);
    }
    expect(metadata.outputs.scan).not.toHaveBeenCalled(); expect(metadata.finalizations.finalize).not.toHaveBeenCalled();
    expect(metadata.runs.getRun).not.toHaveBeenCalled();
  } finally { await runtime.close(); await fixture.close(metadata); }
});
it('owns source and shared connection cleanup when mandatory production output provisioning rejects', async () => {
  const { f, metadata, gateway, options } = await setup(); const failure = new Error('Synthetic mandatory output startup failure');
  mocks.outputs.mockRejectedValueOnce(failure);
  try {
    await expect(openAgentRuntime(options, metadata)).rejects.toBe(failure);
    expect(f.source.close).toHaveBeenCalledOnce(); expect(gateway.close).toHaveBeenCalledOnce();
    expect(f.source.sample).not.toHaveBeenCalled(); expect(mocks.delivery).not.toHaveBeenCalled();
    expect(await metadata.outputs.scan({ limit: 1 })).toMatchObject({ items: [] });
  } finally { await fixture.close(metadata); }
});
it('closes the sole gateway if capacity-source provisioning fails before outputs open', async () => {
  const { metadata, gateway, options } = await setup(); const failure = new Error('Synthetic capacity startup failure');
  mocks.source.mockRejectedValueOnce(failure);
  try {
    await expect(openAgentRuntime(options, metadata)).rejects.toBe(failure);
    expect(gateway.close).toHaveBeenCalledOnce(); expect(mocks.outputs).not.toHaveBeenCalled();
  } finally { await fixture.close(metadata); }
});
it('captures real absence/observation and narrow snapshot capabilities before held capacity startup', async () => {
  const { f, metadata, gateway, options } = await setup(); const held = deferred<typeof f.source>();
  const original = new Error('Synthetic original capability'); const replacement = new Error('Synthetic replaced capability');
  const read = vi.spyOn(metadata.absences, 'read').mockRejectedValue(original);
  const adopt = vi.spyOn(metadata.absences, 'adopt').mockRejectedValue(original);
  const finalize = vi.spyOn(metadata.absences, 'finalize').mockRejectedValue(original);
  const observe = vi.spyOn(metadata.dispatch, 'observe').mockRejectedValue(original);
  const snapshot = vi.fn(async () => {throw original;});
  const client = {snapshot, offer: vi.fn(), cancelOriginal: vi.fn(), cancel: vi.fn(), events: vi.fn(), ack: vi.fn()};
  const attempt = vi.fn(() => client); gateway.attempt = attempt;
  mocks.source.mockReturnValueOnce(held.promise);
  const opening = openAgentRuntime(options, metadata); await flush();
  metadata.absences.read = vi.fn(async () => {throw replacement;});
  metadata.absences.adopt = vi.fn(async () => {throw replacement;});
  metadata.absences.finalize = vi.fn(async () => {throw replacement;});
  metadata.dispatch.observe = vi.fn(async () => {throw replacement;});
  gateway.attempt = vi.fn(() => {throw replacement;});
  held.resolve(f.source); const runtime = await opening;
  const captured = mocks.outputs.mock.calls[0]![0] as OutputRuntimeOptions;
  const key = keyFor(); const binding = {key, journalAuthority: '33333333-3333-4333-8333-333333333333'};
  const facade = captured.gateway.attempt({...key.attempt, journalAuthority: binding.journalAuthority});
  client.snapshot = vi.fn(async () => {throw replacement;});
  try {
    expect(Object.keys(captured.absences).sort()).toEqual(['adopt', 'finalize', 'read']);
    expect(Object.keys(captured.observations)).toEqual(['observe']);
    expect(Object.keys(facade)).toEqual(['snapshot']); expect(Object.isFrozen(facade)).toBe(true);
    await expect(captured.absences.read(binding)).rejects.toBe(original);
    await expect(captured.absences.adopt({binding, closure: {}})).rejects.toBe(original);
    await expect(captured.absences.finalize({binding, proofDigest: 'a'.repeat(64), expectedRunVersion: 1})).rejects.toBe(original);
    await expect(captured.observations.observe({key, journalAuthority: binding.journalAuthority, snapshot: {}})).rejects.toBe(original);
    await expect(facade.snapshot()).rejects.toBe(original);
    for (const [method, context] of [[read, metadata.absences], [adopt, metadata.absences], [finalize, metadata.absences],
      [observe, metadata.dispatch], [attempt, gateway], [snapshot, client]] as const) {
      expect(method).toHaveBeenCalledOnce(); expect(method.mock.contexts[0]).toBe(context);
    }
    expect(gateway.attempt).not.toHaveBeenCalled(); expect(client.snapshot).not.toHaveBeenCalled();
  } finally {await runtime.close(); await fixture.close(metadata);}
});
it.each(['read', 'adopt', 'finalize', 'observe'] as const)('fails mandatory missing %s capability before capacity startup', async method => {
  const {metadata, options} = await setup();
  const target = method === 'observe' ? metadata.dispatch : metadata.absences;
  const original = Object.getOwnPropertyDescriptor(target, method)!;
  Reflect.deleteProperty(target, method);
  try {
    await expect(openAgentRuntime(options, metadata)).rejects.toThrow('Missing output absence capability');
    expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.gateway).not.toHaveBeenCalled(); expect(mocks.outputs).not.toHaveBeenCalled();
  } finally {Object.defineProperty(target, method, original); await fixture.close(metadata);}
});
