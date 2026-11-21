import { PreviewIntro, SnapshotSummary } from './Preview.js';
import { Progress } from './Progress.js';
import { bytes, clock, runs, shortId } from './format.js';
import { Banner } from '../../components/Banner.js';
import { Button } from '../../components/Button.js';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RetentionPreview, RetentionBatchStatus, WorkspaceScope } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { QueryState } from '../../components/QueryState.js';
import { retentionKey, retentionParams } from './queries.js';
import type { RetentionCommand } from './useCommand.js';
export interface ManualRun {
  readonly id: string;
  readonly version: number;
}
interface Props {
  scope: WorkspaceScope;
  id: string;
  command: RetentionCommand;
  compactRun?: ManualRun | undefined;
  changed(): void;
  selected(id: string): void;
  removed(): void;
}
export function RetentionBatch(props: Props) {
  const api = useApi();
  const params = { ...retentionParams(props.scope), snapshotId: props.id };
  const prefix = [...retentionKey(props.scope), props.id];
  const preview = useQuery({
    queryKey: [...prefix, 'preview'],
    queryFn: ({ signal }) => readResult(api.getWorkspaceRetentionPreview({ params, signal })),
  });
  const status = useQuery({
    queryKey: [...prefix, 'status'],
    queryFn: ({ signal }) => readResult(api.getWorkspaceRetentionStatus({ params, signal })),
    refetchInterval: (query) =>
      query.state.status === 'success' && query.state.data?.state === 'applied' ? 2000 : false,
    refetchIntervalInBackground: false,
  });
  return (
    <section className="retention-batch" aria-label="Selected retention batch">
      <div className="retention-batch-bar">
        <span className="retention-muted" title={props.id}>
          Batch {shortId(props.id)}
        </span>
        <Button
          variant="text"
          size="sm"
          disabled={preview.isFetching || status.isFetching}
          onClick={() => {
            void preview.refetch();
            void status.refetch();
          }}
        >
          Refresh batch
        </Button>
      </div>
      <QueryState query={preview}>
        {(value) => (
          <QueryState query={status}>
            {(progress) => <BatchView {...props} preview={value} status={progress} />}
          </QueryState>
        )}
      </QueryState>
    </section>
  );
}
type BatchViewProps = Props & { preview: RetentionPreview; status: RetentionBatchStatus };
function BatchView({ scope, id, command, compactRun, changed, selected, removed, preview, status }: BatchViewProps) {
  const api = useApi();
  const client = useQueryClient();
  const params = retentionParams(scope);
  const expired = usePreviewExpired(preview.expiresAt, status.state === 'preview');
  function apply() {
    const body = {
      scope,
      requestId: crypto.randomUUID(),
      settingsId: preview.settingsId,
      expectedVersion: preview.settingsVersion,
      snapshotId: id,
      snapshotVersion: preview.version,
      page: { limit: preview.candidates.length },
    };
    command.start(
      (signal) => api.applyWorkspaceRetention({ params, body, signal }),
      () => {
        changed();
        void client.invalidateQueries({ queryKey: queryKeys.runs(scope.organizationId, scope.workspaceId) });
      },
    );
  }
  function next() {
    if (preview.nextCursor === null) return;
    const body = {
      scope,
      requestId: crypto.randomUUID(),
      settingsId: preview.settingsId,
      expectedVersion: preview.settingsVersion,
      page: { limit: 100, cursor: preview.nextCursor },
    };
    command.start(
      (signal) => api.previewWorkspaceRetention({ params, body, signal }),
      (value) => {
        selected(value.snapshotId);
        changed();
      },
    );
  }
  function discard() {
    command.start(
      (signal) => api.discardWorkspaceRetention({ params: { ...params, snapshotId: id }, signal }),
      () => removed(),
    );
  }
  const actions = { preview, command, expired, apply, discard };
  if (status.state === 'preview')
    return compactRun ? <ManualPreview {...actions} run={compactRun} /> : <PreviewActions {...actions} next={next} />;
  return (
    <>
      <Progress value={status} preview={preview} />
      {status.state === 'completed' && (
        <div className="retention-actions">
          <p className="retention-note">
            Acknowledgement removes the saved batch and its status. Completed deletions remain final.
          </p>
          <Button disabled={command.blocked} onClick={discard}>
            Acknowledge completed batch
          </Button>
        </div>
      )}
    </>
  );
}

