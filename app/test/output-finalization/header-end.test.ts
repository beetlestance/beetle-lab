import { expect, it } from 'vitest';
import { finalizationFixture } from './fixture.js';

const insert = `INSERT INTO execution_output_finalizations SELECT attempt_id,run_id,organization_id,workspace_id,intent_digest,
 journal_authority,generation,source_digest,manifest_digest,final_agent_seq,retained_payload_bytes,
 maximum_payload_bytes-retained_payload_bytes,run_version,state,outcome,validation_status,reason
 FROM output_finalization_evidence WHERE attempt_id=?`;

it('rejects header2 above verified end1 through the API and native insert with all durable facts unchanged', () => {
  const f = finalizationFixture({ events: 1 }); f.ready();
  const before = f.facts(); const discovery = f.outputs.execute({ kind: 'outputScan', query: { limit: 32 } });
  expect(f.db.prepare('SELECT header_last_seq,final_agent_seq FROM output_finalization_evidence').get())
    .toEqual({ header_last_seq: 2, final_agent_seq: 1 });
  expect(f.cursor()).toMatchObject({ durable_through: 1, ack_confirmed_through: 1, event_count: 1 });
  expect(() => f.finalize()).toThrowError(expect.objectContaining({ code: 'conflict' }));
  expect(f.facts()).toEqual(before);
  expect(() => f.db.prepare(insert).run(f.key.attempt.attemptId)).toThrow('finalization requires exact settled custody');
  expect(f.facts()).toEqual(before);
  expect(f.db.prepare('SELECT count(*) n FROM execution_output_finalizations').get()?.n).toBe(0);
  expect(f.outputs.execute({ kind: 'outputScan', query: { limit: 32 } })).toEqual(discovery);
  expect(f.db.prepare('SELECT output_pending,event_pending FROM execution_records').get())
    .toEqual({ output_pending: 1, event_pending: 1 });
});

it('rejects the contradiction before creating a zero cursor', () => {
  const f = finalizationFixture({ events: 0 }); f.adopt(); f.release({ lastSeq: 2 });
  const before = f.facts();
  expect(() => f.finalize()).toThrowError(expect.objectContaining({ code: 'conflict' }));
  expect(f.db.prepare('SELECT count(*) n FROM event_cursors').get()?.n).toBe(0);
  expect(f.db.prepare('SELECT count(*) n FROM execution_output_finalizations').get()?.n).toBe(0);
  expect(f.facts()).toEqual(before);
});

it('accepts a valid older header2 below verified end3 after the exact event end is fully ACKed', () => {
  const f = finalizationFixture({ events: 3 }); f.ready();
  expect(f.db.prepare('SELECT header_last_seq,final_agent_seq FROM output_finalization_evidence').get())
    .toEqual({ header_last_seq: 2, final_agent_seq: 3 });
  expect(f.finalize()).toMatchObject({ kind: 'finalized', receipt: { finalAgentSeq: 3, state: 'finished' } });
});
