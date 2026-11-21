import { ReadAdmission } from '../../components/ReadAdmission.js';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsScope, WorkspaceScope } from '@beetle/contracts/api';
import { Banner } from '../../components/Banner.js';
import { Button } from '../../components/Button.js';
import { useApi, readResult } from '../../app/api.js';
import { QueryState } from '../../components/QueryState.js';
import { useRetentionCommand } from './useCommand.js';
import { retentionKey, retentionParams } from './queries.js';
import { RetentionBatch } from './Batch.js';
import type { ManualRun } from './Batch.js';
import { SavedBatches } from './Batches.js';
import { policySentence } from './format.js';
import './retention.css';
type Standalone = { batch: string | null; select(id: string | null): void };

export type { ManualRun } from './Batch.js';
export function RetentionControls({
  scope,
  run,
  initialSnapshotId,
  onKeep,
  standalone,
}: {
  scope: WorkspaceScope;
  run?: ManualRun;
  onKeep?: () => void;
  standalone?: Standalone | undefined;
  initialSnapshotId?: string;
}) {
  const showBatch = Boolean(standalone?.batch);
  const [open, setOpen] = useState(initialRetentionOpen(onKeep, initialSnapshotId, showBatch));
  const toggleLabel = retentionToggleLabel(open, run);
  return (
    <section className={showBatch ? 'retention-standalone' : 'retention-panel'} aria-label="Run retention">
      {!onKeep && !showBatch && (
        <Button variant={open ? 'text' : 'secondary'} onClick={() => setOpen((value) => !value)}>
          {toggleLabel}
        </Button>
      )}
      {(open || showBatch) && (
        <ReadAdmission>
          <RetentionWorkspace
            key={`${scope.organizationId}/${scope.workspaceId}/${run?.id ?? ''}`}
            scope={scope}
            onKeep={onKeep}
            run={run}
            initialSnapshotId={initialSnapshotId}
            standalone={standalone}
          />
        </ReadAdmission>
      )}
    </section>
  );
}
function initialRetentionOpen(onKeep: (() => void) | undefined, snapshot: string | undefined, showBatch: boolean) {
  return onKeep !== undefined || snapshot !== undefined || showBatch;
}

function retentionToggleLabel(open: boolean, run: ManualRun | undefined): string {
  if (open) return 'Close retention controls';
  return run ? 'Delete this run…' : 'Manage run retention';
}

type RetentionWorkspaceProps = {
  scope: WorkspaceScope;
  run: ManualRun | undefined;
  initialSnapshotId: string | undefined;
  onKeep: (() => void) | undefined;
  standalone?: Standalone | undefined;
};
function RetentionWorkspace({ scope, run, initialSnapshotId, onKeep, standalone }: RetentionWorkspaceProps) {
  const compact = onKeep !== undefined;
  const showBatch = !!standalone?.batch;
  const { command, selected, setSelected, settings, batches, refresh, preview } = useRetentionWorkspace({
    scope,
    compact,
    run,
    initialSnapshotId,
    standalone,
  });
  return (
    <>
      {showBatch && (
        <Button variant="text" size="sm" disabled={command.blocked} onClick={() => setSelected(null)}>
          Back to workspace settings
        </Button>
      )}
      <RetentionStart
        visible={!showBatch && (!compact || !selected)}
        settings={settings}
        compact={compact}
        run={run}
        blocked={command.blocked}
        preview={preview}
      />
      <RetentionFailure command={command} />
      {selected && (
        <RetentionBatch
          key={selected}
          scope={scope}
          id={selected}
          command={command}
          compactRun={compact ? run : undefined}
          selected={setSelected}
          changed={refresh}
          removed={() => {
            setSelected(null);
            refresh();
            onKeep?.();
          }}
        />
      )}
      {!compact && !showBatch && (
        <SavedRetentionBatches batches={batches} selected={selected} select={setSelected} blocked={command.blocked} />
      )}
    </>
  );
}

