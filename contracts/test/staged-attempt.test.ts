import { expect, it } from 'vitest';
import { encodeJson, validate } from '../src/index.js';
import type { StagedAttempt } from '../src/index.js';

function fixture(): StagedAttempt {
  return { protocolVersion: '1.0', organizationId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002', attemptId: '00000000-0000-4000-8000-000000000003',
    generation: 1, intentDigest: 'a'.repeat(64), specDigest: 'b'.repeat(64), offerSha256: 'c'.repeat(64),
    manifestSha256: 'd'.repeat(64), deadlineMs: 1_800_000_000_000, stagingPolicyVersion: 1,
    inputFiles: [{ inputId: '00000000-0000-4000-8000-000000000004', fileName: 'input-000.bin' }],
    secretNames: ['SYNTHETIC_TOKEN'] };
}

it('defines a bounded language-neutral staging manifest without paths or resolved credentials', () => {
  expect(validate('StagedAttempt', fixture()).ok).toBe(true);
  const maximum = fixture();
  maximum.inputFiles = Array.from({ length: 128 }, (_, index) => ({
    inputId: `urn:uuid:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    fileName: `input-${String(index).padStart(3, '0')}.bin` }));
  maximum.secretNames = Array.from({ length: 64 }, (_, index) => `${index}${'x'.repeat(126)}`.slice(0, 128));
  expect(validate('StagedAttempt', maximum).ok).toBe(true);
  expect(Buffer.byteLength(encodeJson(maximum, 65536))).toBeLessThan(65536);
});

it.each(['../outside', '/beetle/input/file', 'inputs/input-000.bin', 'input-0.bin', 'input-0000.bin', 'input-000.bin\n'])(
  'rejects non-basename input mapping %s', fileName => {
    const value = fixture(); value.inputFiles[0]!.fileName = fileName;
    expect(validate('StagedAttempt', value).ok).toBe(false);
  });

it('rejects unknown authority, extra data, unsafe deadlines and over-limit collections', () => {
  expect(validate('StagedAttempt', { ...fixture(), stagingPolicyVersion: 2 }).ok).toBe(false);
  expect(validate('StagedAttempt', { ...fixture(), secretValues: { SYNTHETIC_TOKEN: 'MUST_NOT_STAGE_METADATA' } }).ok).toBe(false);
  for (const deadlineMs of [-1, 1.5, 8_640_000_000_000_001, Infinity]) {
    expect(validate('StagedAttempt', { ...fixture(), deadlineMs }).ok).toBe(false);
  }
  const value = fixture(); value.inputFiles = Array.from({ length: 129 }, () => value.inputFiles[0]!);
  expect(validate('StagedAttempt', value).ok).toBe(false);
  expect(validate('StagedAttempt', { ...fixture(), secretNames: ['duplicate', 'duplicate'] }).ok).toBe(false);
  expect(validate('StagedAttempt', { ...fixture(), secretNames: ['../outside'] }).ok).toBe(false);
});
