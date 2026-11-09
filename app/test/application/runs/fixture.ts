import { createHash } from 'node:crypto';
import { validateApi } from '@beetle/contracts/api';
import type { CreateRunOperation } from '../../../src/ports/runs.js';
import request from '../../../../contracts/fixtures/api/valid/create-run.json' with { type: 'json' };
import run from '../../../../contracts/fixtures/api/valid/run.json' with { type: 'json' };

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const otherId = '00000000-0000-4000-8000-000000000099';
export function runValue() {
  const result = validateApi('Run', structuredClone(run));
  if (!result.ok) throw new Error('Invalid synthetic run');
  return result.value;
}
export function operation(): CreateRunOperation {
  const result = validateApi('CreateRunRequest', structuredClone(request));
  if (!result.ok) throw new Error('Invalid synthetic request');
  return { kind: 'createRun', id: '00000000-0000-4000-8000-000000000007',
    attemptId: '00000000-0000-4000-8000-000000000008',
    requestedAt: '2026-11-10T00:00:00.000Z', request: result.value };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