function RetentionStart({
  visible,
  settings,
  compact,
  run,
  blocked,
  preview,
}: {
  visible: boolean;
  settings: ReturnType<typeof useRetentionWorkspace>['settings'];
  compact: boolean;
  run: ManualRun | undefined;
  blocked: boolean;
  preview(): void;
}) {
  if (!visible) return null;
  return (
    <>
      {!compact && (
        <header className="retention-intro">
          <h2>{run ? 'Delete run' : 'Run retention'}</h2>
          <p>Preview first, then explicitly apply the displayed batch. Nothing is removed until you apply.</p>
        </header>
      )}
      <QueryState query={settings}>
        {(value) => (
          <div className="retention-start">
            {!compact && (
              <p>
                {policySentence(value.effective.retention.value)}{' '}
                <span className="retention-muted">{origin(value.effective.retention.source.kind)}</span>
              </p>
            )}
            <Button variant={compact ? 'secondary' : 'primary'} disabled={blocked} onClick={preview}>
              {run ? 'Preview this run deletion' : 'Preview retention'}
            </Button>
          </div>
        )}
      </QueryState>
    </>
  );
}

function RetentionFailure({ command }: { command: ReturnType<typeof useRetentionCommand> }) {
  if (!command.message) return null;
  return (
    <Banner
      tone="danger"
      actions={
        command.unknown && (
          <Button loading={command.pending} loadingLabel="Retrying…" onClick={command.retry}>
            Retry identical retention request
          </Button>
        )
      }
    >
      {command.message}
    </Banner>
  );
}

function SavedRetentionBatches({
  batches,
  selected,
  select,
  blocked,
}: {
  batches: ReturnType<typeof useRetentionWorkspace>['batches'];
  selected: string | null;
  select: (id: string) => void;
  blocked: boolean;
}) {
  return (
    <section className="retention-saved" aria-label="Saved batches">
      <div className="retention-batch-bar">
        <h3>Saved batches</h3>
        <Button variant="text" size="sm" disabled={batches.isFetching} onClick={() => void batches.refetch()}>
          Refresh batches
        </Button>
      </div>
      <p className="retention-note">
        At most eight batches are stored. Discard unused previews or acknowledge completed batches to release their
        metadata reservation.
      </p>
      <QueryState query={batches}>
        {(value) => <SavedBatches list={value} selected={selected} blocked={blocked} select={select} />}
      </QueryState>
    </section>
  );
}

function origin(kind: SettingsScope['kind']): string {
  return kind === 'workspace' ? 'Set on this workspace.' : `Inherited from ${kind}.`;
}

function useRetentionWorkspace({
  scope,
  run,
  initialSnapshotId,
  standalone,
  compact = false,
}: {
  scope: WorkspaceScope;
  run: ManualRun | undefined;
  compact: boolean;
  initialSnapshotId: string | undefined;
  standalone: Standalone | undefined;
}) {
  const api = useApi();
  const client = useQueryClient();
  const identity = JSON.stringify(retentionKey(scope));
  const command = useRetentionCommand(identity);
  const [localBatch, setLocalBatch] = useState<string | null>(initialSnapshotId ?? null);
  const selected = standalone ? standalone.batch : localBatch;
  const setSelected = standalone?.select ?? setLocalBatch;
  const params = retentionParams(scope);
  const prefix = retentionKey(scope);
  const settings = useQuery({
    queryKey: [...prefix, 'settings'],
    enabled: !standalone?.batch,
    queryFn: ({ signal }) => readResult(api.getWorkspaceSettings({ params, signal })),
  });
  const batches = useQuery({
    queryKey: [...prefix, 'batches'],
    enabled: !compact && !standalone?.batch,
    queryFn: ({ signal }) => readResult(api.listWorkspaceRetention({ params, signal })),
  });
  useEffect(
    () => () => {
      const queryKey = JSON.parse(identity) as string[];
      void client.cancelQueries({ queryKey });
      client.removeQueries({ queryKey });
    },
    [client, identity],
  );
  const refresh = () => {
    void client.invalidateQueries({ queryKey: prefix });
  };
  function preview() {
    if (!settings.data) return;
    const body = {
      scope,
      requestId: crypto.randomUUID(),
      settingsId: settings.data.id,
      expectedVersion: settings.data.version,
    };
    if (run) {
      command.start(
        (signal) =>
          api.previewRunDeletion({
            params: { ...params, runId: run.id },
            body: { ...body, runId: run.id, expectedRunVersion: run.version },
            signal,
          }),
        (value) => {
          setSelected(value.snapshotId);
          refresh();
        },
      );
    } else
      command.start(
        (signal) => api.previewWorkspaceRetention({ params, body: { ...body, page: { limit: 100 } }, signal }),
        (value) => {
          setSelected(value.snapshotId);
          refresh();
        },
      );
  }
  return { command, selected, setSelected, settings, batches, refresh, preview };
}
