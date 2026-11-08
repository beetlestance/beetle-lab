import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ControlEvent, EngineResult } from '@beetle/contracts';
import { sealEngineResult } from '@beetle/contracts';
import { createAttemptController } from '../../src/controller/index.js';
import { fixture, operation } from '../staging/fixtures.js';
import { controlled, clock, scope } from '../supervisor/fixtures.js';

const f = fixture();
it('wires actual stager, control filesystem, journal checkpoint and supervisor without rescanning history', async () => {
  const e = await f.environment(false);
  e.offer.budget.outputBytes = 4000;
  await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
  const stager = e.create({ profile: { ...e.options.profile,
    maximumBudget: { ...e.options.profile.maximumBudget, outputBytes: 4000 } } });
  const prepared = e.prepare(stager); const plan = await prepared.result; await prepared.quiesced;
  if (!plan.ok) throw new Error(plan.reason);
  const time = clock(); time.advance(2); const owner = controlled(e.owner, time);
  const key = scope(e.offer); let collections = 0;
  const result = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
  const { seal: _seal, ...body } = result; void _seal;
  const sealed = sealEngineResult({ ...body, ...key, artifacts: [] }, '2026-01-01T00:00:00Z',
    text => createHash('sha256').update(text).digest('hex'));
  if (!sealed.ok) throw new Error(sealed.code);
  const event: ControlEvent = { version: '1.0', ...key, seq: 1, phase: 'seal', kind: 'engine.result',
    observedAt: '2026-01-01T00:00:00Z', payload: sealed.value };
  const path = join(e.rootPath, plan.value.name, 'output', 'control.ndjson');
  await writeFile(path, JSON.stringify(event) + '\n', { mode: 0o600 });
  const controller = createAttemptController({ journal: e.owner, supervisor: owner.manager,
    input: { key, plan: plan.value }, wallNow: time.wall, collectOutputs: options => {
      collections++;
      return { result: Promise.resolve({ ok: true, value: options.reportedResult, verifiedBytes: options.controlBytes }),
        quiesced: Promise.resolve(), close: () => Promise.resolve() };
    } });
  try {
    expect(await controller.launch(operation())).toEqual({ kind: 'control', events: 1 });
    const checkpoint = await e.owner.readWrapperCheckpoint(key);
    expect(checkpoint?.offset).toBe(Buffer.byteLength(JSON.stringify(event) + '\n'));
    expect((await e.owner.readEvents(key, 0)).events.filter(e => e.source === 'wrapper')).toHaveLength(1);
    owner.backend.observation = owner.backend.known('exited').value; time.advance(1);
    expect(await controller.tick(operation())).toEqual({ kind: 'awaiting_release', collection: 'finished' });
    expect(collections).toBe(1);
    expect(await controller.tick(operation())).toEqual({ kind: 'released', collection: 'finished' });
    expect(await e.owner.readWrapperCheckpoint(key)).toEqual(checkpoint);
  } finally { await controller.close(); }
});
it('fails an actually empty stopped control file and releases without manufacturing a checkpoint', async () => {
  const e = await f.environment(); const prepared = e.prepare(e.create());
  const plan = await prepared.result; await prepared.quiesced;
  if (!plan.ok) throw new Error(plan.reason);
  const time = clock(); time.advance(2); const owner = controlled(e.owner, time); const key = scope(e.offer);
  await writeFile(join(e.rootPath, plan.value.name, 'output', 'control.ndjson'), '', { mode: 0o600 });
  const controller = createAttemptController({ journal: e.owner, supervisor: owner.manager,
    input: { key, plan: plan.value }, wallNow: time.wall,
    collectOutputs: () => { throw new Error('empty control cannot authorize output collection'); } });
  try {
    expect(await controller.launch(operation())).toMatchObject({ kind: 'runtime' });
    owner.backend.observation = owner.backend.known('exited').value; time.advance(1);
    expect(await controller.tick(operation())).toEqual({ kind: 'awaiting_release', collection: 'failed' });
    expect(await controller.tick(operation())).toEqual({ kind: 'released', collection: 'failed' });
    expect(await e.owner.readWrapperCheckpoint(key)).toBeNull();
  } finally { await controller.close(); }
});
