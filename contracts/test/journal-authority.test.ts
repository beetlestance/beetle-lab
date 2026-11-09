import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { validate } from '../src/index.js';

function capabilities() {
  const value: unknown = JSON.parse(readFileSync('contracts/fixtures/valid/capabilities.json', 'utf8'));
  const checked = validate('Capabilities', value);
  if (!checked.ok) throw new Error('Invalid synthetic capabilities');
  return checked.value;
}
const id = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
it('requires a canonical journal authority independently of installation identity', () => {
  const frame = capabilities();
  expect(validate('Capabilities', { ...frame, journalAuthority: id }).ok).toBe(true);
  const { journalAuthority: _authority, ...missing } = frame; void _authority;
  expect(validate('Capabilities', missing).ok).toBe(false);
  for (const journalAuthority of [null, '', 'bad', id.toUpperCase(), `urn:uuid:${id}`]) {
    expect(validate('Capabilities', { ...frame, journalAuthority }).ok).toBe(false);
  }
});
it('distinguishes authority conflict and a scoped missing receipt without treating them as engine outcomes', () => {
  const error = { protocolVersion: '1.0', organizationId: id, workspaceId: id, attemptId: id,
    retry: 'never', issues: [] };
  expect(validate('ProtocolError', { ...error, reason: 'authority_mismatch' }).ok).toBe(true);
  expect(validate('ProtocolError', { ...error, reason: 'attempt_not_found' }).ok).toBe(true);
  const { attemptId: _attempt, ...missing } = error; void _attempt;
  expect(validate('ProtocolError', { ...missing, reason: 'attempt_not_found' }).ok).toBe(false);
  const raw: unknown = JSON.parse(readFileSync('contracts/fixtures/valid/passed-result.json', 'utf8'));
  const result = validate('EngineResult', raw);
  if (!result.ok) throw new Error('Invalid synthetic engine result');
  for (const outcome of ['authority_mismatch', 'attempt_not_found']) {
    expect(validate('EngineResult', { ...result.value, outcome }).ok).toBe(false);
  }
});
