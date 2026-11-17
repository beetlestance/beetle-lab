import assert from 'node:assert/strict';
import { record } from '../../resources/values.js';
import { cases } from '../parity/config.js';
import { expectations } from '../parity/result.js';
import { array, count, result, terminal } from './values.js';
function engine(input: unknown, profile: string) {
  const expected = cases(profile);
  return array(input, expected.length).map((value, index) => {
    const row = record(value);
    const kind = expected[index]!;
    assert.equal(row.kind, kind);
    const wanted = expectations(kind);
    return { kind, run: terminal(row.run, wanted.outcome), result: result(row.result, wanted) };
  });
}
function requests(input: unknown) {
  const rows = record(input);
  const counts = record(rows.finalCounts);
  assert.deepEqual(counts.methods, { GET: 4, POST: 4, PUT: 4, PATCH: 4, DELETE: 4 });
  assert.equal(counts.ready, 3);
  assert.equal(counts.malformed, 3);
  assert.equal(counts.rejected, 0);
  assert.equal(counts.total, 26);
  const runs = ['methods-data-assertions', 'malformed-response'].map((kind, index) => {
    const row = record(rows[kind]);
    const expected = index ? 'failed' : 'passed';
    const envelope = record(row.result);
    const actual = record(envelope.result);
    if (!index) assert.deepEqual(actual.requiredAssertions, { required: 50, passed: 50, failed: 0, unknown: 0 });
    return {
      kind,
      run: terminal(row.run, expected),
      result: result(actual, { outcome: expected, exitCode: index ? 99 : 0 }),
    };
  });
  return {
    runs,
    methods: { GET: 4, POST: 4, PUT: 4, PATCH: 4, DELETE: 4 },
    ready: 3,
    malformed: 3,
    rejected: 0,
    total: 26,
  };
}
function parallel(input: unknown, profile: string) {
  const row = record(input);
  const target = record(row.target);
  const work = record(target.work);
  assert.equal(target.ready, 2);
  assert.equal(target.unexpected, 0);
  assert.equal(record(work.shared).count, 40);
  assert.equal(record(work.pervu).count, 40);
  assert.equal(record(work.arrival).count, 0);
  const runs = array(row.completed, 2).map((value) => {
    const item = record(value);
    return terminal(item.run, 'passed');
  });
  if (profile === 'isolated') assert.equal(row.noExecutionOverlap, true);
  return {
    runs,
    ready: 2,
    sharedRequests: 40,
    perVuRequests: 40,
    overflowRequests: 0,
    noExecutionOverlap: profile === 'isolated',
    clientRequests: count(row.clientRequests, 1024),
  };
}
export function shortFacts(id: string, input: unknown) {
  if (id.startsWith('engine-')) return { cases: engine(input, id.slice(7)) };
  if (id === 'requests-data') return requests(input);
  assert(id.startsWith('parallel-'));
  return parallel(input, id.slice(9));
}
