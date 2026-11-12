import { expect, expectTypeOf, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createStandaloneExportAssignment, captureStandaloneExportAssignment, EXPORT_CONTROL_BYTES, EXPORT_RESULT_BYTES,
  EXPORT_ASSIGNMENT_BYTES, RUNNER_MAXIMUM_CONFIG_BYTES, validate } from '../../src/index.js';
import type { Offer, StandaloneExportAssignment } from '../../src/index.js';
import { assignment, body, hash, text } from './fixture.js';
it('matches an independently generated canonical assignment digest and retains the existing Offer type', async () => {
  const value = await assignment(); const created = createStandaloneExportAssignment(await body(),hash);
  expect(created).toEqual(value); expect(captureStandaloneExportAssignment(value,hash)).toEqual(value);
  expect(hash(await text('assignment.preimage.txt'))).toBe((await text('assignment.sha256')).trim());
  expect(value.assignmentDigest).toBe((await text('assignment.sha256')).trim());
  expectTypeOf<StandaloneExportAssignment['offer']>().toExtend<Offer>();
  expect(validate('Offer',value).ok).toBe(false); expect(validate('StandaloneExportAssignment',value.offer).ok).toBe(false);
});
it('freezes private snapshots and binds changed source, config, resources, scope and options', async () => {
  const input = await body(); const value = createStandaloneExportAssignment(input,hash); input.offer.config = {changed:true};
  expect(value.offer.config).not.toEqual(input.offer.config); expect(Object.isFrozen(value.offer.budget)).toBe(true);
  for (const patch of [{source:{...value.source,revisionDigest:'c'.repeat(64)}},{requestId:'00000000-0000-4000-8000-000000000099'},
    {options:{...value.options,scriptTimeoutMs:1}},{offer:{...value.offer,budget:{...value.offer.budget,cpuMillis:2}}},
    {offer:{...value.offer,workspaceId:'00000000-0000-4000-8000-000000000099'}}]) {
    expect(() => captureStandaloneExportAssignment({...value,...patch},hash)).toThrow('Standalone export contract rejected');
  }
});
it('requires the dedicated capability and refuses declared secrets before digest work', async () => {
  const input = await body(); const provider = vi.fn(hash);
  expect(() => createStandaloneExportAssignment({...input,offer:{...input.offer,requiredCapabilities:[]}},provider)).toThrow();
  const original = JSON.parse(await readFile(new URL('../../fixtures/valid/offer.json',import.meta.url),'utf8')) as Offer;
  expect(() => createStandaloneExportAssignment({...input,offer:{...input.offer,secretReferences:original.secretReferences}},provider)).toThrow();
  const {secretReferences,...withoutDeclarations} = input.offer; if (!secretReferences) throw new Error('Fixture declarations missing');
  expect(() => createStandaloneExportAssignment({...input,offer:withoutDeclarations},provider)).toThrow();
  expect(provider).not.toHaveBeenCalled();
});
it('reserves explicit build/control/result bytes and keeps exported script timeout separate from the build-job timeout', async () => {
  const input = await body(); const outputBytes = input.options.maximumBuildBytes + EXPORT_CONTROL_BYTES + EXPORT_RESULT_BYTES;
  const exact = {...input,offer:{...input.offer,budget:{...input.offer.budget,timeoutMs:1000,outputBytes}}};
  expect(createStandaloneExportAssignment(exact,hash).options.scriptTimeoutMs).toBe(180000);
  expect(() => createStandaloneExportAssignment({...exact,offer:{...exact.offer,budget:{...exact.offer.budget,outputBytes:outputBytes-1}}},hash)).toThrow();
  for (const options of [{...input.options,scriptTimeoutMs:172800001},{...input.options,maximumBuildBytes:67108865},{...input.options,maximumBuildBytes:0}]) {
    expect(() => createStandaloneExportAssignment({...input,options},hash)).toThrow();
  }
});
it('revalidates nested config/outer byte bounds and rejects foreign object execution and presealed input', async () => {
  const input = await body(); const provider = vi.fn(hash);
  expect(() => createStandaloneExportAssignment({...input,offer:{...input.offer,config:{body:'x'.repeat(RUNNER_MAXIMUM_CONFIG_BYTES)}}},provider)).toThrow();
  expect(() => createStandaloneExportAssignment({...input,padding:'x'.repeat(EXPORT_ASSIGNMENT_BYTES)},provider)).toThrow();
  expect(() => createStandaloneExportAssignment({...input,assignmentDigest:'0'.repeat(64)},provider)).toThrow();
  let accessed = false; const accessor = Object.defineProperty({},'version',{enumerable:true,get() {accessed=true; return 1;}});
  expect(() => createStandaloneExportAssignment(accessor,provider)).toThrow(); expect(accessed).toBe(false); expect(provider).not.toHaveBeenCalled();
});
it('contains digest-provider failures and non-string values without invoking coercion', async () => {
  const input = await body(); let coerced = false;
  const bad = {toString() {coerced = true; return 'a'.repeat(64);}};
  for (const provider of [() => {throw new Error('private canary');}, () => 'bad', () => bad as unknown as string]) {
    expect(() => createStandaloneExportAssignment(input,provider)).toThrow('Standalone export contract rejected');
  }
  expect(coerced).toBe(false);
});
