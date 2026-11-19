import { expect, it } from 'vitest';
import { encodeLiveMetricHistory } from '@beetle/contracts/api';
import fixture from '../../../contracts/fixtures/api/valid/live-metric-history.json' with { type: 'json' };
import type { Scope } from '../../src/admission/index.js';
import { initialize } from '../../src/journal/schema.js';
import { Store } from '../../src/journal/store.js';
import { owner, quotaUsed } from '../../src/journal/sql.js';
import { sourceFixture, hash, json as canonical } from '../source-journal/fixtures.js';

const f = sourceFixture();

function observation(scope: Scope) {
  const history = { ...fixture, scope, prefix: { ...fixture.prefix, scope } };
  return new TextDecoder().decode(encodeLiveMetricHistory(history, hash, scope));
}

async function ready(interrupted = true) {
  const e = await f.seed(f.path(), undefined, interrupted);
  await e.journal.beginOutputCollection(e.intent);
  const receipt = await e.journal.commitOutputSource(e.collected);
  await e.journal.releaseOutputSource(receipt);
  return { ...e, receipt };
}

it('retains the verified-prefix record with the exact delivery closure across reopen', async () => {
  const e = await ready();
  expect(await e.journal.readStoppedDeliveryClosure(e.key)).toBeNull();
  const json = observation(e.key);
  const delivery = await e.journal.closeOutputDelivery(e.receipt, json);
  const expected = { delivery, observation: { json, digest: hash(json), bytes: Buffer.byteLength(json) } };
  expect(await e.journal.readStoppedDeliveryClosure(e.key)).toEqual(expected);
  await f.close(e.journal);
  const reopened = await f.open(e.path);
  expect(await reopened.readStoppedDeliveryClosure(e.key)).toEqual(expected);
  expect(await reopened.closeOutputDelivery(e.receipt, observation(e.key))).toEqual(delivery);
  await expect(reopened.readStoppedDeliveryClosure({ ...e.key, workspaceId: e.key.attemptId })).rejects.toMatchObject({
    code: 'not_found',
  });
});

it('keeps existing delivery closures immutable and rejects observations on complete sources', async () => {
  const partial = await ready();
  const old = await partial.journal.closeOutputDelivery(partial.receipt);
  expect(await partial.journal.closeOutputDelivery(partial.receipt, observation(partial.key))).toEqual(old);
  expect(await partial.journal.readStoppedDeliveryClosure(partial.key)).toEqual({ delivery: old, observation: null });

  const complete = await ready(false);
  const sealed = await complete.journal.closeOutputDelivery(complete.receipt, observation(complete.key));
  expect(await complete.journal.readStoppedDeliveryClosure(complete.key)).toEqual({
    delivery: sealed,
    observation: null,
  });
});

it('closes delivery without a history row when journal headroom is one byte short', async () => {
  const e = await ready();
  const finalAgentSeq = (await e.journal.get(e.key)).lastSeq;
  await f.close(e.journal);
  const db = initialize(e.path);
  try {
    const delivery = { version: 1, receipt: e.receipt, finalAgentSeq };
    const history = observation(e.key);
    const needs = Buffer.byteLength(canonical(delivery)) + Buffer.byteLength(history) + 512;
    db.prepare('UPDATE accepted_attempts SET quota_bytes=?').run(quotaUsed(owner(db, e.key)) + needs - 1);
    const store = new Store(db);
    expect(
      store.execute({ kind: 'outputDeliveryClose', id: 1, json: canonical(e.receipt), stoppedHistory: history }),
    ).toEqual(delivery);
    expect(store.execute({ kind: 'outputDeliveryHistoryRead', id: 2, key: e.key })).toEqual({
      delivery,
      observation: null,
    });
  } finally {
    db.close();
  }
});

it('rolls back the source closure and quota marker if writing recovered history fails', async () => {
  const e = await ready();
  await f.close(e.journal);
  const db = initialize(e.path);
  try {
    db.exec(`CREATE TRIGGER fail_supplement AFTER INSERT ON stopped_delivery_observations
      BEGIN SELECT RAISE(ABORT,'synthetic checkpoint persistence failure'); END;`);
    const store = new Store(db);
    const before = owner(db, e.key);
    expect(() =>
      store.execute({
        kind: 'outputDeliveryClose',
        id: 1,
        json: canonical(e.receipt),
        stoppedHistory: observation(e.key),
      }),
    ).toThrow();
    expect(store.execute({ kind: 'outputDeliveryHistoryRead', id: 2, key: e.key })).toBeNull();
    expect(owner(db, e.key)).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    db.close();
  }
});
