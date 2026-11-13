import { expect, it, vi } from 'vitest';
import { createRetirementClient } from '../../src/journal/retirement-client.js';
import { makeRetirementIntent } from '../../src/retirement-values/index.js';
import request from '../../../contracts/fixtures/valid/output-retirement-absence.json' with { type: 'json' };
import { captureOutputRetirementRequest } from '@beetle/contracts/output-retirement';
import type { Scope } from '../../src/admission/index.js';
const original = captureOutputRetirementRequest(request);
const key: Scope = { organizationId: original.organizationId, workspaceId: original.workspaceId, attemptId: original.attemptId, generation: 1 };
const intent = makeRetirementIntent({ request: original, namespaceIdentity: 'a'.repeat(64), task: { state: 'none' } });
it('copies caller request before worker transport and rejects mismatched captured reply', async () => {
  let release!: (reply: unknown) => void; let sent = '';
  const client = createRetirementClient({ send: operation => {
    const command = operation(); if ('json' in command) sent = command.json;
    return new Promise(resolve => { release = resolve; });
  }, invalidReply: () => { throw new Error('bad reply'); }, settleCarrier: async () => {} });
  const input = structuredClone(request); const pending = client.begin(input); input.deletionId = input.runId;
  expect(JSON.parse(sent)).toEqual(original);
  release(makeRetirementIntent({ ...intent, request: { ...original, deletionId: original.runId } }));
  await expect(pending).rejects.toThrow('bad reply');
});
it('validates scope even for null status and false gate replies, and delegates actual carrier settlement', async () => {
  const settle = vi.fn(async () => {}); let reply: unknown = { key: { ...key, workspaceId: key.attemptId }, intent: null };
  const client = createRetirementClient({ send: operation => { operation(); return Promise.resolve(reply); },
    invalidReply: () => { throw new Error('bad reply'); }, settleCarrier: settle });
  await expect(client.read(key)).rejects.toThrow('bad reply');
  reply = { key: { ...key, attemptId: key.workspaceId }, open: false }; await expect(client.isOpen(key)).rejects.toThrow('bad reply');
  reply = { key, open: false }; expect(await client.isOpen(key)).toBe(false);
  await client.settleCarrier(); expect(settle).toHaveBeenCalledTimes(1);
});
it('accepts an exact immutable reply and rejects malformed records without granting native authority', async () => {
  const client = createRetirementClient({ send: operation => { operation(); return Promise.resolve(intent); },
    invalidReply: () => { throw new Error('bad reply'); }, settleCarrier: async () => {} });
  const value = await client.begin(original); expect(value).toEqual(intent); expect(Object.isFrozen(value.request.closure)).toBe(true);
});
