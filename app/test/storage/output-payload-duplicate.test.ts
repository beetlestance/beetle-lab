import { executionArtifacts } from '@beetle/contracts';
import { expect, it } from 'vitest';
import type { Artifact } from '@beetle/contracts';
import { verifyEngineResultSeal } from '@beetle/contracts';
import { verifyOutputManifest } from '@beetle/contracts/output-source';
import { payloadFixture, hash, json } from './output-payload-fixtures.js';
const artifact: Artifact = { artifactId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'raw', relativePath: 'data.bin',
  bytes: 50_000, sha256: 'b'.repeat(64), sealedAt: '2026-01-01T00:00:00Z' };

it.each(['artifacts array', 'artifact bytes', 'result swap'] as const)('refuses native duplicate %s despite a valid last-key sealed manifest', mode => {
  const f = payloadFixture(10000); const manifest = f.manifest([artifact]); const canonical = json(manifest);
  const raw = mode === 'artifacts array' ? canonical.replace('"artifacts":', '"artifacts":[],"artifacts":')
    : mode === 'artifact bytes' ? canonical.replace('"bytes":50000', '"bytes":0,"bytes":50000')
      : canonical.replace('"result":', '"result":' + json(f.value) + ',"result":');
  expect(raw).not.toBe(canonical);
  const parsed: unknown = JSON.parse(raw); expect(verifyOutputManifest(parsed, hash)).toEqual(manifest);
  expect(executionArtifacts(manifest.result)[0]!.bytes).toBe(50000);
  expect(Buffer.byteLength(raw)).toBeLessThan(10000);
  const first = f.db.prepare("SELECT coalesce((SELECT sum(json_extract(value,'$.bytes')) FROM json_each(?,'$.result.artifacts')),0) AS n").get(raw);
  expect(first?.n).toBe(0); expect(Buffer.byteLength(raw) + artifact.bytes).toBeGreaterThan(10000);
  if (mode === 'result swap') f.observe({ lastSeq: 2, result: f.value });
  const before = f.facts();
  const issue = () => mode === 'result swap'
    ? f.db.prepare("UPDATE execution_output_payloads SET kind='manifest',canonical_json=? WHERE attempt_id=?").run(raw, f.key.attempt.attemptId)
    : f.db.prepare("INSERT INTO execution_output_payloads VALUES(?,'manifest',?)").run(f.key.attempt.attemptId, raw);
  expect(issue).toThrow(); expect(f.facts()).toEqual(before); expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it.each(['insert', 'update'] as const)('accepts valid %s with repeated field names in distinct artifact objects and charges their exact sum', mode => {
  const f = payloadFixture(); const manifest = f.manifest([{ ...artifact, bytes: 32 },
    { ...artifact, artifactId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', relativePath: 'other.bin', bytes: 48 }]);
  expect(verifyOutputManifest(manifest, hash)).toEqual(manifest);
  if (mode === 'update') {
    const sealed = verifyEngineResultSeal(manifest.result, hash); if (!sealed.ok) throw new Error('Invalid real fixture seal');
    f.observe({ lastSeq: 2, result: sealed.value });
    f.db.prepare("UPDATE execution_output_payloads SET kind='manifest',canonical_json=?").run(json(manifest));
  } else f.db.prepare("INSERT INTO execution_output_payloads VALUES(?,'manifest',?)").run(f.key.attempt.attemptId, json(manifest));
  expect(f.db.prepare('SELECT body_bytes,artifact_bytes FROM execution_output_charges').get())
    .toEqual({ body_bytes: Buffer.byteLength(json(manifest)), artifact_bytes: 80 });
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it.each(['malformed', 'oversized', 'blob'] as const)('rejects %s carrier with its bounded gate before native tree/identity parsing', mode => {
  const f = payloadFixture(); const canonical = json(f.manifest());
  const input = mode === 'malformed' ? '{"result":' : mode === 'oversized' ? ' '.repeat(73728) + canonical : Buffer.from(canonical);
  const before = f.facts();
  expect(() => f.db.prepare("INSERT INTO execution_output_payloads VALUES(?,'manifest',?)").run(f.key.attempt.attemptId, input))
    .toThrow('invalid bounded unique output JSON');
  expect(f.facts()).toEqual(before); expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
