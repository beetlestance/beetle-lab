import { expect, it } from 'vitest';
import header from '../fixtures/valid/recovery-header.json' with {type: 'json'};
import { captureRecoveryRecord, decodeRecoveryLine, encodeRecoveryLine, RecoveryManifest } from '../src/recovery/index.js';
const hash = 'a'.repeat(64);
function populated() {
  const parser = new RecoveryManifest(); parser.accept(header);
  for (const path of ['backend','agent','agent/journal','config']) parser.accept({kind: 'directory', path});
  for (const path of Object.values(header.roles)) if (path) parser.accept({kind: 'file', path, bytes: 1, sha256: hash});
  return parser;
}
it('roundtrips canonical bounded records and validates complete role/count ownership', () => {
  const bytes = encodeRecoveryLine(header); expect(decodeRecoveryLine(bytes.subarray(0, -1))).toEqual(header);
  const parser = populated(); parser.accept({kind: 'footer', files: 4, directories: 4, bytes: 4});
  expect(parser.finish()).toMatchObject({files: 4, directories: 4, bytes: 4});
});
it.each(['../escape','a/../b','/absolute','a//b','a\\b','a/./b','UPPER','a/'.repeat(33)+'z'])('refuses unsafe or ambiguous path %s', path => {
  expect(() => captureRecoveryRecord({kind: 'file', path, bytes: 1, sha256: hash})).toThrow('Recovery format rejected');
});
it('refuses truncation, duplicate paths, missing parents and sticky parser failures', () => {
  expect(() => populated().finish()).toThrow();
  const duplicate = populated(); expect(() => duplicate.accept({kind: 'directory', path: 'backend'})).toThrow();
  expect(() => duplicate.accept({kind: 'footer', files: 4, directories: 4, bytes: 4})).toThrow();
  const parent = new RecoveryManifest(); parent.accept(header);
  expect(() => parent.accept({kind: 'file', path: 'missing/file', bytes: 1, sha256: hash})).toThrow();
});
it('rejects noncanonical/invalid UTF8, raw unknown fields and oversized lines', () => {
  for (const bytes of [new Uint8Array(8192), Uint8Array.of(255), new TextEncoder().encode(JSON.stringify(header))]) {
    expect(() => decodeRecoveryLine(bytes)).toThrow();
  }
  expect(() => captureRecoveryRecord({...header, raw: 'secret'})).toThrow();
});
