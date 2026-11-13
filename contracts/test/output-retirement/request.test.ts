import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import source from '../../fixtures/valid/output-retirement-source.json' with { type: 'json' };
import absence from '../../fixtures/valid/output-retirement-absence.json' with { type: 'json' };
import { captureOutputRetirementRequest, outputRetirementDigest, OUTPUT_RETIREMENT_REQUEST_BYTES } from '../../src/output-retirement/index.js';
import { encodeCanonicalJson } from '../../src/json.js';
const digest = (input: string) => createHash('sha256').update(input).digest('hex');
it.each([source, absence])('captures a closed bounded $closure.kind request without native authority', input => {
  const copy = structuredClone(input); const value = captureOutputRetirementRequest(copy);
  expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.closure)).toBe(true);
  copy.closure.finalAgentSeq = 8; expect(value.closure.finalAgentSeq).toBe(input.closure.finalAgentSeq);
  expect(Buffer.byteLength(encodeCanonicalJson(value, OUTPUT_RETIREMENT_REQUEST_BYTES))).toBeLessThanOrEqual(OUTPUT_RETIREMENT_REQUEST_BYTES);
  expect(value).not.toHaveProperty('path'); expect(value).not.toHaveProperty('native'); expect(value).not.toHaveProperty('cleaned');
});
it.each([{ purpose: 'standalone_export' }, { generation: 2 }, { deletionVersion: 2 }, { path: '/wrong' },
  { closure: { ...source.closure, finalAgentSeq: -1 } }, { closure: { ...source.closure, finalAgentSeq: 1.5 } },
  { closure: { ...source.closure, finalAgentSeq: Number.MAX_SAFE_INTEGER + 1 } },
  { closure: { ...source.closure, unexpected: true } }, { closure: { kind: 'missing' } },
  { closure: { ...absence.closure, proofDigest: 'X'.repeat(64) } }])('rejects malformed or authority-claiming patch %#', patch => {
  expect(() => captureOutputRetirementRequest({ ...source, ...patch })).toThrow();
});
it('requires canonical backend IDs while preserving exact original and physical-authority spelling', () => {
  for (const field of ['runId', 'deletionId'] as const) expect(() => captureOutputRetirementRequest({ ...source, [field]: source[field].toUpperCase() })).toThrow();
  const upper = { ...source, organizationId: source.organizationId.toUpperCase(), journalAuthority: source.journalAuthority.toUpperCase() };
  expect(captureOutputRetirementRequest(upper).journalAuthority).toBe(upper.journalAuthority);
  expect(outputRetirementDigest(upper, digest)).not.toBe(outputRetirementDigest(source, digest));
});
it('bounds capture and rejects accessors before invoking them', () => {
  expect(() => captureOutputRetirementRequest({ ...source, padding: 'x'.repeat(OUTPUT_RETIREMENT_REQUEST_BYTES) })).toThrow();
  let invoked = false; const copy = structuredClone(source);
  Object.defineProperty(copy.closure, 'sourceDigest', { enumerable: true, get() { invoked = true; throw new Error('Unexpected getter'); } });
  expect(() => captureOutputRetirementRequest(copy)).toThrow(); expect(invoked).toBe(false);
});
it('binds the complete request with order-independent canonical hashing and validates the trusted hasher output', () => {
  const reverse = Object.fromEntries(Object.entries(source).reverse());
  expect(outputRetirementDigest(reverse, digest)).toBe(outputRetirementDigest(source, digest));
  expect(outputRetirementDigest(absence, digest)).not.toBe(outputRetirementDigest(source, digest));
  expect(() => outputRetirementDigest(source, () => 'bad')).toThrow();
  expect(() => outputRetirementDigest(source, () => { throw new Error('Synthetic hash failure'); })).toThrow('Synthetic hash failure');
});