function usePreviewExpired(expiresAt: string, preview: boolean): boolean {
  const deadline = Date.parse(expiresAt);
  const [elapsed, setElapsed] = useState<number>();
  useEffect(() => {
    const remaining = deadline - Date.now();
    if (!preview || remaining <= 0) return;
    const timer = window.setTimeout(() => setElapsed(deadline), remaining);
    return () => window.clearTimeout(timer);
  }, [deadline, preview]);
  return elapsed === deadline || Date.now() >= deadline;
}

interface PreviewActionsProps {
  preview: RetentionPreview;
  command: RetentionCommand;
  expired: boolean;
  apply(): void;
  next(): void;
  discard(): void;
}
function PreviewActions({ preview, command, expired, apply, next, discard }: PreviewActionsProps) {
  const count = preview.candidates.length;
  const manual = preview.kind === 'manual' && count === 1;
  return (
    <>
      <PreviewIntro preview={preview} />
      <SnapshotSummary preview={preview} />
      <p className="retention-note">
        Apply removes only the runs listed here. If the selection changes after {clock(preview.capturedAt)}, for example
        a run is pinned, Apply is refused and nothing is removed; start a fresh preview.
      </p>
      {expired && <Banner tone="warning">This preview expired. Discard it and start a fresh preview.</Banner>}
      <div className="retention-actions">
        {preview.nextCursor && (
          <Button disabled={command.blocked || expired} onClick={next}>
            Preview next window
          </Button>
        )}
        <Button variant="text" disabled={command.blocked} onClick={discard}>
          Discard preview
        </Button>
        <Button
          variant="danger"
          disabled={command.blocked || expired || count === 0}
          loading={command.pending}
          onClick={apply}
        >
          {manual ? `Delete run ${shortId(preview.candidates[0]!.id)}` : `Remove ${runs(count)}`}
        </Button>
      </div>
    </>
  );
}

function ManualPreview({
  preview,
  run,
  command,
  expired,
  apply,
  discard,
}: Omit<PreviewActionsProps, 'next'> & { run: ManualRun }) {
  const [candidate] = preview.candidates;
  const matches =
    preview.kind === 'manual' &&
    preview.candidates.length === 1 &&
    candidate?.id === run.id &&
    candidate.version === run.version;
  return (
    <>
      {matches ? (
        <dl className="retention-manual-facts">
          <div>
            <dt>Estimated reclaimable space</dt>
            <dd>{bytes(candidate.estimatedBytes)}</dd>
          </div>
          <div>
            <dt>Checked at</dt>
            <dd>
              <time dateTime={preview.capturedAt}>{clock(preview.capturedAt)}</time>, valid until{' '}
              <time dateTime={preview.expiresAt}>{clock(preview.expiresAt)}</time>
            </dd>
          </div>
        </dl>
      ) : (
        <Banner tone="warning">
          The preview no longer identifies this run and version. Check again before deleting.
        </Banner>
      )}
      {expired && <Banner tone="warning">This preview expired. Keep the run and check again.</Banner>}
      <p className="retention-note">If the run changes after the check, deletion is refused and nothing is removed.</p>
      <div className="retention-actions">
        <Button variant="text" disabled={command.blocked} onClick={discard}>
          Keep run
        </Button>
        <Button
          variant="danger"
          disabled={command.blocked || expired || !matches}
          loading={command.pending}
          onClick={apply}
        >
          Delete run
        </Button>
      </div>
    </>
  );
}
