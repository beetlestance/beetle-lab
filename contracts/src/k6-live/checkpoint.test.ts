import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LiveMetricArchivePrefix } from '../api/index.js';
import {
  createK6LiveApproval,
  decodeK6HistoryCheckpoint,
  encodeK6HistoryCheckpoint,
  K6_HISTORY_CHECKPOINT_SLOT_BYTES,
} from './index.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const scope = { organizationId: id(1), workspaceId: id(2), attemptId: id(3), generation: 1 };
const source = { requests: [{ id: 'one', assertions: [] }], targetSampling: { intervalMs: 3000 } };
const assignment = { specDigest: '1'.repeat(64), intentDigest: '2'.repeat(64) };
const approval = createK6LiveApproval({ source, scope, assignment, hash });
const prefix: LiveMetricArchivePrefix = {
  scope,
  windows: 5,
  endTimeMs: 5000,
  data: { artifactId: id(4), relativePath: 'metric-windows.ndjson', bytes: 1024, sha256: hash('data') },
  index: { artifactId: id(5), relativePath: 'metric-index.ndjson', bytes: 256, sha256: hash('index') },
  target: {
    scope,
    samples: 1,
    intervalMs: 3000,
    data: { artifactId: id(6), relativePath: 'target-samples.ndjson', bytes: 256, sha256: hash('target') },
  },
};

describe('k6 history checkpoint slot', () => {
  it('round trips a bounded complete prefix against independent launch approval', () => {
    const bytes = encodeK6HistoryCheckpoint(prefix, approval, hash);
    expect(bytes.byteLength).toBeLessThan(K6_HISTORY_CHECKPOINT_SLOT_BYTES);
    expect(decodeK6HistoryCheckpoint(bytes, approval, hash)).toEqual(prefix);
  });

  it('rejects a torn slot or altered payload', () => {
    const bytes = encodeK6HistoryCheckpoint(prefix, approval, hash);
    for (const end of [32, bytes.length - 66, bytes.length - 1]) {
      expect(decodeK6HistoryCheckpoint(bytes.subarray(0, end), approval, hash)).toBeUndefined();
    }
    const text = new TextDecoder().decode(bytes);
    expect(
      decodeK6HistoryCheckpoint(new TextEncoder().encode(text.replace('"windows":5', '"windows":4')), approval, hash),
    ).toBeUndefined();
  });

  it('rejects mismatched launch, target interval or metric selection', () => {
    const bytes = encodeK6HistoryCheckpoint(prefix, approval, hash);
    for (const expected of [
      createK6LiveApproval({ source, scope, assignment: { ...assignment, specDigest: '3'.repeat(64) }, hash }),
      { ...approval, targetIntervalMs: 4000 },
      { ...approval, scope: { ...scope, generation: 2 } },
      { ...approval, subset: { ...approval.subset, excludedSeries: approval.subset.excludedSeries + 1 } },
    ]) {
      expect(decodeK6HistoryCheckpoint(bytes, expected, hash)).toBeUndefined();
    }
  });

  it('rejects duplicate artifact identities across lanes and scope mismatches', () => {
    expect(() =>
      encodeK6HistoryCheckpoint(
        { ...prefix, index: { ...prefix.index, artifactId: prefix.data.artifactId } },
        approval,
        hash,
      ),
    ).toThrow();
    expect(() =>
      encodeK6HistoryCheckpoint({ ...prefix, scope: { ...scope, attemptId: id(7) } }, approval, hash),
    ).toThrow();
  });
});
