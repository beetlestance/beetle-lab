import { expect, it } from 'vitest';
import { captureCleanupProgress, cleanupProgressFollows, captureNativeCleanupReceipt, nativeCleanupPlanIdentity } from '../../src/cleanup-control/index.js';
import { plan, progress } from './fixture.js';
it('admits one bounded reverse-removal progress sequence and exact replay, rejecting skips and false closure', () => {
  const prepared = progress(0, 'prepared'); let prior = captureCleanupProgress(prepared, plan());
  const sequence = [progress(), progress(1), progress(2), progress(3, 'files_absent')];
  for (const value of sequence) { const next = captureCleanupProgress(value, plan()); expect(cleanupProgressFollows(prior, next)).toBe(true); expect(cleanupProgressFollows(next, next)).toBe(true); prior = next; }
  expect(cleanupProgressFollows(prepared, progress(1))).toBe(false);
  expect(cleanupProgressFollows(prior, progress())).toBe(false);
  for (const patch of [{ removedCount: 4 }, { removedCount: -1 }, { version: 5 }, { state: 'files_absent' }, { planIdentity: 'f'.repeat(64) }, { entryCount: 4 }, { extra: true }]) {
    expect(() => captureCleanupProgress({ ...progress(), ...patch }, plan())).toThrow();
  }
});
it('binds the receipt to exact plan/request/namespace and complete final progress without asserting IO', () => {
  const source = plan(); const final = progress(3, 'files_absent');
  const receipt = { protocolVersion: 1, purpose: 'performance', retirementVersion: 1, retirementRequestDigest: source.retirementRequestDigest,
    namespaceIdentity: source.namespaceIdentity, taskNamespaceIdentity: source.taskNamespaceIdentity, planIdentity: nativeCleanupPlanIdentity(source),
    finalProgressVersion: final.version, closure: 'owned-task-absent-after-original-close-v1' };
  expect(captureNativeCleanupReceipt(receipt, source, final)).toEqual(receipt);
  expect(() => captureNativeCleanupReceipt(receipt, source, progress(2))).toThrow();
  for (const patch of [{ planIdentity: 'f'.repeat(64) }, { closure: 'timeout' }, { finalProgressVersion: 4 }, { cleanupAcknowledged: true }]) {
    expect(() => captureNativeCleanupReceipt({ ...receipt, ...patch }, source, final)).toThrow();
  }
});
