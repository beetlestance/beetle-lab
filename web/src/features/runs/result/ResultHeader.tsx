import { terminal } from '../terminal.js';
import { useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Run } from '@beetle/contracts/api';
import { useApi } from '../../../app/api.js';
import { routes } from '../../../app/routes.js';
import { Status } from '../../../components/Badge.js';
import { Button } from '../../../components/Button.js';
import { runStatus, shortId } from '../../run-results/format.js';
import { RunExportAction } from '../../exports/RunExport.js';
import { PinControl } from './PinControl.js';
import { WriteError } from './WriteError.js';
import { useWrite } from './useWrite.js';
import { ResultDownloads } from './ResultDownloads.js';
import { ResultContext } from './ResultContext.js';
import { ResultCompare } from './ComparePicker.js';

/** Header of the Run result boards: status, verdict title, summary sentence, actions. */
export function ResultHeader({
  run,
  title,
  sentence,
  readOnly,
  phone,
  onDelete,
  refresh,
  ordinal,
  suiteName,
}: {
  run: Run;
  title: string;
  sentence: string;
  readOnly: boolean;
  phone: boolean;
  ordinal?: number | undefined;
  suiteName?: string | undefined;
  onDelete(): void;
  /** RunDetail's run re-read; available even in read-only history. */
  refresh?: { readonly run: () => void; readonly busy: boolean } | undefined;
}) {
  const status = displayedStatus(run, readOnly);
  const refreshButton = refresh && (
    <Button variant="text" size="sm" onClick={refresh.run} disabled={refresh.busy}>
      Refresh run
    </Button>
  );
  const deleteButton = !readOnly && (
    <Button variant="text" size="sm" onClick={onDelete}>
      Delete run…
    </Button>
  );
  return (
    <header className="result-head">
      <ResultContext run={run} suiteName={suiteName} ordinal={ordinal} phone={phone} />
      <div className="result-head-main">
        <h1 className="result-title">{title}</h1>
      </div>
      <div className="result-head-side">
        <div className="result-row">
          <Status tone={status.tone}>{status.label}</Status>
          {!phone && refreshButton}
          {phone && (refreshButton || deleteButton) && (
            <MoreActions>
              {refreshButton}
              {deleteButton}
            </MoreActions>
          )}
        </div>
        <ResultActions
          run={run}
          readOnly={readOnly}
          phone={phone}
          suiteName={suiteName}
          ordinal={ordinal}
          deleteButton={deleteButton}
        />
      </div>
      {sentence && <p className="result-sentence">{sentence}</p>}
    </header>
  );
}

function ResultActions({
  run,
  readOnly,
  phone,
  suiteName,
  ordinal,
  deleteButton,
}: {
  run: Run;
  readOnly: boolean;
  phone: boolean;
  suiteName: string | undefined;
  ordinal: number | undefined;
  deleteButton: ReactNode;
}) {
  const sourceActions = [
    <ResultCompare key="compare" run={run} suiteName={suiteName} />,
    <ResultDownloads key="download" run={run} ordinal={ordinal} />,
  ];
  const again = <RunAgain key="again" run={run} phone={phone} />;
  return (
    <div className="result-actions">
      {readOnly ? (
        <>
          {sourceActions}
          <p className="result-readonly-note">Read-only history: changes are unavailable.</p>
        </>
      ) : (
        <>
          {phone ? [...sourceActions, again] : [again, ...sourceActions]}
          <RunExportAction run={run} label={shortId(run.id)} />
          <PinControl run={run} shortLabel={phone} />
          {!phone && deleteButton}
        </>
      )}
    </div>
  );
}

function MoreActions({ children }: { children: ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions -- Escape closes the native disclosure.
    <details
      className="result-other-actions"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return;
        event.preventDefault();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }}
    >
      <summary>More actions</summary>
      <div className="result-other-actions-panel">{children}</div>
    </details>
  );
}

/** Starts the same saved revision with the run's own profile, budget and policy. */
function RunAgain({ run, phone }: { run: Run; phone: boolean }) {
  const api = useApi();
  const navigate = useNavigate();
  const { organizationId, workspaceId } = run.scope;
  const write = useWrite(`${organizationId}/${workspaceId}/${run.id}/again`);
  const body = useRef<Parameters<typeof api.createRun>[0]['body'] | null>(null);
  function start() {
    body.current = {
      scope: run.scope,
      requestId: crypto.randomUUID(),
      revisionId: run.revisionId,
      engineProfile: run.engine.profileId,
      budget: run.budget,
      executionPolicy: run.executionPolicy,
    };
    const captured = body.current;
    write.start(
      (signal) => api.createRun({ params: { organizationId, workspaceId }, body: captured, signal }),
      (created) => void navigate(routes.run(organizationId, workspaceId, created.id)),
    );
  }
  return (
    <span className="result-action">
      <Button
        variant={phone ? 'secondary' : 'primary'}
        size="sm"
        loading={write.pending}
        loadingLabel="Starting…"
        onClick={start}
      >
        Run again
      </Button>
      <WriteError write={write} label="Retry the same start" />
    </span>
  );
}

function displayedStatus(run: Run, readOnly: boolean) {
  const status = runStatus(run);
  return readOnly && !terminal(run) ? { label: `${status.label} at backup`, tone: 'neutral' as const } : status;
}
