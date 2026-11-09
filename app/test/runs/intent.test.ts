import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { prepareRunCommand } from '../../src/application/runs/index.js';
import type { CreateRunOperation } from '../../src/ports/runs.js';
import request from '../../../contracts/fixtures/api/valid/create-run.json' with { type: 'json' };
import { validateApi } from '@beetle/contracts/api';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function operation(): CreateRunOperation {
  const checked = validateApi('CreateRunRequest', structuredClone(request));
  if (!checked.ok) throw new Error('Invalid synthetic request');
  return { kind: 'createRun', id: '00000000-0000-4000-8000-000000000005',
    attemptId: '00000000-0000-4000-8000-000000000006', requestedAt: '2026-11-09T00:00:00.000Z', request: checked.value };
}
it('keeps one logical digest across fresh allocations/time and canonical object ordering', () => {
  const original = operation(); const first = prepareRunCommand(original, digest);
  const changed = { ...original, id: '00000000-0000-4000-8000-000000000007',
    attemptId: '00000000-0000-4000-8000-000000000008', requestedAt: '2026-11-10T00:00:00.000Z',
    request: { ...original.request, budget: Object.fromEntries(Object.entries(original.request.budget).reverse()) as typeof original.request.budget } };
  expect(prepareRunCommand(changed, digest).intentDigest).toBe(first.intentDigest);
  original.request.budget.cpuMillis++;
  expect(first.request.budget.cpuMillis).toBe(1000);
  expect(Object.isFrozen(first.request.budget)).toBe(true);
  expect(first.id).toBe('00000000-0000-4000-8000-000000000005');
});
it('binds every execution request choice without hashing transient allocation values', () => {
  const original = operation(); const first = prepareRunCommand(original, digest);
  const changed = operation(); changed.request.executionPolicy.preferIdle = true;
  expect(prepareRunCommand(changed, digest).intentDigest).not.toBe(first.intentDigest);
  changed.request = { ...original.request, revisionId: '00000000-0000-4000-8000-000000000099' };
  expect(prepareRunCommand(changed, digest).intentDigest).not.toBe(first.intentDigest);
  changed.request = { ...original.request, budget: { ...original.request.budget, cpuMillis: 2000 } };
  expect(prepareRunCommand(changed, digest).intentDigest).not.toBe(first.intentDigest);
});
it('rejects invalid allocations/time and caller-supplied runtime payloads', () => {
  const original = operation();
  for (const changed of [{ ...original, id: '../escape' }, { ...original, attemptId: original.id },
    { ...original, requestedAt: 'tomorrow' }, { ...original, request: { ...original.request, config: {} } }]) {
    expect(() => prepareRunCommand(changed, digest)).toThrow();
  }
});
