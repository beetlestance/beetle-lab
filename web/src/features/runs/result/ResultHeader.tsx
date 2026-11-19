import { terminal } from '../terminal.js';
import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Run } from '@beetle/contracts/api';
import { useApi } from '../../../app/api.js';
import { routes } from '../../../app/routes.js';
import { Status } from '../../../components/Badge.js';
import { Button } from '../../../components/Button.js';
import { runStatus } from '../../run-results/format.js';
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
  onDelete,
  refresh,
  ordinal,
  suiteName,
}: {
  run: Run;
  title: string;
  sentence: string;
  readOnly: boolean;
  ordinal?: number | undefined;
  suiteName?: string | undefined;
  onDelete(): void;
  /** RunDetail's run re-read; available even in read-only history. */
  refresh?: { readonly run: () => void; readonly busy: boolean } | undefined;
}) {
  const status = displayedStatus(run, readOnly);
  return (
    <header className="result-head">
      <ResultContext run={run} suiteName={suiteName} ordinal={ordinal} />
      <div className="result-head-main">
        <h1 className="result-title">{title}</h1>
      </div>
      <div className="result-head-side">
        <div className="result-row">
          <Status tone={status.tone}>{status.label}</Status>
          {refresh && (
            <Button variant="text" size="sm" onClick={refresh.run} disabled={refresh.busy}>
              Refresh run
            </Button>
          )}
        </div>
        {readOnly ? (
          <div className="result-actions">
            <ResultCompare run={run} suiteName={suiteName} />
            <ResultDownloads run={run} ordinal={ordinal} />
            <p className="result-readonly-note">Read-only history: changes are unavailable.</p>
          </div>
        ) : (
          <div className="result-actions">
            <RunAgain run={run} />
            <ResultCompare run={run} suiteName={suiteName} />
            <ResultDownloads run={run} ordinal={ordinal} />
            <PinControl run={run} />
            <Button variant="text" size="sm" onClick={onDelete}>
              Delete run…
            </Button>
          </div>
        )}
      </div>
      {sentence && <p className="result-sentence">{sentence}</p>}
    </header>
  );
}

/** Starts the same saved revision with the run's own profile, budget and policy. */
function RunAgain({ run }: { run: Run }) {
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
      <Button variant="primary" size="sm" loading={write.pending} loadingLabel="Starting…" onClick={start}>
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
