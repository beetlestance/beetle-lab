import { describe, it, expect } from 'vitest';
import { JournalError } from '../../src/journal/index.js';
import { fixture, operation, scope, deferred } from './fixtures.js';
const f = fixture();
describe('installation corrected ownership and cancellation, synthetic Docker', () => {
  it.each(['invalid budget', 'missing scope', 'queued cancellation'] as const)(
    'reclaims more than 64 effect-free owners after %s', async reason => {
      const e = await f.setup(); const manager = e.create();
      for (let index = 1; index <= 66; index++) {
        const offer = { ...e.offer, attemptId: f.job(index).attemptId };
        if (reason === 'queued cancellation') {
          await e.accepted(manager, offer); await manager.cancel(scope(offer));
          expect((await manager.inspect(scope(offer))).allocation).toBeNull();
        } else {
          const budget = reason === 'invalid budget' ? { deadline: 0 } : operation();
          const failure = reason === 'invalid budget' ? { reason: 'invalid_input' } : { code: 'not_found' };
          await expect(manager.drive(scope(offer), budget)).rejects.toMatchObject(failure);
        }
      }
      const next = { ...e.offer, attemptId: f.job(67).attemptId }; await e.accepted(manager, next);
      await e.finish(manager, next); expect(e.backend.starts).toBe(1); await manager.close();
    });
  it('reconciles, collects and releases an ordinarily cancelled running controller', async () => {
    const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
    await manager.drive(scope(e.offer), operation()); expect(e.backend.starts).toBe(1);
    await manager.cancel(scope(e.offer));
    e.backend.observation = e.backend.known('exited').value;
    expect((await e.finish(manager)).kind).toBe('released');
    expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('released');
    expect(e.backend.creates).toBe(1); expect(e.backend.starts).toBe(1); expect(e.manager.size).toBe(0);
  });
  it('allows cancellation to overtake a pending controller drive and later finish cleanup', async () => {
    const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
    await manager.drive(scope(e.offer), operation());
    const entered = deferred<void>(); const release = deferred<void>();
    const inspect = e.backend.inspect.bind(e.backend); let held = false;
    e.backend.inspect = async (...args) => {
      if (!held) { held = true; entered.resolve(); await release.promise; }
      return inspect(...args);
    };
    const driving = manager.drive(scope(e.offer), operation()); await entered.promise;
    await manager.cancel(scope(e.offer));
    expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
    release.resolve(); await driving; await e.finish(manager);
    expect(e.backend.starts).toBe(1); expect(e.manager.size).toBe(0);
  });
  it('does not evict a new active lane using an earlier provisional allocation observation', async () => {
    const e = await f.setup(); const oldRead = deferred<void>(); const releaseRead = deferred<void>();
    const staging = deferred<void>(); const finishStage = deferred<void>(); const original = e.owner.admission.bind(e.owner);
    let reads = 0;
    e.owner.admission = async command => {
      if (command.kind === 'reservation' && ++reads === 1) {
        oldRead.resolve(); await releaseRead.promise; throw new JournalError('not_found');
      }
      return original(command);
    };
    const manager = e.create({ stagerFor: () => ({ prepare() {
      staging.resolve(); return { result: finishStage.promise.then(() => ({ ok: false, reason: 'provider' })), quiesced: finishStage.promise };
    } }) });
    await e.accepted(manager);
    const invalid = manager.drive(scope(e.offer), { deadline: 0 });
    const invalidCheck = expect(invalid).rejects.toMatchObject({ reason: 'invalid_input' }); await oldRead.promise;
    const driving = manager.drive(scope(e.offer), operation()); await staging.promise;
    releaseRead.resolve(); await invalidCheck;
    await expect(manager.drive(scope(e.offer), operation())).rejects.toMatchObject({ reason: 'busy' });
    finishStage.resolve(); expect((await driving).kind).toBe('released');
  });
  it('retains provisional owners when journal reconciliation cannot establish an uncharged state', async () => {
    const e = await f.setup(); const original = e.owner.admission.bind(e.owner);
    e.owner.admission = async command => {
      if (command.kind === 'reservation') throw new JournalError('unavailable');
      return original(command);
    };
    const manager = e.create();
    for (let index = 1; index <= 64; index++) {
      await expect(manager.drive(scope(f.job(index)), { deadline: 0 })).rejects.toMatchObject({ reason: 'invalid_input' });
    }
    const offer = { ...e.offer, attemptId: f.job(65).attemptId }; await e.accepted(manager, offer);
    await expect(manager.drive(scope(offer), operation())).rejects.toMatchObject({ reason: 'capacity' });
    await expect(manager.close()).rejects.toMatchObject({ reason: 'cleanup' });
  });
});
