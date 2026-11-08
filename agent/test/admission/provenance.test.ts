import { describe, expect, it } from 'vitest';
import type { RuntimeObservation } from '../../src/admission/index.js';
import { settings } from '../../src/journal/admission-data.js';
import { initialize } from '../../src/journal/schema.js';
import { Store } from '../../src/journal/store.js';
import { admissionFixture, configuration, now, observation, scope } from './fixtures.js';

const f = admissionFixture();

describe('resource evidence provenance and restart authority', () => {
  it('clears fresh previous-process readiness without releasing charged work or deleting the queue', async () => {
    const path = f.path(); let journal = await f.configured(path);
    const first = f.job(1); const second = f.job(2);
    await f.enqueue(journal, first); await f.admit(journal, first); await f.enqueue(journal, second);
    await f.close(journal); journal = await f.open(path);
    expect(await f.admit(journal, second, now + 1)).toEqual({ kind: 'defer', reason: 'capacity_unknown' });
    expect(await journal.admission({ kind: 'reservation', key: scope(first) })).toMatchObject({ status: 'charged' });
    expect((await journal.scanRunnable({ lane: 'queued', limit: 100 })).attempts).toEqual([scope(second)]);
    await journal.admission({ kind: 'observe', observation: observation(now + 1) });
    expect(await f.admit(journal, second, now + 1)).toMatchObject({ status: 'charged' });
  });

  it('revokes omitted guards immediately even when previous guards are still fresh', async () => {
    const journal = await f.configured(); const fresh = observation(now + 1); delete fresh.guards;
    await journal.admission({ kind: 'observe', observation: fresh });
    expect(await f.enqueue(journal, f.job(), now + 1)).toEqual({ kind: 'reject', reason: 'controls_unavailable' });
  });

  it.each(['unknown', 'omitted', 'reduced', 'disk', 'capacity', 'controls', 'sensor'] as const)(
    'lets equal-timestamp%s revoke readiness without a known tie restoring it', async cause => {
    const db = initialize(f.path());
    try {
      const store = new Store(db);
      const write = (value: RuntimeObservation) => store.execute({ id: 1, kind: 'admission', request: { kind: 'observe', observation: value } });
      write(observation()); const revoked = observation();
      if (cause === 'unknown') revoked.status = 'unknown';
      if (cause === 'omitted') delete revoked.guards;
      if (cause === 'reduced') revoked.guards!.controls = ['timeout'];
      if (cause === 'disk') revoked.freeDiskBytes = 0;
      if (cause === 'capacity') revoked.capacity.cpuMillis--;
      if (cause === 'controls') revoked.controls = [];
      if (cause === 'sensor') revoked.idle!.value = false;
      expect(write(revoked)).toEqual({ stored: true });
      store.execute({ id: 2, kind: 'admission', request: { kind: 'configure', configuration: configuration() } });
      expect(settings(db, now).observation).toMatchObject({ status: 'unknown' });
      expect(settings(db, now).observation).not.toHaveProperty('guards');
      write(observation());
      expect(settings(db, now).observation?.status).toBe('unknown');
      expect(write(observation(now + 1))).toEqual({ stored: true });
      expect(settings(db, now + 1).observation?.status).toBe('known');
    } finally { db.close(); }
  });

  it('ignores an identical same-timestamp replay without revoking established facts', () => {
    const db = initialize(f.path());
    try {
      const store = new Store(db);
      const request = { kind: 'observe' as const, observation: observation() };
      expect(store.execute({ id: 1, kind: 'admission', request })).toEqual({ stored: true });
      expect(store.execute({ id: 2, kind: 'admission', request })).toEqual({ stored: false });
    } finally { db.close(); }
  });

  it.each([
    { capacityProvenance: undefined }, { physicalPidCapacity: 128 }, { daemonId: null },
    { diskSource: 'unavailable' }, { capacityProvenance: { ...observation().capacityProvenance, pids: 'docker-info' } },
    { capacityProvenance: { ...observation().capacityProvenance, cpuMillis: 'unavailable' } },
  ])('rejects missing or invented known provenance %j', async fields => {
    const journal = await f.configured();
    await expect(journal.admission({ kind: 'observe', observation: { ...observation(now + 1), ...fields } as RuntimeObservation }))
      .rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('treats invalid stored observations as unknown and permits a genuine fresh replacement', () => {
    const db = initialize(f.path());
    try {
      const store = new Store(db);
      store.execute({ id: 1, kind: 'admission', request: { kind: 'configure', configuration: configuration() } });
      const old = observation() as Partial<RuntimeObservation>; delete old.capacityProvenance;
      for (const raw of [JSON.stringify(old), '{invalid', 'null', JSON.stringify({ ...observation(), physicalPidCapacity: 1 })]) {
        db.prepare('UPDATE admission_settings SET observation_json=? WHERE id=1').run(raw);
        expect(settings(db, now).observation).toBeNull();
        expect(store.execute({ id: 2, kind: 'admission', request: { kind: 'observe', observation: observation(now + 1) } }))
          .toEqual({ stored: true });
        expect(settings(db, now + 1).observation).toEqual(observation(now + 1));
      }
    } finally { db.close(); }
  });
});
