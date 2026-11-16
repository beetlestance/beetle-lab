import { expect, it, vi } from 'vitest';
import { JournalError } from '../../src/journal/index.js';
import { SupervisorError } from '../../src/supervisor/index.js';
import { captureAuthority } from '../../src/supervisor/offer-authority.js';
import { controlled, port, reserved, supervisorFixture } from './fixtures.js';
import type { Reservation } from '../../src/admission/index.js';
import type { Offer } from '@beetle/contracts';
import { creditHold } from '../controller/credit-hold.js';

const f = supervisorFixture();
it('restores the PRIOR retired marker through a later real nonissued read refusal', async () => {
  const e = await f.setup(); const base = port(e.journal);
  const read = vi.spyOn(base, 'readOffer').mockRejectedValueOnce(new JournalError('unavailable'));
  const c = controlled(base, e.time); const actor = c.manager.actor(e.input);
  await expect(actor.launch()).rejects.toMatchObject({ code: 'journal_unavailable' });
  const hold = await creditHold(e.journal, e.offer); hold.start();
  try {
    await expect(actor.launch()).rejects.toMatchObject({ code: 'journal_busy' });
    await hold.release(); await actor.launch(); await actor.tick();
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
  } finally { await hold.close(); read.mockRestore(); }
});
it('does not grant an unclaimed tick-only actor launch when credits return', async () => {
  const e = await f.setup(); const c = controlled(e.journal, e.time); const actor = c.manager.actor(e.input);
  const hold = await creditHold(e.journal, e.offer); hold.start();
  try {
    await expect(actor.tick()).rejects.toMatchObject({ code: 'journal_busy' });
    await hold.release(); await actor.tick(); expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
  } finally { await hold.close(); }
});
it('a foreign journal_busy error cannot impersonate private read refusal provenance', async () => {
  const e = await f.setup(); const base = port(e.journal); let refuse = true;
  const c = controlled({ ...base, admission: command => {
    if (command.kind === 'reservation' && refuse) { refuse = false; throw new SupervisorError('journal_busy'); }
    return base.admission(command);
  } }, e.time);
  const actor = c.manager.actor(e.input);
  await expect(actor.launch()).rejects.toMatchObject({ code: 'journal_unavailable' });
  await actor.launch(); expect(c.backend.creates).toBe(0);
});
it('captures exactly declared scalar authority keys and freezes both nested objects', async () => {
  const e = await f.setup(); const base = port(e.journal); const offer = await base.readOffer(e.input.key);
  Object.assign(offer.engine, { unknown: { payload: 'not retained' } });
  Object.assign(offer.budget, { unknown: { payload: 'not retained' } });
  const current = reserved(await base.admission({ kind: 'reservation', key: e.input.key }));
  const authority = await captureAuthority({ ...base, readOffer: async () => offer }, e.input, current);
  expect(Object.keys(authority).sort()).toEqual(['organizationId', 'workspaceId', 'attemptId', 'intentDigest', 'engine', 'budget'].sort());
  expect(Object.keys(authority.engine).sort()).toEqual(['id', 'imageDigest', 'configVersion'].sort());
  expect(Object.keys(authority.budget).sort()).toEqual(['cpuMillis', 'memoryBytes', 'pids', 'timeoutMs', 'outputBytes'].sort());
  expect([authority, authority.engine, authority.budget].every(Object.isFrozen)).toBe(true);
  offer.budget.cpuMillis++; offer.engine.imageDigest = `sha256:${'f'.repeat(64)}`;
  expect(authority.budget.cpuMillis).toBe(current.budget.cpuMillis);
  expect(authority.engine.imageDigest).toBe(e.plan.spec.Image);
});
const corruptions: [string, (row: Reservation) => void][] = [
  ['organization', row => { row.organizationId = '00000000-0000-4000-8000-000000000099'; }],
  ['workspace', row => { row.workspaceId = '00000000-0000-4000-8000-000000000099'; }],
  ['attempt', row => { row.attemptId = '00000000-0000-4000-8000-000000000099'; }],
  ['generation', row => { row.generation++; }],
  ['status', row => { row.status = 'released'; }],
  ['aborted', row => { row.aborted = true; }],
  ['specDigest', row => { row.specDigest = 'f'.repeat(64); }],
  ...(['cpuMillis', 'memoryBytes', 'pids', 'timeoutMs', 'outputBytes'] as const)
    .map(name => [name, (row: Reservation) => { row.budget[name]++; }] as [string, (row: Reservation) => void]),
];
for (const [name, corrupt] of corruptions) {
  it(`fresh ${name} corruption still rejects after compact authority capture without reading config`, async () => {
    const e = await f.setup(); const base = port(e.journal); let armed = false;
    const read = vi.spyOn(base, 'readOffer');
    const c = controlled({ ...base, admission: async command => {
      const result = await base.admission(command);
      if (armed && command.kind === 'reservation' && 'status' in result) corrupt(result);
      return result;
    } }, e.time);
    const actor = c.manager.actor(e.input); await actor.tick(); armed = true;
    await expect(actor.launch()).rejects.toMatchObject({ code: 'conflict' });
    expect(read).toHaveBeenCalledTimes(1); expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
  });
}
it('cached copy itself must pass binding checks before any dispatch', async () => {
  const e = await f.setup(); const base = port(e.journal); const original = await base.readOffer(e.input.key);
  const changed = structuredClone(original); changed.budget.cpuMillis++;
  const c = controlled({ ...base, readOffer: async () => changed }, e.time);
  await expect(c.manager.actor(e.input).launch()).rejects.toMatchObject({ code: 'conflict' });
  expect(c.backend.creates).toBe(0);
});
it('recovered claimed owners never gain launch permission after read refusal', async () => {
  const e = await f.setup();
  await e.journal.admission({ kind: 'claimCreate', key: e.input.key, specDigest: e.plan.specDigest });
  const c = controlled(e.journal, e.time); const actor = c.manager.actor(e.input);
  const hold = await creditHold(e.journal, e.offer); hold.start();
  try {
    await expect(actor.tick()).rejects.toMatchObject({ code: 'journal_busy' });
    await hold.release(); await actor.tick(); await actor.launch();
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
    expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.input.key })).status).toBe('charged');
  } finally { await hold.close(); }
});
const offerCorruptions: [string, (offer: Offer) => void][] = [
  ['scope', offer => { offer.workspaceId = '00000000-0000-4000-8000-000000000099'; }],
  ['intent label', offer => { offer.intentDigest = 'f'.repeat(64); }],
  ['plan image', offer => { offer.engine.imageDigest = `sha256:${'f'.repeat(64)}`; }],
];
for (const [name, corrupt] of offerCorruptions) {
  it(`rejects captured ${name} binding before caching`, async () => {
    const e = await f.setup(); const base = port(e.journal); const offer = await base.readOffer(e.input.key); corrupt(offer);
    const c = controlled({ ...base, readOffer: async () => offer }, e.time);
    await expect(c.manager.actor(e.input).launch()).rejects.toMatchObject({ code: 'conflict' });
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
  });
}
for (const name of ['cpuMillis', 'memoryBytes', 'pids'] as const) {
  it(`rejects captured ${name} versus plan controls even when the fresh reservation budget matches`, async () => {
    const e = await f.setup(); const base = port(e.journal); const offer = await base.readOffer(e.input.key);
    offer.budget[name]++;
    const c = controlled({ ...base, readOffer: async () => offer, admission: async command => {
      const value = await base.admission(command);
      if ('status' in value) value.budget[name] = offer.budget[name];
      return value;
    } }, e.time);
    await expect(c.manager.actor(e.input).launch()).rejects.toMatchObject({ code: 'conflict' });
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
  });
}
