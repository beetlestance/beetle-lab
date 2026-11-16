import {vi} from 'vitest';
import type {Folder, InputRecord} from '@beetle/contracts/api';
import {folder, ids, input, json, testClient, transfers, workspace} from '../input-upload/test-fixtures.js';
import type {RequestRecord} from '../input-upload/test-fixtures.js';
import {DirectoryWorkflow} from './workflow.js';
export {apiError, deferred, ids, json, workspace} from '../input-upload/test-fixtures.js';
export function selected(path: string): File {
  const file = new File([new Uint8Array(3)], path.split('/').at(-1)!);
  Object.defineProperty(file, 'webkitRelativePath', {value: path}); return file;
}
export function root(): Folder {return {...folder(), id: ids.root, name: 'Root', parentFolderId: null, displayPath: []};}
/** Generated HTTP client over an in-memory authority, never a fake API object. */
export function directoryFixture(intercept?: (request: RequestRecord) => Response | Promise<Response> | undefined,
  afterFolder?: (request: RequestRecord, response: Response) => Response | Promise<Response>) {
  const folders = [root()]; const inputs = new Map<string, InputRecord>(); const folderReceipts = new Map<string, Folder>();
  let sequence = 0;
  const newId = () => `12345678-1234-4234-8234-${String(++sequence).padStart(12, '0')}`;
  function createFolder(request: RequestRecord): Response | Promise<Response> {
      const body = request.body!; const requestId = String(body.requestId); let row = folderReceipts.get(requestId);
      if (!row) {row = {...folder(), id: newId(), name: String(body.name), parentFolderId: String(body.parentFolderId), displayPath: [String(body.name)]}; folders.push(row); folderReceipts.set(requestId, row);}
      const response = json(row, 201); return afterFolder ? afterFolder(request, response) : response;
  }
  const api = testClient(request => {
    const override = intercept?.(request); if (override) return override;
    if (request.path.includes('/folders?')) return json({scope: root().scope, items: folders, nextCursor: null});
    if (request.path.endsWith('/folders')) return createFolder(request);
    if (request.path.endsWith('/inputs')) {
      const body = request.body!; const row = input({id: newId(), name: String(body.name), folderId: String(body.folderId)});
      inputs.set(row.id, row); return json(row, 201);
    }
    const id = request.path.split('/inputs/')[1]!.split('/')[0]!; const row = inputs.get(id)!;
    if (request.path.endsWith('/seal')) {
      inputs.set(id, {...row, state: 'published', offset: row.bytes});
      return json({id, scope: row.scope, requestId: request.body?.requestId, operation: 'seal', acceptedVersion: Number(request.body?.expectedVersion) + 1}, 202);
    }
    return json(inputs.get(id));
  });
  const transfer = transfers(); const changed = vi.fn(); const invalidate = vi.fn();
  transfer.append.mockImplementation(async ({record, chunk}) => {
    const next = {...record, offset: record.offset + chunk.length, version: record.version + 1}; inputs.set(record.id, next); return {ok: true, value: next};
  });
  const owner = new DirectoryWorkflow({api: api.client, transfers: transfer, workspace: workspace(), changed, invalidate});
  return {api, transfer, owner, changed, invalidate, folders, inputs};
}
