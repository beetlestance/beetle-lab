import { useId } from 'react';
import { runArtifactContentPath } from '@beetle/contracts/api';
import type { Run, RunArtifactPage } from '@beetle/contracts/api';
import { useArtifacts } from './useArtifacts.js';

type Props = { run: Run; terminal: boolean };
/** The selected attempt may be historical; publication is never inferred from Run state. */
export function RunArtifacts(props: Props) {
  const run = props.run;
  return <Inventory key={`${run.scope.organizationId}/${run.scope.workspaceId}/${run.id}/${run.activeAttemptId}`} {...props} />;
}
function Inventory({ run, terminal }: Props) {
  const heading = useId(); const { query, readPage } = useArtifacts(run, terminal);
  const page = query.data;
  return <section className="run-artifacts" aria-labelledby={heading}>
    <header className="section-header"><div><h2 id={heading}>Published artifacts</h2>
      <p>Download progress and cancellation are handled by your browser.</p></div>
      <button disabled={query.isFetching} onClick={() => void readPage()}>Refresh artifacts</button></header>
    {query.isPending && <p role="status">Loading artifact inventory…</p>}
    {query.isError && <p role="alert">Artifact inventory could not be loaded. Automatic refresh stopped; use Refresh artifacts to retry.</p>}
    {!query.isError && page && <>
      {page.availability === 'pending' && <p role="status">Artifact publication is pending.</p>}
      {page.availability === 'absent' && <p role="status">No artifact source was published for this attempt.</p>}
      {page.availability === 'ready' && <ArtifactList page={page} />}
      {page.nextCursor !== null && <button disabled={query.isFetching} onClick={() => void readPage(page.nextCursor ?? undefined)}>Next artifact page</button>}
    </>}
  </section>;
}
function ArtifactList({ page }: { page: RunArtifactPage }) {
  if (page.items.length === 0) return <p role="status">Published inventory is empty.</p>;
  return <div className="artifact-table" tabIndex={0} role="region" aria-label="Artifact descriptors">
    <table><thead><tr><th scope="col">Kind / filename</th><th scope="col">Bytes</th><th scope="col">SHA-256</th><th scope="col">Download</th></tr></thead>
      <tbody>{page.items.map(item => <tr key={item.artifactId}>
        <td><span>{item.kind}</span><br /><span className="number">{item.relativePath}</span></td>
        <td className="number">{item.bytes}</td><td className="number artifact-sha">{item.sha256}</td>
        <td><a href={runArtifactContentPath({ organizationId: page.scope.organizationId, workspaceId: page.scope.workspaceId,
          runId: page.id, attemptId: page.attemptId, artifactId: item.artifactId })}
        download={`artifact-${item.artifactId.toLowerCase()}.bin`} aria-label={`Download artifact ${item.relativePath}`}>Download</a></td>
      </tr>)}</tbody></table>
  </div>;
}
