import { createHash } from 'node:crypto';
import { encodeLiveMetricHistory, liveMetricSubsetText } from '@beetle/contracts/api';
import { createK6LiveApproval } from '@beetle/contracts/k6-live';
import type { absenceFixture } from './fixture.js';
import { uuid } from '../storage/fixture.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
type Fixture = ReturnType<typeof absenceFixture>;
export function observed(f: Fixture) {
  const { organizationId, workspaceId, attemptId, generation } = f.binding.key.attempt;
  const scope = { organizationId, workspaceId, attemptId, generation };
  const approval = createK6LiveApproval({
    source: { requests: [{ id: 'example', assertions: [] }] },
    scope,
    assignment: { specDigest: hash('spec'), intentDigest: f.binding.key.attempt.intentDigest },
    hash,
  });
  const history = {
    scope,
    producerEpoch: approval.producerEpoch,
    subset: approval.subset,
    subsetDigest: hash(liveMetricSubsetText(approval.subset)),
    prefix: {
      scope,
      windows: 1,
      endTimeMs: 1000,
      data: { artifactId: uuid(100), relativePath: 'metric-windows.ndjson', bytes: 128, sha256: hash('data') },
      index: { artifactId: uuid(101), relativePath: 'metric-index.ndjson', bytes: 128, sha256: hash('index') },
    },
    sampled: false,
    samples: [{ sequence: 1, startTimeMs: 0, endTimeMs: 1000, series: [] }],
  };
  const json = Buffer.from(encodeLiveMetricHistory(history, hash, scope)).toString();
  return { json, digest: hash(json), bytes: Buffer.byteLength(json) };
}
