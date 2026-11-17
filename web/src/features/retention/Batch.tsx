import { PreviewIntro, SnapshotSummary } from './Preview.js';
import { Progress } from './Progress.js';
import { clock, runs, shortId } from './format.js';
import { Banner } from '../../components/Banner.js';
import { Button } from '../../components/Button.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RetentionPreview, RetentionBatchStatus, WorkspaceScope } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { QueryState } from '../../components/QueryState.js';
import { retentionKey, retentionParams } from './queries.js';
import type { RetentionCommand } from './useCommand.js';
interface Props {
  scope: WorkspaceScope;
  id: string;
  command: RetentionCommand;
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
function BatchView({ scope, id, command, changed, selected, removed, preview, status }: BatchViewProps) {
  const api = useApi();
  const client = useQueryClient();
  const params = retentionParams(scope);
  const expired = Date.parse(preview.expiresAt) <= Date.now();
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
  if (status.state === 'preview')
    return (
      <PreviewActions
        preview={preview}
        command={command}
        expired={expired}
        apply={apply}
        next={next}
        discard={discard}
      />
    );
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
