import { expect, it } from 'vitest';
import { validateApi } from '@beetle/contracts/api';
import { captureExportOperation, captureExportReply } from '../../src/adapters/outbound/sqlite/export-wire.js';
import fixture from '../../../contracts/fixtures/api/valid/export-job.json' with { type: 'json' };

it('captures only the exact revision wrapper, nested scope and coherent terminal states', () => {
  const checked = validateApi('ExportJob', fixture);
  if (!checked.ok) throw new Error('Invalid export fixture');
  const job = { ...checked.value, state: 'queued' as const, artifact: null, reason: null };
  const operation = captureExportOperation({
    kind: 'getLatestRevisionExport',
    key: { scope: job.scope, id: job.revisionId },
  });
  const value = { scope: job.scope, revisionId: job.revisionId, job };
  expect(captureExportReply(operation, value)).toEqual(value);
  expect(captureExportReply(operation, { ...value, job: null })).toEqual({ ...value, job: null });
  const other = '99999999-9999-4999-8999-999999999999';
  for (const invalid of [
    { ...value, revisionId: other },
    { ...value, job: { ...job, revisionId: other } },
    { ...value, job: { ...job, scope: { ...job.scope, workspaceId: other } } },
    { ...value, job: { ...job, state: 'cancelled', reason: 'cancelled', cancellationRequested: false } },
  ])
    expect(() => captureExportReply(operation, invalid)).toThrow();
});
