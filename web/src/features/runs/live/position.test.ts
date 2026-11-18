import { expect, it } from 'vitest';
import { positions } from './stream.js';
import { emptyHistory } from './history.js';
import { liveRun } from './fixtures.js';
it('keeps missing, future and browser-unparseable starts unknown instead of zero or NaN', () => {
  const now=Date.parse('2026-12-31T23:59:59Z');
  for(const startedAt of [null,'2026-12-31T23:59:60Z','2027-01-01T00:00:00Z']){
    const value=positions(liveRun({startedAt}),{history:emptyHistory(startedAt),now});
    expect(value.elapsedMs).toBeNull();
  }
  const startedAt='2026-12-31T23:59:58Z';
  expect(positions(liveRun({startedAt}),{history:emptyHistory(startedAt),now}).elapsedMs).toBe(1000);
});
