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
import { SavedBatches } from './Batches.js';
import { policySentence } from './format.js';
import './retention.css';
export interface ManualRun {
  readonly id: string;
  readonly version: number;
}
export function RetentionControls({
  scope,
  run,
  initialSnapshotId,
}: {
  scope: WorkspaceScope;
  run?: ManualRun;
  initialSnapshotId?: string;
}) {
  const [open, setOpen] = useState(initialSnapshotId !== undefined);
  return (
    <section className="retention-panel" aria-label="Run retention">
      <Button variant={open ? 'text' : 'secondary'} onClick={() => setOpen((value) => !value)}>
        {open ? 'Close retention controls' : run ? 'Delete this run…' : 'Manage run retention'}
      </Button>
      {open && (
        <ReadAdmission>
          <RetentionWorkspace
            key={`${scope.organizationId}/${scope.workspaceId}/${run?.id ?? ''}`}
            scope={scope}
            {...(run ? { run } : {})}
            {...(initialSnapshotId ? { initialSnapshotId } : {})}
          />
        </ReadAdmission>
      )}
    </section>
  );
}
type RetentionWorkspaceProps = { scope: WorkspaceScope; run?: ManualRun; initialSnapshotId?: string };
function RetentionWorkspace({ scope, run, initialSnapshotId }: RetentionWorkspaceProps) {
  const { command, selected, setSelected, settings, batches, refresh, preview } = useRetentionWorkspace({
    scope,
    ...(run ? { run } : {}),
    ...(initialSnapshotId === undefined ? {} : { initialSnapshotId }),
  });
  return (
    <>
      <header className="retention-intro">
        <h2>{run ? 'Delete run' : 'Run retention'}</h2>
        <p>Preview first, then explicitly apply the displayed batch. Nothing is removed until you apply.</p>
      </header>
      <QueryState query={settings}>
        {(value) => (
          <div className="retention-start">
            <p>
              {policySentence(value.effective.retention.value)}{' '}
              <span className="retention-muted">{origin(value.effective.retention.source.kind)}</span>
            </p>
            <Button variant="primary" disabled={command.blocked} onClick={preview}>
              {run ? 'Preview this run deletion' : 'Preview retention'}
            </Button>
          </div>
        )}
      </QueryState>
      {command.message && (
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
      )}
      {selected && (
        <RetentionBatch
          key={selected}
          scope={scope}
          id={selected}
          command={command}
          selected={setSelected}
          changed={refresh}
          removed={() => {
            setSelected(null);
            refresh();
          }}
        />
      )}
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
          {(value) => <SavedBatches list={value} selected={selected} blocked={command.blocked} select={setSelected} />}
        </QueryState>
      </section>
    </>
  );
}

function origin(kind: SettingsScope['kind']): string {
  return kind === 'workspace' ? 'Set on this workspace.' : `Inherited from ${kind}.`;
}

function useRetentionWorkspace({
  scope,
  run,
  initialSnapshotId,
}: {
  scope: WorkspaceScope;
  run?: ManualRun;
  initialSnapshotId?: string;
}) {
  const api = useApi();
  const client = useQueryClient();
  const identity = JSON.stringify(retentionKey(scope));
  const command = useRetentionCommand(identity);
  const [selected, setSelected] = useState<string | null>(initialSnapshotId ?? null);
  const params = retentionParams(scope);
  const prefix = retentionKey(scope);
  const settings = useQuery({
    queryKey: [...prefix, 'settings'],
    queryFn: ({ signal }) => readResult(api.getWorkspaceSettings({ params, signal })),
  });
  const batches = useQuery({
    queryKey: [...prefix, 'batches'],
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
