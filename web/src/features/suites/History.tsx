import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Suite, SuiteRevision } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { RunSavedRevision } from '../runs/index.js';
import { draftText } from './draft.js';
import { queryKeys } from '../../app/queries.js';
import { usePage, Pagination } from '../../components/Pagination.js';
import { QueryState } from '../../components/QueryState.js';

export function History({ suite }: { suite: Suite }) {
  const api = useApi();
  const params = { organizationId: suite.scope.organizationId, workspaceId: suite.scope.workspaceId, suiteId: suite.id };
  const key = queryKeys.suiteRevisions(params.organizationId, params.workspaceId, suite.id);
  const page = usePage(key);
  const [selected, select] = useState<string | null>(null);
  const query = useQuery({ queryKey: [...key, page.cursor], queryFn: ({ signal }) => readResult(api.listSuiteRevisions({ params, query: page.query, signal })) });
  return <section><h2>Revision history</h2><p>Viewing an older revision does not change the current pointer.</p>
    <QueryState query={query}>{data => <><ul>{data.items.map(revision => <li key={revision.id}>
      <button onClick={() => select(revision.id)}>View revision {revision.ordinal}</button>
      {revision.id === suite.currentRevisionId && ' Current'} — structural preflight: {revision.preflightStatus}
    </li>)}</ul>{!data.items.length && <p>No revisions yet.</p>}<Pagination page={page} next={data.nextCursor} /></>}</QueryState>
    {selected && <RevisionDetail key={selected} suite={suite} id={selected} />}
  </section>;
}
function RevisionDetail({ suite, id }: { suite: Suite; id: string }) {
  const api = useApi();
  const client = useQueryClient();
  const params = { organizationId: suite.scope.organizationId, workspaceId: suite.scope.workspaceId, revisionId: id };
  useEffect(() => () => {
    const key = queryKeys.suiteRevision(params.organizationId, params.workspaceId, id);
    void client.cancelQueries({ queryKey: key, type: 'inactive' }); client.removeQueries({ queryKey: key, type: 'inactive' });
  }, [client, id, params.organizationId, params.workspaceId]);
  const query = useQuery({ queryKey: queryKeys.suiteRevision(params.organizationId, params.workspaceId, id),
    queryFn: async ({ signal }) => {
      const result = await readResult(api.getSuiteRevision({ params, signal }));
      if (result.suiteId !== suite.id) throw new Error('Revision belongs to another suite');
      return result;
    } });
  return <QueryState query={query}>{revision => <SavedRevision revision={revision} />}</QueryState>;
}
export function SavedRevision({ revision }: { revision: SuiteRevision }) {
  return <article className="suite-editor"><h3>Revision {revision.ordinal}</h3>
    <p>Structural preflight: {revision.preflightStatus}. This does not indicate a successful run.</p>
    <p className="number">Revision ID: {revision.id}</p><p className="number">Digest: {revision.digest}</p>
    <RunSavedRevision revision={revision} />
    <label>Saved configuration JSON<textarea readOnly value={draftText(revision.config)} /></label>
  </article>;
}
