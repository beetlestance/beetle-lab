import { expect, it } from 'vitest';
import { deliveryFixture, inspect, loseReply } from './fixtures.js';
const f = deliveryFixture();

it('withholds a real post-COMMIT worker close reply and recovers the same closure/charge after abort and reopen', async () => {
  const e = await f.ready(); const committed = await loseReply(e.journal, () => e.journal.closeOutputDelivery(e.receipt));
  const before = inspect(e.path);
  const settings = before.rows.find(row => row.table === 'admission_settings')!.rows[0]!;
  expect(typeof settings.observation_json).toBe('string'); settings.observation_json = null;
  const journal = await f.open(e.path);
  expect(await journal.readOutputDelivery(e.key)).toEqual(committed);
  expect(await journal.closeOutputDelivery(e.receipt)).toEqual(committed);
  await f.close(journal); expect(inspect(e.path)).toEqual(before);
  expect(before.rows.find(row => row.table === 'output_delivery_closures')!.rows).toHaveLength(1);
  expect(before.foreignKeys).toEqual([]);
});
