import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CreateSuiteRequest, PatchSuiteRequest, Suite, Workspace } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { usePage } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';
import { useWrite, WriteStatus } from './useWrite.js';

export function MetadataEditor({ workspace, suite, refresh, close }: {
  workspace: Workspace; suite?: Suite; refresh: () => Promise<unknown>; close: () => void;
}) {
  const api = useApi();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  const scope = { kind: 'workspace' as const, ...params };
  const [name, setName] = useState(suite?.name ?? '');
  const [folderId, setFolderId] = useState(suite?.folderId ?? workspace.rootFolderId);
  const write = useWrite<CreateSuiteRequest | PatchSuiteRequest>((body, signal) => suite && 'expectedVersion' in body
    ? api.patchSuite({ params: { ...params, suiteId: suite.id }, body, signal })
    : api.createSuite({ params, body: body as CreateSuiteRequest, signal }), refresh);
  return <section className="suite-editor" aria-label={suite ? 'Edit suite metadata' : 'Create suite'}>
    <h2>{suite ? 'Edit suite metadata' : 'Create suite'}</h2>
    <form onSubmit={event => { event.preventDefault(); void write.submit({ scope, requestId: crypto.randomUUID(), name, folderId,
      ...(suite ? { expectedVersion: suite.version } : {}) }); }}>
      <fieldset disabled={write.locked}><legend className="sr-only">Suite metadata</legend>
        <label>Suite name<input autoFocus required maxLength={128} value={name} onChange={event => setName(event.target.value)} /></label>
        <p>Selected folder: <span className="number">{folderId}</span></p>
        <FolderPicker workspace={workspace} selected={folderId} choose={setFolderId} />
        <button className="primary" type="submit">Save suite</button>
      </fieldset>
    </form>
    <WriteStatus write={write} refresh={refresh} />
    <button disabled={write.pending} onClick={close}>Close metadata editor</button>
  </section>;
}
function FolderPicker({ workspace, selected, choose }: { workspace: Workspace; selected: string; choose: (id: string) => void }) {
  const api = useApi();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  const key = queryKeys.folders(params.organizationId, params.workspaceId);
  const page = usePage(key);
  const query = useQuery({ queryKey: [...key, page.cursor], queryFn: ({ signal }) => readResult(api.listFolders({ params, query: page.query, signal })) });
  return <div><label><input type="radio" name="suite-folder" checked={selected === workspace.rootFolderId}
    onChange={() => choose(workspace.rootFolderId)} />Workspace root</label>
    <QueryState query={query}>{data => <>
      {data.items.filter(folder => folder.id !== workspace.rootFolderId).map(folder => <label key={folder.id}>
        <input type="radio" name="suite-folder" checked={selected === folder.id} onChange={() => choose(folder.id)} />/{folder.displayPath.join('/')}
      </label>)}<nav className="pagination" aria-label="Folder pages"><button type="button" disabled={!page.hasBack} onClick={page.back}>Previous folders</button>
        <button type="button" disabled={!data.nextCursor} onClick={() => { if (data.nextCursor) page.next(data.nextCursor); }}>Next folders</button></nav>
    </>}</QueryState></div>;
}
