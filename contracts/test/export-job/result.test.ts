import { expect, it, vi } from 'vitest';
import { createStandaloneExportAssignment, captureStandaloneExportResult, sealStandaloneExportResult, verifyStandaloneExportResultSeal, standaloneExportResultSealPreimage,
  verifyEngineResultSeal, validate } from '../../src/index.js';
import { assignment, body as assignmentBody, result, reseal, hash, text } from './fixture.js';
it('matches independent export seal bytes while rejecting performance-result interpretation', async () => {
  const value = await result(); const expected = await text('result.preimage.txt');
  expect(standaloneExportResultSealPreimage(value)).toEqual({ok:true,value:expected}); expect(hash(expected)).toBe((await text('result.sha256')).trim());
  expect(verifyStandaloneExportResultSeal(value,hash)).toEqual({ok:true,value});
  expect(captureStandaloneExportResult(value,await assignment(),hash)).toEqual(value);
  expect(validate('EngineResult',value).ok).toBe(false); expect(verifyEngineResultSeal(value,hash).ok).toBe(false);
  const {seal,...body} = value; expect(sealStandaloneExportResult(body,seal.sealedAt,hash)).toEqual({ok:true,value});
});
it('binds seal timestamp, generation, full task scope, assignment and file identity', async () => {
  const original = await result(); const expected = await assignment();
  for (const patch of [{exportId:'00000000-0000-4000-8000-000000000099'},{attemptId:'00000000-0000-4000-8000-000000000099'},
    {workspaceId:'00000000-0000-4000-8000-000000000099'},{assignmentDigest:'f'.repeat(64)}]) {
    expect(() => captureStandaloneExportResult({...original,...patch},expected,hash)).toThrow();
  }
  expect(verifyStandaloneExportResultSeal({...original,seal:{...original.seal,sealedAt:'2026-01-01T00:00:02.000Z'}},hash).ok).toBe(false);
  expect(validate('StandaloneExportResult',{...original,generation:2}).ok).toBe(false);
  const input = await assignmentBody();
  const changedSource = createStandaloneExportAssignment({...input,source:{...input.source,revisionDigest:'c'.repeat(64)}},hash);
  expect(() => captureStandaloneExportResult(original,changedSource,hash)).toThrow();
});
it('rejects correctly resealed foreign identities at the semantic binding boundary', async () => {
  for (const patch of [{organizationId:'00000000-0000-4000-8000-000000000099'},{attemptId:'00000000-0000-4000-8000-000000000099'},
    {exportId:'00000000-0000-4000-8000-000000000099'},{assignmentDigest:'f'.repeat(64)}]) {
    const value = await reseal(patch); const expected = await assignment(); expect(() => captureStandaloneExportResult(value,expected,hash)).toThrow();
  }
});
it('rejects contradictory known usage, mismatched artifact bytes and future artifact seal time even with a valid content seal', async () => {
  const expected = await assignment(); const value = await result(); if (!value.artifact) throw new Error('Fixture artifact missing');
  for (const patch of [{buildUsage:{bytes:1024,peakBytes:1023}},{buildUsage:{bytes:1024,peakBytes:expected.options.maximumBuildBytes+1}},
    {artifact:{...value.artifact,bytes:1023}},{artifact:{...value.artifact,sealedAt:'2026-01-01T00:00:02.000Z'}}]) {
    const sealed = await reseal(patch); expect(() => captureStandaloneExportResult(sealed,expected,hash)).toThrow();
  }
});
it('keeps failure/cancellation distinct from success and admits no performance verdicts or partial files', async () => {
  const original = await result(); const {seal,...body} = original;
  for (const patch of [{status:'failed',reason:'build_failed',artifact:original.artifact}, {status:'succeeded',artifact:null},
    {status:'cancelled',reason:'build_failed',artifact:null},{outcome:'passed'}, {artifact:{...original.artifact,relativePath:'../file.js'}}]) {
    expect(sealStandaloneExportResult({...body,...patch},seal.sealedAt,hash).ok).toBe(false);
  }
  for (const state of [{status:'failed',reason:'unsupported_secrets'},{status:'cancelled',reason:'cancelled'}]) {
    const value = await reseal({...state,artifact:null,buildUsage:null}); expect(captureStandaloneExportResult(value,await assignment(),hash)).toEqual(value);
  }
});
it('freezes caller-independent output and rejects accessors/digest failure without exposing source messages', async () => {
  const value = await result(); const provider = vi.fn(hash); let accessed = false;
  const accessor = Object.defineProperty({},'version',{enumerable:true,get() {accessed=true; return 1;}});
  expect(verifyStandaloneExportResultSeal(accessor,provider)).toEqual({ok:false,code:'invalid_result'}); expect(accessed).toBe(false); expect(provider).not.toHaveBeenCalled();
  expect(verifyStandaloneExportResultSeal(value,() => {throw new Error('private canary');})).toEqual({ok:false,code:'digest_failed'});
  const verified = verifyStandaloneExportResultSeal(value,hash); if (!verified.ok) throw new Error('Fixture invalid');
  expect(Object.isFrozen(verified.value.artifact)).toBe(true); if (value.artifact) value.artifact.bytes++;
  expect(verified.value.artifact?.bytes).toBe(1024);
});
it.each(['artifact','result'] as const)('rejects non-finite parsed %s timestamps admitted structurally as leap seconds', async field => {
  const original = await result(); const {seal,...body} = original; if (!body.artifact) throw new Error('Fixture artifact missing');
  const value = sealStandaloneExportResult({...body,artifact:{...body.artifact,sealedAt:field === 'artifact' ? '2016-12-31T23:59:60Z' : body.artifact.sealedAt}},
    field === 'result' ? '2016-12-31T23:59:60Z' : seal.sealedAt,hash);
  expect(value.ok).toBe(true); if (!value.ok) throw new Error('Leap-second fixture unexpectedly rejected structurally');
  const expected = await assignment(); expect(() => captureStandaloneExportResult(value.value,expected,hash)).toThrow();
});
