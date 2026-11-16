import { expect, it, vi } from 'vitest';
import { encodeJson, validate } from '@beetle/contracts';
import type { AgentEvent } from '@beetle/contracts';
import { mkdir, writeFile } from 'node:fs/promises';
import { Supervisor } from '../../src/supervisor/index.js';
import { RuntimeEvidence } from '../../src/supervisor/evidence.js';
import { ResourceAggregate } from '../../src/telemetry/aggregate.js';
import type { ResourceReading, Operation } from '../../src/backends/docker/index.js';
import { JournalError } from '../../src/journal/index.js';
import type { SupervisorInput } from '../../src/journal/index.js';
import { configuration } from '../admission/fixtures.js';
import { FakeDocker, makeInput, makePlan } from '../backends/docker/fixtures.js';
import { clock } from './fixtures.js';
import { DockerBackend, runtimeName } from '../../src/backends/docker/index.js';
import { controlled, deferred, installationId, now, port, scope, supervisorFixture } from './fixtures.js';
import { fixture as installationFixture } from '../installation/fixtures.js';
import { managers, writeResult } from '../installation/delivery-fixtures.js';

const f = supervisorFixture(); const installed = installationFixture(); const create = managers();
const reading: ResourceReading = { cpuMillis: 4, memoryBytes: 10, pids: 2, reason: null };
const turns = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
async function artifact(name: string, events: AgentEvent[]): Promise<void> {
  const directory = '.agent-work/reports/w304-attempt-resources';
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${name}.json`, encodeJson(events, 65_536));
}
async function longAttempt() {
  const journal = await f.configured(); const config = configuration(); config.maxTimeoutMs = 60_000;
  await journal.admission({ kind: 'configure', configuration: config });
  const offer = f.job(); offer.budget.timeoutMs = 60_000;
  await f.enqueue(journal, offer); await f.admit(journal, offer);
  const base = makeInput(); const input = { ...base, offer,
    manifest: { ...base.manifest, minimumBudget: { ...offer.budget } },
    profile: { ...base.profile, maximumBudget: { ...offer.budget } } };
  const name = runtimeName({ ...offer, installationId, generation: 1 });
  const root = `${input.profile.stagingRoot}/${name}`;
  input.staged = { input: `${root}/input`, output: `${root}/output` };
  const plan = makePlan(input); const transport = new FakeDocker(plan); const time = clock();
  const backend = new DockerBackend(transport);
  const manager = new Supervisor({ journal, installationId, clock: time, requireResourceTelemetry: true, backendFactory: () => backend });
  const actor = manager.actor({ key: scope(offer), plan });
  return { journal, transport, time, manager, actor, key: scope(offer) };
}
it('publishes actual Docker summaries on five-second cadence, keeps sampled peaks and reports reset at exit', async () => {
  const e = await longAttempt(); let cpu = 0; let memory = 100; let pids = 4;
  e.transport.intercept = request => request.path.includes('/stats?') ? { ok: true, status: 200,
    body: { id: 'b'.repeat(64), cpu_stats: { cpu_usage: { total_usage: cpu * 1_000_000 } }, memory_stats: { usage: memory }, pids_stats: { current: pids } } } : undefined;
  try {
    await e.actor.launch();
    for (let index = 1; index <= 5; index++) { cpu = index; memory = index * 100; pids = index + 4; e.time.advance(1000); await e.actor.tick(); }
    await expect.poll(async () => (await e.journal.readEvents(e.key, 0)).events.find(event => event.kind === 'resource.summary')?.payload).toMatchObject({ cpuMillis: 5, peakMemoryBytes: 500, peakPids: 9, samples: 6, missedSamples: 0,
      outputBytes: null, enforcedControls: ['cpu', 'memory', 'pids'], lastSampleAt: new Date(now + 5000).toISOString() });
    cpu = 1; memory = 1; pids = 1; e.time.advance(1000); await e.actor.tick();
    await e.actor.cancel('output_limit');
    const events = (await e.journal.readEvents(e.key, 0)).events;
    expect(events.filter(event => event.kind === 'resource.summary').at(-1)?.payload)
      .toMatchObject({ cpuMillis: null, peakMemoryBytes: 500, peakPids: 9, samples: 7, reason: 'counter_reset' });
    expect(events.at(-1)?.kind).toBe('runtime.exited');
    await artifact('docker-reset-events', events);
  } finally { await e.manager.closeTelemetry(); }
});
it('retains a held periodic Journal original without blocking the cancel signal lane', async () => {
  const e = await longAttempt(); const issued = deferred<void>(); const gate = deferred<void>();
  const append = e.journal.appendSupervisor.bind(e.journal); let first = true;
  const publication = vi.spyOn(e.journal, 'appendSupervisor').mockImplementation(async input => {
    const result = await append(input);
    if (first && input.event.kind === 'resource.summary') { first = false; issued.resolve(); await gate.promise; }
    return result;
  });
  let tick: Promise<unknown> | undefined; let cancellation: Promise<unknown> | undefined;
  try {
    await e.actor.launch();
    for (let index = 0; index < 4; index++) { e.time.advance(1000); await e.actor.tick(); }
    e.time.advance(1000); let tickSettled = false;
    tick = e.actor.tick().then(() => { tickSettled = true; }); await issued.promise;
    await expect.poll(() => tickSettled).toBe(true);
    let cancelled = false; cancellation = e.actor.cancel('output_limit').then(() => { cancelled = true; });
    await expect.poll(() => e.transport.mutations().some(request => request.path.includes('/kill?'))).toBe(true);
    expect(cancelled).toBe(false);
    expect((await e.journal.readEvents(e.key, 0)).events.at(-1)?.kind).toBe('resource.summary');
    gate.resolve(); await cancellation;
    const events = (await e.journal.readEvents(e.key, 0)).events;
    expect(events.slice(-3).map(event => event.kind)).toEqual(['cancellation.requested', 'resource.summary', 'runtime.exited']);
    expect(events.map(event => event.seq)).toEqual(events.map((_event, index) => index + 1));
  } finally {
    gate.resolve(); await Promise.allSettled([tick, cancellation]); await e.manager.closeTelemetry(); publication.mockRestore();
  }
});
it('requires the concrete installed capability, without making old narrow fixtures invent stats', async () => {
  const e = await f.setup(); const c = controlled(e.journal, e.time);
  expect(() => new Supervisor({ journal: e.journal, installationId, requireResourceTelemetry: true,
    backendFactory: () => c.backend })).toThrowError('Supervisor backend_unavailable');
  expect(c.manager.actor(e.input)).toBeDefined();
});
it('serializes immutable lost-ack resource replay before lifecycle and coalesces latest state', async () => {
  const e = await f.setup(); const evidence = new RuntimeEvidence(port(e.journal), e.input.key);
  await e.manager.actor(e.input).launch();
  const aggregate = new ResourceAggregate(['cpu', 'memory', 'pids']); aggregate.observe(reading, now);
  const append = e.journal.appendSupervisor.bind(e.journal); const calls: SupervisorInput[] = [];
  let lose = true;
  const spy = vi.spyOn(e.journal, 'appendSupervisor').mockImplementation(async input => {
    calls.push(input); const result = await append(input);
    if (lose && input.event.kind === 'resource.summary') { lose = false; throw new JournalError('unavailable'); }
    return result;
  });
  try {
    evidence.summarize(aggregate.summary(), now); await evidence.flush(); expect(evidence.hasPending).toBe(true);
    for (let index = 0; index < 1000; index++) {
      aggregate.observe({ ...reading, cpuMillis: index + 4 }, now + index);
      evidence.summarize(aggregate.summary(), now + index);
    }
    await e.journal.supervision({ key: e.input.key, now: now + 1000, cancel: true });
    evidence.cancelled(now + 1000, now + 1000);
    await Promise.all([evidence.flush(), evidence.flush()]);
    expect(calls[1]).toBe(calls[0]); expect(Object.isFrozen(calls[0])).toBe(true);
    expect(Object.isFrozen(calls[0]!.event.payload)).toBe(true);
    expect(calls.map(input => input.event.kind)).toEqual(['resource.summary', 'resource.summary', 'cancellation.requested', 'resource.summary']);
    expect(calls.slice(1).map(input => input.sourceOrdinal)).toEqual([3, 4, 5]);
    const events = (await e.journal.readEvents(e.input.key, 0)).events;
    expect(events.map(event => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(events.filter(event => event.kind === 'resource.summary')).toHaveLength(2);
    expect(events.every(event => validate('AgentEvent', event).ok)).toBe(true);
    await artifact('journal-replay-events', events);
    expect((await e.journal.get(e.input.key)).result).toBeUndefined(); expect(evidence.hasPending).toBe(false);
    const other = { ...e.input.key, organizationId: '00000000-0000-4000-9000-000000000099' };
    await expect(e.journal.readEvents(other, 0)).rejects.toMatchObject({ code: 'not_found' });
  } finally { spy.mockRestore(); }
});
it('defers a known pre-issue busy resource and gives lifecycle facts the next ordinal', async () => {
  const e = await f.setup(); const evidence = new RuntimeEvidence(port(e.journal), e.input.key);
  const aggregate = new ResourceAggregate([]); aggregate.observe(reading, now);
  const cursor = vi.spyOn(e.journal, 'sourceCursors').mockRejectedValueOnce(new JournalError('queue_full'));
  evidence.summarize(aggregate.summary(), now); await evidence.flush();
  await e.journal.supervision({ key: e.input.key, now, cancel: true });
  evidence.cancelled(now, now); await evidence.flush(); cursor.mockRestore();
  expect((await e.journal.readEvents(e.input.key, 0)).events.map(event => event.kind))
    .toEqual(['admitted', 'cancellation.requested', 'resource.summary']);
});
it('cancel and kill proceed while stats are held; final source closure drains the original and forbids late events', async () => {
  const e = await installed.setup(4000); const sample = deferred<ResourceReading>(); const issued = deferred<Operation>();
  Object.assign(e.backend, { sampleResources: (_plan: unknown, operation: Operation) => { issued.resolve(operation); return sample.promise; } });
  const manager = create(e.options); await e.accepted(manager); await manager.drive(scope(e.offer), { deadline: performance.now() + 5000 });
  const operation = await issued.promise; await writeResult(e, manager);
  const begin = vi.spyOn(e.owner, 'beginOutputCollection'); const close = vi.spyOn(e.owner, 'closeOutputDelivery');
  const journalGate = deferred<void>(); const journalIssued = deferred<void>();
  const append = e.owner.appendSupervisor.bind(e.owner);
  const publication = vi.spyOn(e.owner, 'appendSupervisor').mockImplementation(async input => {
    const result = await append(input);
    if (input.event.kind === 'resource.summary') { journalIssued.resolve(); await journalGate.promise; }
    return result;
  });
  const cancelling = manager.stop(scope(e.offer), 'output_limit');
  let settled = false; void cancelling.then(() => { settled = true; });
  try {
    await vi.waitFor(() => expect(e.backend.kills).toBe(1));
    expect(operation.signal!.aborted).toBe(true); expect(settled).toBe(true);
    const finishing = e.finish(manager); await turns();
    expect(begin).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    sample.resolve(reading); await cancelling; await journalIssued.promise;
    expect(begin).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    expect((await e.owner.readEvents(scope(e.offer), 0)).events.at(-1)?.kind).toBe('resource.summary');
    journalGate.resolve();
    expect(await finishing).toEqual({ kind: 'released', collection: 'finished' });
    expect(e.manager.size).toBe(0);
    const closure = await e.owner.readOutputDelivery(scope(e.offer)); expect(closure).not.toBeNull();
    const before = await e.owner.readEvents(scope(e.offer), 0);
    expect(before.events.map(event => event.kind)).toEqual(['admitted', 'runtime.started', 'cancellation.requested', 'resource.summary', 'runtime.exited', 'engine.result']);
    const summary = before.events.find(event => event.kind === 'resource.summary')!;
    expect(summary.payload).toMatchObject({ samples: 0, missedSamples: 1, cpuMillis: null, peakMemoryBytes: null, source: 'docker-stats' });
    expect(closure!.finalAgentSeq).toBe(before.events.at(-1)!.seq);
    await artifact('closed-source-events', before.events);
    expect((await e.owner.get(scope(e.offer))).result).toEqual(before.events.find(event => event.kind === 'engine.result')!.payload);
    e.time.advance(5000); await manager.drive(scope(e.offer), { deadline: performance.now() + 5000 });
    expect((await e.owner.readEvents(scope(e.offer), 0)).events).toEqual(before.events);
  } finally { sample.resolve(reading); journalGate.resolve(); await cancelling.catch(() => undefined);
    begin.mockRestore(); close.mockRestore(); publication.mockRestore(); }
});
it('shutdown is reentrant and retains stats originals instead of pretending abort completed them', async () => {
  const e = await f.setup(); const held = deferred<ResourceReading>(); const issued = deferred<void>();
  const backend = new DockerBackend(e.transport);
  const sample = vi.spyOn(backend, 'sampleResources').mockImplementation(() => { issued.resolve(); return held.promise; });
  const manager = new Supervisor({ journal: e.journal, installationId, requireResourceTelemetry: true, clock: e.time, backendFactory: () => backend });
  await manager.actor(e.input).launch(); await issued.promise;
  const close = manager.closeTelemetry(); expect(manager.closeTelemetry()).toBe(close);
  let closed = false; void close.then(() => { closed = true; }); await turns(); expect(closed).toBe(false);
  expect(() => manager.actor(e.input)).toThrowError('Supervisor closed');
  held.resolve(reading); await close; expect(sample).toHaveBeenCalledTimes(1);
  sample.mockRestore();
});
