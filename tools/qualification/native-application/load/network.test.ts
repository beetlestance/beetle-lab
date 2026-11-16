import {expect, it, vi} from 'vitest';
import {measuredCall, observeNetwork} from './network.js';
it('correlates header timing while preserving the exact Response and private headers/body', async () => {
  const original = globalThis.fetch; const response = new Response('PRIVATE-BODY', {headers: {'set-cookie': 'PRIVATE-TOKEN'}});
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response); globalThis.fetch = fetcher;
  let recorded: unknown;
  try {
    const result = await observeNetwork('http://127.0.0.1:54321', () => measuredCall(() => fetch('http://127.0.0.1:54321/api/v2/run')), rows => {recorded = rows;});
    expect(result).toBe(response); expect(globalThis.fetch).toBe(fetcher); expect(JSON.stringify(recorded)).not.toContain('PRIVATE');
    expect(recorded).toEqual([expect.objectContaining({status: 200, id: expect.any(Number), headersMs: expect.any(Number)})]);
  } finally {globalThis.fetch = original;}
});
it('restores fetch and keeps failed network timing without copying raw errors', async () => {
  const original = globalThis.fetch; const fetcher = vi.fn<typeof fetch>().mockRejectedValue(Error('PRIVATE-ERROR')); globalThis.fetch = fetcher;
  let recorded: unknown;
  try {
    await expect(observeNetwork('http://127.0.0.1:54321', () => measuredCall(() => fetch('http://127.0.0.1:54321/api/v2/run')), rows => {recorded = rows;})).rejects.toThrow('PRIVATE-ERROR');
    expect(globalThis.fetch).toBe(fetcher); expect(JSON.stringify(recorded)).not.toContain('PRIVATE');
    expect(recorded).toEqual([expect.objectContaining({status: 0})]);
  } finally {globalThis.fetch = original;}
});
