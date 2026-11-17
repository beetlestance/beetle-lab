import { expect, it } from 'vitest';
import {
  captureHistoryJobRow,
  captureHistorySummaryRow,
} from '../../../src/adapters/outbound/sqlite/run-history/rows.js';
import { uuid, scope } from '../fixture.js';
const job = {
  id: uuid(70),
  organization_id: scope.organizationId,
  workspace_id: scope.workspaceId,
  active_attempt_id: uuid(170),
  state: 'finished',
  history_summary_due_ms: 1000,
  history_summary_json: null,
  manifest_digest: null,
  source_digest: null,
  proof_digest: null,
};
it('captures valid pending history metadata', () => {
  expect(captureHistoryJobRow(job)).toEqual(job);
});
it.each([
  { state: 'unknown' },
  { id: 'invalid' },
  { history_summary_due_ms: '0' },
  { history_summary_due_ms: 9007199254740992 },
  { manifest_digest: 'invalid' },
  { manifest_digest: 'a'.repeat(64), source_digest: null },
  { history_summary_json: '{}' },
  { history_summary_json: Buffer.from('{}') },
])('refuses corrupt history job facts %j', (amendment) => {
  expect(() => captureHistoryJobRow({ ...job, ...amendment })).toThrow();
});
const summary = {
  id: uuid(70),
  active_attempt_id: uuid(170),
  history_summary_json: null,
  cleanup_bytes: 200,
  charged_bytes: 100,
  metadata_bytes: 10,
  source_refund: 20,
  absence_refund: null,
};
it('validates nullable accounting cells before arithmetic can mask corruption', () => {
  expect(captureHistorySummaryRow(summary)).toEqual(summary);
  for (const amendment of [
    { charged_bytes: -1, source_refund: -1 },
    { cleanup_bytes: '200' },
    { metadata_bytes: null },
    { absence_refund: 0 },
    { charged_bytes: 0, source_refund: 100 },
    { cleanup_bytes: 9007199254740992 },
  ]) {
    expect(() => captureHistorySummaryRow({ ...summary, ...amendment })).toThrow();
  }
});
