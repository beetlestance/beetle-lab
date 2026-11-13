import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { cleanupControl } from '../../src/cleanup-control/index.js';
import { loseReply } from '../source-journal/fixtures.js';
import { retirementFixture } from './fixtures.js';
const f = retirementFixture();
it('preflights without fencing, persists exact intent across lost reply/reopen and retains all charges', async () => {
  const value = await f.ready(); let journal = value.journal;
  expect(await journal.retirements.isOpen(value.key)).toBe(true);
  const expected = await journal.retirements.preflight(value.request);
  expect(await journal.retirements.read(value.key)).toBeNull();
  const committed = await loseReply(journal, () => journal.retirements.begin(value.request));
  await journal.retirements.settleCarrier(); journal = await f.open(value.path);
  expect(committed).toEqual(expected); expect(expected.task).toEqual({ state: 'none' });
  expect(await journal.retirements.isOpen(value.key)).toBe(false);
  expect(await journal.retirements.read(value.key)).toEqual(expected);
  expect(await journal.retirements.begin(value.request)).toEqual(expected);
  await journal.prune(value.key);
  expect(await journal.retirements.begin(value.request)).toEqual(expected);
  await f.close(journal); const db = new DatabaseSync(value.path, { readOnly: true });
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(18);
    expect(db.prepare('SELECT cleanup_control_bytes FROM accepted_attempts').get()?.cleanup_control_bytes).toBe(cleanupControl.reservedBytes);
    expect(db.prepare('SELECT phase FROM disk_holds').get()?.phase).toBe('retained');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('rejects stale closure, authority, scope and missing final ACK before persistence', async () => {
  const v = await f.ready(false);
  await expect(v.journal.retirements.begin(v.request)).rejects.toMatchObject({ code: 'conflict' });
  await v.journal.acknowledge({ protocolVersion: '1.0', ...v.key, throughSeq: v.proof.finalAgentSeq });
  await expect(v.journal.retirements.preflight({ ...v.request, journalAuthority: '00000000-0000-4000-8000-000000000099' }))
    .rejects.toMatchObject({ code: 'conflict' });
  await expect(v.journal.retirements.begin({ ...v.request, closure: { ...v.request.closure, proofDigest: 'f'.repeat(64) } }))
    .rejects.toMatchObject({ code: 'conflict' });
  await expect(v.journal.retirements.read({ ...v.key, workspaceId: '00000000-0000-4000-8000-000000000099' }))
    .rejects.toMatchObject({ code: 'not_found' });
  expect(await v.journal.retirements.read(v.key)).toBeNull();
});
it('pins first backend deletion binding, refuses late events with typed conflict and leaves observations usable', async () => {
  const v = await f.ready(); await v.journal.retirements.begin(v.request);
  await expect(v.journal.retirements.begin({ ...v.request, deletionId: v.request.runId })).rejects.toMatchObject({ code: 'conflict' });
  const late = f.supervisor(2); late.event = { ...late.event, ...v.key };
  await expect(v.journal.appendSupervisor(late)).rejects.toMatchObject({ code: 'conflict' });
  expect(await v.journal.readOutputAbsence(v.key)).toEqual(v.proof);
  expect(await v.journal.retirements.isOpen(v.key)).toBe(false);
});
