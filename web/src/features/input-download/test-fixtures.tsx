import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { InputRecord, InputTransferClient } from '@beetle/contracts/api';
import { InputTransferContext } from '../../app/api.js';
import { InputDownload } from './index.js';

export { deferred } from '../../app/test-fixtures.js';
export const inputId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export function input(overrides: Partial<InputRecord> = {}): InputRecord {
  return { id: inputId, scope: { kind: 'workspace', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    workspaceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, folderId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    name: 'Synthetic private filename.csv', sha256: 'a'.repeat(64), bytes: 3, offset: 3,
    version: 7, state: 'published', reason: null, ...overrides };
}
export function transfers() {
  const download = vi.fn<InputTransferClient['download']>().mockResolvedValue({ ok: true, value: new Uint8Array([1, 2, 3]) });
  const client: InputTransferClient = { download, append: vi.fn(), prepare: vi.fn(), close: vi.fn() };
  return { client, download };
}
export function mount(client: InputTransferClient | null, record = input()) {
  const view = (nextClient: InputTransferClient | null, nextRecord: InputRecord) =>
    <InputTransferContext.Provider value={nextClient}><InputDownload record={nextRecord} /></InputTransferContext.Provider>;
  const rendered = render(view(client, record));
  return { ...rendered, replace: (nextClient: InputTransferClient | null, nextRecord = record) => rendered.rerender(view(nextClient, nextRecord)) };
}
export function observeFiles() {
  const blobs: Blob[] = [];
  const NativeBlob = globalThis.Blob;
  class ObservedBlob extends NativeBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) { super(parts, options); blobs.push(this); }
  }
  const createObjectURL = vi.fn(() => `blob:synthetic-${blobs.length}`);
  const revokeObjectURL = vi.fn<(url: string) => void>();
  class ObservedURL extends URL {
    static override createObjectURL = createObjectURL;
    static override revokeObjectURL = revokeObjectURL;
  }
  vi.stubGlobal('Blob', ObservedBlob);
  vi.stubGlobal('URL', ObservedURL);
  return { blobs, createObjectURL, revokeObjectURL };
}
