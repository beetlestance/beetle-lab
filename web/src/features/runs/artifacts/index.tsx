import { artifactDownload } from '@beetle/contracts';
import { useId, useState } from 'react';
import { runArtifactContentPath } from '@beetle/contracts/api';
import type { Run, RunArtifactPage } from '@beetle/contracts/api';
import { Button } from '../../../components/Button.js';
import { Table, Td } from '../../../components/Table.js';
import { formatBytes } from '../../run-results/format.js';
import { ArtifactViewer, viewerLimit } from './ArtifactViewer.js';
import { useArtifacts } from './useArtifacts.js';
import './artifacts.css';

type Props = { run: Run; terminal: boolean; heading?: string | undefined };
/** The selected attempt may be historical; publication is never inferred from Run state. */
export function RunArtifacts(props: Props) {
  const run = props.run;
  return (
    <Inventory
      key={`${run.scope.organizationId}/${run.scope.workspaceId}/${run.id}/${run.activeAttemptId}`}
      {...props}
    />
  );
}
function Inventory({ run, terminal, heading: title = 'Published artifacts' }: Props) {
  const heading = useId();
  const { query, readPage } = useArtifacts(run, terminal);
  const page = query.data;
  return (
    <section className="run-artifacts" aria-labelledby={heading}>
      <header className="artifacts-head">
        <h2 id={heading}>{title}</h2>
        <Button size="sm" variant="text" disabled={query.isFetching} onClick={() => void readPage()}>
          Refresh artifacts
        </Button>
      </header>
      {query.isPending && <p role="status">Loading artifact inventory…</p>}
      {query.isError && (
        <p role="alert">
          Artifact inventory could not be loaded. Automatic refresh stopped; use Refresh artifacts to retry.
        </p>
      )}
      {!query.isError && page && (
        <>
          {page.availability === 'pending' && <p role="status">Artifact publication is pending.</p>}
          {page.availability === 'absent' && <p role="status">No artifact source was published for this attempt.</p>}
          {page.availability === 'ready' && <ArtifactList page={page} />}
          {page.nextCursor !== null && (
            <Button size="sm" disabled={query.isFetching} onClick={() => void readPage(page.nextCursor ?? undefined)}>
              Next artifact page
            </Button>
          )}
        </>
      )}
      <p className="artifacts-foot">
        Artifacts stay until the run is removed. Pin the run to keep it out of retention. Download progress and
        cancellation are handled by your browser.
      </p>
    </section>
  );
}

/** Static description per declared kind; an unknown kind shows its own name. */
const holds: Record<string, string> = {
  'standalone-k6-script': 'The exact k6 script that ran',
  'performance-report': 'Plain-text performance report',
  'metrics-csv': 'Per-interval metrics as CSV',
  'numeric-final': 'Final k6 numbers as JSON',
  'k6-diagnostics': 'Sanitized k6 diagnostics',
  'k6-warnings': 'k6 warnings, if any',
  'target-runtime': 'Target runtime samples',
};
/** Kinds the shared download policy serves as text; only these can be opened here. */
const textKinds = new Set([
  'standalone-k6-script',
  'performance-report',
  'metrics-csv',
  'numeric-final',
  'k6-diagnostics',
  'k6-warnings',
]);

function ArtifactList({ page }: { page: RunArtifactPage }) {
  const [open, setOpen] = useState<string | null>(null);
  if (page.items.length === 0) return <p role="status">Published inventory is empty.</p>;
  const params = {
    organizationId: page.scope.organizationId,
    workspaceId: page.scope.workspaceId,
    runId: page.id,
    attemptId: page.attemptId,
  };
  const viewing = page.items.find((item) => item.artifactId === open);
  return (
    <>
      <Table
        caption="Artifact descriptors"
        columns={[
          { key: 'file', label: 'File' },
          { key: 'holds', label: 'What it holds' },
          { key: 'size', label: 'Size', numeric: true },
          { key: 'open', label: 'Verify and open' },
        ]}
      >
        {page.items.map((item) => {
          const viewable = textKinds.has(item.kind) && item.bytes > 0 && item.bytes <= viewerLimit;
          return (
            <tr key={item.artifactId}>
              <Td>
                <span className="number artifact-path">{item.relativePath}</span>
              </Td>
              <Td>
                {holds[item.kind] ?? item.kind}
                <span className="artifact-sha number" title={`SHA-256 ${item.sha256}`}>
                  {item.sha256.slice(0, 12)}…
                </span>
              </Td>
              <Td numeric title={`${item.bytes} bytes`}>
                {formatBytes(item.bytes)}
              </Td>
              <Td>
                <span className="artifact-actions">
                  {viewable && (
                    <Button
                      size="sm"
                      variant="text"
                      aria-label={`Verify and open ${item.relativePath}`}
                      onClick={() => setOpen(item.artifactId)}
                    >
                      Open
                    </Button>
                  )}
                  <a
                    href={runArtifactContentPath({ ...params, artifactId: item.artifactId })}
                    download={artifactDownload(item).filename}
                    aria-label={`Download artifact ${item.relativePath}`}
                  >
                    Download
                  </a>
                </span>
              </Td>
            </tr>
          );
        })}
      </Table>
      {viewing && <ArtifactViewer params={params} artifact={viewing} onClose={() => setOpen(null)} />}
    </>
  );
}
