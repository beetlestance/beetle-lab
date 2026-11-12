import { expect, it } from 'vitest';
import { RunArtifacts, captureArtifactReadReply } from '../../src/adapters/outbound/sqlite/run-artifacts/index.js';
import { published } from './fixture.js';
import { scope, uuid } from '../storage/fixture.js';
it('binds the bounded private format reply to the exact published record and rejects malformed envelopes', async () => {
  const f = await published([Buffer.from('report\n')], ['performance-report']);
  try {
    const operation = {kind: 'getRunArtifact' as const, key: {id: f.key.runId, scope,
      attemptId: f.key.attempt.attemptId, artifactId: f.envelope.manifest.result.artifacts[0]!.artifactId}};
    const reader = new RunArtifacts(f.db, f.reads); const captured = captureArtifactReadReply(operation, reader.execute(operation));
    if (!('record' in captured)) throw new Error('Wrong reply fixture');
    expect(captured.kind).toBe('performance-report'); expect(Object.keys(captured.record).sort()).toEqual(['artifact', 'binding']);
    for (const input of [{record: captured.record}, {...captured, extra: true}, {...captured, kind: 'text/html\r\nheader'},
      {...captured, record: {...captured.record, kind: captured.kind}},
      {...captured, record: {...captured.record, artifact: {...captured.record.artifact, artifactId: uuid(999)}}}]) {
      expect(() => captureArtifactReadReply(operation, input)).toThrow();
    }
  } finally {await f.files.dispose();}
});
