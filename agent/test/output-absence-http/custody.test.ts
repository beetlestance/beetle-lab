import { expect, it } from 'vitest';
import { deferred, server, get, proof, path, turns } from './fixtures.js';

it('shares the two source originals and retains aborted service credit and shutdown drain until original settles', async () => {
  const held = deferred<ReturnType<typeof proof> | null>(); const entered = deferred<void>(); let reads = 0;
  const app = server({ absences: { readOutputAbsence: async () => { if (++reads === 2) entered.resolve(); return held.promise; } } });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const one = get(origin); const two = get(origin, path);
  const outcomes = [one.result.catch(() => undefined), two.result.catch(() => undefined)];
  await entered.promise;
  one.req.destroy(); await turns();
  const third = await get(origin).result;
  expect(third.status).toBe(429); expect(reads).toBe(2);
  let closed = false; const closing = app.close().then(() => { closed = true; });
  await turns(); expect(closed).toBe(false);
  held.resolve(proof()); await Promise.all([...outcomes, closing]); expect(closed).toBe(true);
});
