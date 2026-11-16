import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { prepareCancelRunCommand } from '../../src/application/runs/index.js';
import type { CancelRunOperation } from '../../src/ports/runs.js';
import request from '../../../contracts/fixtures/api/valid/cancel-run.json' with { type: 'json' };
import { validateApi } from '@beetle/contracts/api';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function operation(): CancelRunOperation {
  const checked = validateApi('CancelRunRequest', structuredClone(request));
  if (!checked.ok) throw new Error('Invalid synthetic request');
  return { kind: 'cancelRun', id: '00000000-0000-4000-8000-000000000005', request: checked.value };
}

it('captures immutable intent and binds run identity and request scope', () => {
  const original = operation(); const first = prepareCancelRunCommand(original, digest);
  const reordered = { request: { requestId: original.request.requestId, scope: original.request.scope },
    id: original.id, kind: original.kind };
  expect(prepareCancelRunCommand(reordered, digest)).toEqual(first);
  expect(prepareCancelRunCommand({ ...original, id: original.request.requestId }, digest).intentDigest)
    .not.toBe(first.intentDigest);
  original.request.scope.workspaceId = original.id;
  expect(first.request.scope.workspaceId).toBe(request.scope.workspaceId);
  expect(Object.isFrozen(first.request.scope)).toBe(true);
  expect(prepareCancelRunCommand(original, digest).intentDigest).not.toBe(first.intentDigest);
});

it('validates stored command digests and rejects unknown fields and invalid identities', () => {
  const command = prepareCancelRunCommand(operation(), digest);
  expect(prepareCancelRunCommand(command, digest)).toEqual(command);
  for (const input of [{ ...command, intentDigest: 'f'.repeat(64) }, { ...operation(), id: '../escape' },
    { ...operation(), force: true }, { ...operation(), request: { ...operation().request, expectedVersion: 1 } }]) {
    expect(() => prepareCancelRunCommand(input, digest)).toThrow();
  }
});

it('rejects oversized and accessor input before digest or external effects', () => {
  let calls = 0; let reads = 0;
  const hash = (value: string) => { calls++; return digest(value); };
  const oversized = { ...operation(), padding: 'x'.repeat(65536) };
  expect(() => prepareCancelRunCommand(oversized, hash)).toThrow();
  const accessor = operation();
  Object.defineProperty(accessor, 'padding', { enumerable: true, get() { reads++; return 'synthetic'; } });
  expect(() => prepareCancelRunCommand(accessor, hash)).toThrow();
  expect(calls).toBe(0); expect(reads).toBe(0);
});
