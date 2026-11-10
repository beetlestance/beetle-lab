import { expect, it, vi } from 'vitest';
import type { Owned, OutputAbsence } from '@beetle/contracts/output-source';
import { JournalError } from '../../src/journal/index.js';
import { OutputTransferError } from '../../src/output-transfer/index.js';
import { server, proof, get, path, other, snapshot, unused } from './fixtures.js';

it('returns only captured durable proof and marks ordinary source GET without invoking source collection', async () => {
  const source = vi.fn(unused); const app = server({ outputs: { source, chunk: unused } });
  try {
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await get(origin).result;
    expect(response.status).toBe(200); expect(JSON.parse(response.body)).toEqual(proof());
    expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(2048); expect(response.headers.connection).toBe('close');
    const marker = await get(origin, path).result;
    expect(marker.status).toBe(409); expect(JSON.parse(marker.body)).toMatchObject({ reason: 'source_absent', retry: 'never' });
    expect(source).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

it.each([
  ['authorization', `Bearer ${'T'.repeat(64)}`, 401], ['x-beetle-journal-authority', other, 409],
  ['x-beetle-generation', '2', 409], ['content-length', '1', 400], ['transfer-encoding', 'chunked', 400],
] as const)('rejects %s before invoking proof service', async (header, value, status) => {
  const read = vi.fn(async () => proof()); const app = server({ absences: { readOutputAbsence: read } });
  try {
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    expect((await get(origin, `${path}/absence`, { [header]: value }, header === 'content-length' ? 'x' : undefined).result).status).toBe(status);
    expect(read).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

it('keeps missing capability unavailable, known unclosed proof pending and unknown attempts unknown', async () => {
  const cases = [
    { options: {}, absence: false, status: 503, reason: 'execution_lost' },
    { options: { absences: { readOutputAbsence: async () => null } }, status: 409, reason: 'source_pending' },
    { options: { absences: { readOutputAbsence: async () => null }, journal: { get: async () => { throw new JournalError('not_found'); },
      readEvents: unused, acknowledge: unused } }, status: 404, reason: 'attempt_not_found' },
  ];
  for (const entry of cases) {
    const app = server(entry.options, entry.absence);
    try {
      const origin = await app.listen({ host: '127.0.0.1', port: 0 }); const response = await get(origin).result;
      expect(response.status).toBe(entry.status); expect(JSON.parse(response.body).reason).toBe(entry.reason);
    } finally { await app.close(); }
  }
});

it.each(['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest', 'journalAuthority', 'oversize', 'getter'])(
  'rejects invalid stored proof %s without publishing an absence marker', async field => {
    const input: Record<string, unknown> = { ...proof() }; const getter = vi.fn(() => 'unsupported_capability');
    if (field === 'oversize') input.padding = 'x'.repeat(2049);
    else if (field === 'getter') Object.defineProperty(input, 'reason', { enumerable: true, get: getter });
    else input[field] = field === 'intentDigest' ? 'b'.repeat(64) : field === 'generation' ? 2 : other;
    const app = server({ absences: { readOutputAbsence: async () => input as unknown as Owned<OutputAbsence> } });
    try {
      const origin = await app.listen({ host: '127.0.0.1', port: 0 });
      for (const route of [`${path}/absence`, path]) {
        const response = await get(origin, route).result;
        expect(response.status).toBe(500); expect(JSON.parse(response.body).reason).toBe('invalid_protocol');
      }
      expect(getter).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

it('never infers absence from source unavailable or missing source after terminal snapshot', async () => {
  const app = server({ absences: { readOutputAbsence: async () => null }, journal: { get: async () => ({ ...snapshot(),
    admission: { state: 'released', disposition: 'settled' } }), readEvents: unused, acknowledge: unused },
    outputs: { source: async () => { throw new OutputTransferError('unavailable'); }, chunk: unused } });
  try {
    const origin = await app.listen({ host: '127.0.0.1', port: 0 }); const response = await get(origin, path).result;
    expect(response.status).toBe(409); expect(JSON.parse(response.body)).toMatchObject({ reason: 'source_unavailable', retry: 'never' });
  } finally { await app.close(); }
});
