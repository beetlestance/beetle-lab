import { expect, it, vi } from 'vitest';
import { createStagingNamespaceClient } from '../../src/journal/staging-namespace-client.js';
import { captureNamespaceIntent, installedRootDigest, sealNamespaceAnchor, sealTaskNamespace } from '../../src/staging-namespace/index.js';
import type { TaskNamespaceIntent } from '../../src/staging-namespace/index.js';
import { rootFacts, syntheticMarker, directories } from './model-fixtures.js';
const intent = captureNamespaceIntent({ protocolVersion: 1, namespaceId: '00000000-0000-4000-8000-000000000001',
  journalAuthority: '00000000-0000-4000-8000-000000000002', root: rootFacts, rootDigest: installedRootDigest(rootFacts), nonce: 'e'.repeat(64) });
it('rejects a well-formed marker reply that differs from the captured native observation', async () => {
  const expected = syntheticMarker(intent); const forged = sealNamespaceAnchor({ intent, marker: syntheticMarker(intent, '9007199254740998') });
  const invalidReply = vi.fn<() => never>(() => { throw new Error('Invalid worker reply'); });
  const client = createStagingNamespaceClient({ send: async prepare => { prepare(); return forged; }, invalidReply });
  await expect(client.commit({ intent, marker: expected })).rejects.toThrow('Invalid worker reply'); expect(invalidReply).toHaveBeenCalledOnce();
});
it('rejects well-formed task facts from another native directory observation', async () => {
  const task: TaskNamespaceIntent = { protocolVersion: 1, purpose: 'performance', original: {
    organizationId: intent.namespaceId, workspaceId: intent.journalAuthority, attemptId: '00000000-0000-4000-8000-000000000003', generation: 1, intentDigest: 'a'.repeat(64) },
    namespaceIdentity: 'b'.repeat(64), specDigest: 'c'.repeat(64), runtimeName: 'beetle-synthetic' };
  const expected = directories(); const forged = sealTaskNamespace({ intent: task, directories: { ...expected, input: { ...expected.input, ino: '1234' } } });
  const invalidReply = vi.fn<() => never>(() => { throw new Error('Invalid worker reply'); });
  const client = createStagingNamespaceClient({ send: async prepare => { prepare(); return forged; }, invalidReply });
  await expect(client.commitTask({ intent: task, directories: expected })).rejects.toThrow('Invalid worker reply'); expect(invalidReply).toHaveBeenCalledOnce();
});
