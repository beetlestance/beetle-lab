import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { artifactDownload } from '@beetle/contracts';
import { runArtifactContentPath } from '@beetle/contracts/api';
import type { Run, RunArtifactPage } from '@beetle/contracts/api';
import { readResult, useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';
import { routes } from '../../../app/routes.js';
import { Button } from '../../../components/Button.js';
import { HeaderIcon } from '../live/HeaderIcon.js';
import './downloads.css';

/** Opening reads metadata only. Native links leave byte transfer to the browser. */
export function ResultDownloads({ run, ordinal }: { run: Run; ordinal: number | undefined }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  function close() {
    if (ref.current) ref.current.open = false;
    setOpen(false);
  }
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return (
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions -- <details> is a native disclosure; Escape closes it like a menu.
    <details
      className="result-downloads"
      ref={ref}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !ref.current?.open) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        ref.current?.querySelector('summary')?.focus();
      }}
    >
      <summary role="button" className="btn btn-secondary" aria-label="Download" title="Download">
        <HeaderIcon kind="download" />
      </summary>
      {open && <DownloadChoices run={run} ordinal={ordinal} close={close} />}
    </details>
  );
}

function useDownloadInventory(run: Run) {
  const api = useApi();
  const client = useQueryClient();
  const { organizationId, workspaceId } = run.scope;
  const params = { organizationId, workspaceId, runId: run.id, attemptId: run.activeAttemptId };
  const key = [...queryKeys.run(organizationId, workspaceId, run.id), 'downloads', run.activeAttemptId];
  const query = useQuery({
    queryKey: key,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      const first = await readResult(api.listRunArtifacts({ params, query: { limit: 100 }, signal }));
      if (!first.nextCursor) return first;
      const second = await readResult(
        api.listRunArtifacts({ params, query: { limit: 100, cursor: first.nextCursor }, signal }),
      );
      const items = [...first.items, ...second.items];
      if (
        second.nextCursor ||
        first.manifestDigest !== second.manifestDigest ||
        first.generation !== second.generation ||
        second.availability !== 'ready' ||
        items.length > 128 ||
        new Set(items.map((item) => item.artifactId.toLowerCase())).size !== items.length
      )
        throw new Error('Artifact inventory changed or exceeded its bound');
      return { ...first, items, nextCursor: null };
    },
  });
  useEffect(
    () => () => {
      const queryKey = [...queryKeys.run(organizationId, workspaceId, run.id), 'downloads', run.activeAttemptId];
      void client.cancelQueries({ queryKey, exact: true });
      client.removeQueries({ queryKey, exact: true });
    },
    [client, organizationId, workspaceId, run.id, run.activeAttemptId],
  );
  return query;
}

const files = [
  { kind: 'performance-report', label: 'Report', detail: '.txt, the recorded performance report' },
  { kind: 'numeric-final', label: 'Summary', detail: '.json, recorded numeric results' },
  { kind: 'metrics-csv', label: 'Metrics', detail: '.csv, recorded metric windows' },
] as const;

function DownloadChoices({ run, ordinal, close }: { run: Run; ordinal: number | undefined; close(): void }) {
  const query = useDownloadInventory(run);
  const page = query.isError ? undefined : query.data;
  const { organizationId, workspaceId } = run.scope;
  return (
    <div className="result-download-menu" role="group" aria-label="Run downloads">
      {query.isPending && <p role="status">Reading published files…</p>}
      {query.isError && (
        <div role="alert">
          <p>Published files could not be read.</p>
          <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
            Retry downloads
          </Button>
        </div>
      )}
      {page && files.map((file) => <DownloadChoice key={file.kind} run={run} page={page} file={file} close={close} />)}
      <Link
        to={routes.suiteScriptFromRun(organizationId, workspaceId, run.suiteId, run.revisionId, run.id)}
        onClick={close}
      >
        <span>{ordinal === undefined ? 'Saved script' : `Script for revision ${ordinal}`}</span>
        <small>View the saved script and available export options</small>
      </Link>
      <p className="result-download-note">Your browser handles download progress and cancellation.</p>
    </div>
  );
}

function DownloadChoice({
  run,
  page,
  file,
  close,
}: {
  run: Run;
  page: RunArtifactPage;
  file: (typeof files)[number];
  close(): void;
}) {
  const matches = page.items.filter((item) => item.kind === file.kind);
  const artifact = page.availability === 'ready' && matches.length === 1 ? matches[0] : undefined;
  if (!artifact)
    return (
      <div className="result-download-unavailable">
        <span>{file.label}</span>
        <small>
          {page.availability === 'pending'
            ? 'Publication pending'
            : matches.length > 1
              ? 'Multiple files; choose one in Artifacts'
              : 'Not published'}
        </small>
      </div>
    );
  return (
    <a
      href={runArtifactContentPath({
        organizationId: run.scope.organizationId,
        workspaceId: run.scope.workspaceId,
        runId: run.id,
        attemptId: run.activeAttemptId,
        artifactId: artifact.artifactId,
      })}
      download={artifactDownload(artifact).filename}
      onClick={close}
    >
      <span>{file.label}</span>
      <small>{file.detail}</small>
    </a>
  );
}
