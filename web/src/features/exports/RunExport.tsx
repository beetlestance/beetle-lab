import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ExportJob, Run } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { useSessionAccess } from '../../app/session.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { CancelButton, CancelFailure, Facts, ReadyActions, Steps } from './parts.js';
import { exportTerminalStates, reasonText, scriptLimitText, sizeText, stepIndex } from './prepare.js';
import { useExportWrite } from './useWrite.js';
import './exports.css';

const live = (job: ExportJob | undefined) => !!job && !exportTerminalStates.includes(job.state);

/** Creates the export of one run on the server and follows that job while it prepares. */
export function useRunExport(run: Run) {
  const api = useApi();
  const create = useExportWrite();
  const cancel = useExportWrite();
  const { organizationId, workspaceId } = run.scope;
  const followed = create.id ?? '';
  const detail = useQuery({
    queryKey: queryKeys.export(organizationId, workspaceId, followed),
    enabled: followed !== '',
    queryFn: async ({ signal }) => {
      const value = await readResult(
        api.getExport({ params: { organizationId, workspaceId, exportId: followed }, signal }),
      );
      if (value.revisionId.toLowerCase() !== run.revisionId.toLowerCase())
        throw new Error('Export belongs to another revision');
      return value;
    },
    refetchInterval: (query) => (query.state.status !== 'error' && live(query.state.data) ? 1000 : false),
  });
  const start = () =>
    void create.send({
      kind: 'createRun',
      params: { organizationId, workspaceId, runId: run.id },
      body: { scope: run.scope, requestId: crypto.randomUUID() },
    });
  return { create, cancel, job: detail.data, detailFailed: detail.isError, start };
}
type RunExportFlow = ReturnType<typeof useRunExport>;

/** "Export script…" on the run result: starts the export at once, then shows it in a dialog. */
export function RunExportAction({ run, label }: { run: Run; label: string }) {
  const { readOnly } = useSessionAccess();
  const flow = useRunExport(run);
  const [open, setOpen] = useState(false);
  return (
    <span className="result-action">
      <Button
        variant="secondary"
        size="sm"
        disabled={readOnly}
        onClick={() => {
          if (!flow.create.id && !flow.create.pending) flow.start();
          setOpen(true);
        }}
      >
        Export script…
      </Button>
      {open && <RunExportDialog run={run} label={label} flow={flow} close={() => setOpen(false)} />}
    </span>
  );
}

const ended: Partial<Record<ExportJob['state'], string>> = {
  failed: 'The export failed',
  cancelled: 'The export was cancelled',
};
type DialogProps = { run: Run; label: string; flow: RunExportFlow; close: () => void };

/** "Overlay / Export run": preparing, ready, ended, unknown and a refused start. */
export function RunExportDialog(props: DialogProps) {
  const job = props.flow.job;
  if (job?.state === 'ready' && job.artifact) return <ReadyRunDialog {...props} job={job} />;
  if (job && (ended[job.state] || job.state === 'unknown')) return <EndedRunDialog {...props} job={job} />;
  return <PreparingRunDialog {...props} />;
}

function ExportsLink({ run }: { run: Run }) {
  return <Link to={routes.exports(run.scope.organizationId, run.scope.workspaceId)}>Open Exports</Link>;
}

function CloseButton({ close }: { close: () => void }) {
  return (
    <Button variant="text" onClick={close}>
      Close
    </Button>
  );
}

function TryAgain({ flow }: { flow: RunExportFlow }) {
  const { readOnly } = useSessionAccess();
  return (
    <Button variant="primary" disabled={readOnly || flow.create.pending || flow.create.unknown} onClick={flow.start}>
      Try again
    </Button>
  );
}

function ReadyRunDialog({ run, label, close, job }: DialogProps & { job: ExportJob }) {
  const artifact = job.artifact!;
  return (
    <Dialog
      className="script-export-dialog"
      title={`Run ${label} is ready as a k6 script`}
      onClose={close}
      actions={
        <>
          <CloseButton close={close} />
          <ReadyActions job={job} zip={false} />
        </>
      }
    >
      <Facts
        items={[
          ['File', artifact.name],
          ['Size', sizeText(artifact.bytes)],
          ['Script time limit', scriptLimitText(job.options.scriptTimeoutMs)],
        ]}
      />
      <p>Run it with k6 wherever you like. The download is checked against its SHA-256.</p>
      <ExportsLink run={run} />
    </Dialog>
  );
}

function EndedRunDialog({ run, flow, close, job }: DialogProps & { job: ExportJob }) {
  const unknown = job.state === 'unknown';
  return (
    <Dialog
      className="script-export-dialog"
      title={ended[job.state] ?? 'We can’t tell whether this export finished'}
      onClose={close}
      actions={
        <>
          <CloseButton close={close} />
          {unknown ? <CancelButton job={job} flow={flow} /> : <TryAgain flow={flow} />}
        </>
      }
    >
      {job.reason && <p>{reasonText(job.reason)}.</p>}
      {unknown && <p>The agent stopped answering. Beetle Lab keeps the export Unknown until the agent reports back.</p>}
      <CancelFailure flow={flow} />
      <ExportsLink run={run} />
    </Dialog>
  );
}

function PreparingRunDialog({ run, label, flow, close }: DialogProps) {
  const job = flow.job;
  const refused = !job && !flow.create.pending && !flow.create.unknown && !!flow.create.message;
  return (
    <Dialog
      className="script-export-dialog"
      title={refused ? 'The export could not start' : `Preparing a k6 script from run ${label}`}
      onClose={close}
      description="It reproduces the run’s saved revision, engine profile, budget and execution policy. No load is sent. You can close this and find the script later under Exports."
      actions={
        <>
          <CloseButton close={close} />
          {refused && <TryAgain flow={flow} />}
          {job && stepIndex(job.state) >= 0 && <CancelButton job={job} flow={flow} />}
        </>
      }
    >
      {!refused && <Steps job={job} />}
      <Problems flow={flow} />
      <CancelFailure flow={flow} />
      <ExportsLink run={run} />
    </Dialog>
  );
}

function Problems({ flow }: { flow: RunExportFlow }): ReactNode {
  const { readOnly } = useSessionAccess();
  return (
    <>
      {flow.create.message && (
        <p role="alert" className="field-error">
          {flow.create.message}
        </p>
      )}
      {flow.detailFailed && (
        <p role="alert" className="field-error">
          Could not read the export’s progress. It is still listed under Exports.
        </p>
      )}
      {flow.create.unknown && (
        <div role="alert">
          <p>The outcome is unknown. Replay sends the identical request.</p>
          <Button size="sm" disabled={readOnly || flow.create.pending} onClick={() => void flow.create.send()}>
            Replay export request
          </Button>
        </div>
      )}
    </>
  );
}
