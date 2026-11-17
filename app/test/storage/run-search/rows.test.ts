import { expect, it } from 'vitest';
import {
  captureHistoryKey,
  capturePrefixKey,
  captureSearchCandidate,
  captureSearchDocument,
  captureSearchProgress,
} from '../../../src/adapters/outbound/sqlite/run-search/rows.js';
import { uuid } from '../fixture.js';
const key = { id: uuid(70), requested_at: '2026-11-09T00:00:00.000Z' };
it('validates history cursor fields before comparison', () => {
  expect(captureHistoryKey(key)).toEqual(key);
  expect(() => captureHistoryKey({ ...key, id: 'invalid' })).toThrow();
  expect(() => captureHistoryKey({ ...key, requested_at: 'invalid' })).toThrow();
  expect(() => captureHistoryKey({ ...key, requested_at: Buffer.from(key.requested_at) })).toThrow();
});
it('validates prefix filter fields before excluding candidate rows', () => {
  const row = { ...key, suite_id: uuid(50), state: 'queued', outcome: 'pending' };
  expect(capturePrefixKey(row)).toEqual(row);
  expect(() => capturePrefixKey({ ...row, state: 'unknown' })).toThrow();
  expect(() => capturePrefixKey({ ...row, outcome: undefined })).toThrow();
  expect(() => capturePrefixKey({ ...row, suite_id: 'invalid' })).toThrow();
});
it('refuses unknown posting kinds and mismatched folded document names', () => {
  expect(() => captureSearchCandidate({ kind: 'unknown', entity_id: uuid(50) })).toThrow();
  expect(() => captureSearchCandidate({ kind: 'suite', entity_id: 'invalid' })).toThrow();
  expect(captureSearchDocument({ id: uuid(50), name: 'Ｆoo', folded_name: 'foo' }).folded_name).toBe('foo');
  expect(() => captureSearchDocument({ id: uuid(50), name: 'Foo', folded_name: 'other' })).toThrow();
  expect(() => captureSearchDocument({ id: uuid(50), name: 'Foo', folded_name: Buffer.from('foo') })).toThrow();
});
it('does not collapse malformed index progress flags into booleans', () => {
  const row = { folder_after: '', suite_after: '', folders_done: 0, suites_done: 1 };
  expect(captureSearchProgress(row)).toEqual(row);
  expect(() => captureSearchProgress({ ...row, folders_done: 2 })).toThrow();
  expect(() => captureSearchProgress({ ...row, suites_done: '0' })).toThrow();
  expect(() => captureSearchProgress({ ...row, folder_after: 'invalid' })).toThrow();
});
