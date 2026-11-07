import { describe, expect, it } from 'vitest';
import { AttemptTime } from '../../src/supervisor/time.js';
import { now, reserved, supervisorFixture } from './fixtures.js';

const f = supervisorFixture();
describe('atomic execution permission and operation construction', () => {
  it.each([
    ['invalid wall', Number.NaN, undefined, 'clock_integrity'],
    ['infinite wall', Infinity, undefined, 'clock_integrity'],
    ['rolled-back wall', now - 1, undefined, 'clock_integrity'],
    ['invalid monotonic', undefined, Number.NaN, 'clock_integrity'],
    ['infinite monotonic', undefined, Infinity, 'clock_integrity'],
    ['rolled-back monotonic', undefined, -1, 'clock_integrity'],
    ['absolute deadline', now + 1000, undefined, 'timeout'],
    ['monotonic deadline', undefined, 1000, 'timeout'],
  ] as const)('%s in its own final sample denies the operation', async (_name, badWall, monoOffset, reason) => {
    const s = await f.setup(); const reservation = reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key }));
    const state = await s.journal.supervision({ key: s.input.key, now });
    let wall = now; let mono = s.time.monotonic(); let wallReads = 0; let monoReads = 0;
    const timing = new AttemptTime({ wall: () => { wallReads++; return wall; }, monotonic: () => { monoReads++; return mono; } });
    const issued = timing.capture(); timing.update(state, issued.monotonic, reservation);
    if (badWall !== undefined) wall = badWall;
    if (monoOffset !== undefined) mono = Number.isFinite(monoOffset) ? issued.monotonic + monoOffset : monoOffset;
    wallReads = 0; monoReads = 0;
    expect(timing.dispatch()).toEqual({ allowed: false, reason });
    expect(wallReads).toBe(1); expect(monoReads).toBe(1);
  });
  it('a valid final sample constructs its deadline from those same readings', async () => {
    const s = await f.setup(); const reservation = reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key }));
    const state = await s.journal.supervision({ key: s.input.key, now });
    let mono = s.time.monotonic();
    const timing = new AttemptTime({ wall: () => now, monotonic: () => mono });
    const issued = timing.capture(); timing.update(state, issued.monotonic, reservation); mono += 500;
    expect(timing.dispatch()).toEqual({ allowed: true, operation: { deadline: issued.monotonic + 1000 } });
  });
});
