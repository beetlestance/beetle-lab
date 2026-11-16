import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson, sealEngineResult } from '@beetle/contracts';
import type { Artifact } from '@beetle/contracts';
import { prepareOutputManifest } from '@beetle/contracts/output-source';
import { fixture, artifact } from '../storage/output-custody-fixtures.js';
import { hash } from '../storage/output-payload-fixtures.js';
import { scope, uuid } from '../storage/fixture.js';
export { scope, uuid } from '../storage/fixture.js';
export { fixture } from '../storage/output-custody-fixtures.js';
export const keyFor = (id: string) => ({ scope, id });
export function guardsOff(db: DatabaseSync, table: string): void {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=? LIMIT 64").all(table);
  for (const row of rows) {
    if (typeof row.name !== 'string' || !/^[a-z0-9_]+$/.test(row.name)) throw new Error('Unsafe synthetic trigger');
    db.exec(`DROP TRIGGER ${row.name}`);
  }
}
/** A valid source whose public snapshot crosses the ordinary 64KiB lane. */
export function largeFixture() {
  const f = fixture(100000);
  const artifacts: Artifact[] = Array.from({ length: 128 }, (_, i) => ({ ...artifact,
    artifactId: uuid(1000 + i), relativePath: `synthetic-${i}-${'x'.repeat(180)}`, bytes: 1 }));
  const base = f.manifest(artifacts);
  const remaining = 65400 - Buffer.byteLength(encodeCanonicalJson(base.result, 65536));
  for (let i = 0; i < remaining; i++) artifacts[i % artifacts.length]!.relativePath += 'x';
  const { seal, ...body } = base.result;
  const sealed = sealEngineResult({ ...body, artifacts }, seal.sealedAt, hash);
  if (!sealed.ok) throw new Error('Invalid synthetic large result');
  const manifest = prepareOutputManifest({ version: 1, binding: base.binding, result: sealed.value,
    resultFileBytes: base.resultFileBytes, controlBytes: base.controlBytes, verifiedBytes: base.verifiedBytes }, hash);
  const envelope = { ...f.envelope, manifest, closure: { ...f.envelope.closure,
    receipt: { ...f.envelope.closure.receipt, manifestDigest: manifest.manifestDigest } } };
  return { ...f, envelope };
}
