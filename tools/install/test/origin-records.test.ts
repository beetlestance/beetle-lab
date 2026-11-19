import { expect, it } from 'vitest';
import { captureOriginSelector, validOrigin } from '../src/origin-selector.js';
import { captureOriginRecords, MAX_ORIGIN_OPERATIONS } from '../origin/records.js';

const id = '00000000-0000-4000-8000-0000000000c1';
const other = '00000000-0000-4000-8000-0000000000c2';
const installationId = '00000000-0000-4000-8000-0000000000c3';
const selector = { version: 1, operationId: id, baseline: 'http://127.0.0.1:8080', current: 'https://lab.example.internal' };

it('accepts only canonical loopback or HTTPS origins', () => {
  for (const origin of ['http://127.0.0.1:8080', 'http://localhost:8080', 'https://lab.example.internal', 'https://10.0.0.5:8443'])
    expect(validOrigin(origin)).toBe(true);
  for (const origin of ['http://lab.example.internal', 'https://lab.example.internal/', 'https://LAB.example.internal',
    'https://user@lab.example.internal', 'ftp://lab.example.internal', '', 7, `https://${'a'.repeat(2050)}.internal`])
    expect(validOrigin(origin)).toBe(false);
});

it('captures the selector field strictly', () => {
  expect(captureOriginSelector(selector)).toEqual(selector);
  expect(Object.isFrozen(captureOriginSelector(selector))).toBe(true);
  for (const bad of [
    { ...selector, version: 2 },
    { ...selector, operationId: 'x' },
    { ...selector, current: selector.baseline },
    { ...selector, current: 'http://lab.example.internal' },
    { ...selector, extra: true },
    { version: 1, operationId: id, current: selector.current },
    null,
    [],
  ])
    expect(() => captureOriginSelector(bad)).toThrow();
});

it('captures records strictly: one installation, unique IDs, only the newest pending', () => {
  const committed = { operationId: id, from: selector.baseline, to: selector.current, phase: 'committed' };
  const pending = { operationId: other, from: selector.current, to: selector.baseline, phase: 'pending' };
  const records = { version: 1, installationId, operations: [committed, pending] };
  expect(captureOriginRecords(records, installationId)).toEqual(records);
  for (const bad of [
    { ...records, installationId: other },
    { ...records, version: 2 },
    { ...records, operations: [pending, committed] },
    { ...records, operations: [committed, committed] },
    { ...records, operations: [{ ...committed, phase: 'started' }] },
    { ...records, operations: [{ ...committed, to: committed.from }] },
    { ...records, operations: [{ ...committed, extra: 1 }] },
    { ...records, operations: Array.from({ length: MAX_ORIGIN_OPERATIONS + 1 }, () => committed) },
    { ...records, extra: 1 },
  ])
    expect(() => captureOriginRecords(bad, installationId)).toThrow();
});
