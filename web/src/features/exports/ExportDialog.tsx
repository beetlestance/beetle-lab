import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { routes } from '../../app/routes.js';
import { useSessionAccess } from '../../app/session.js';
import type { ExportJob, SuiteRevision } from '@beetle/contracts/api';
import { Button, buttonClass } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { reasonText, secretNames, sizeText, scriptLimitText, stepIndex } from './prepare.js';
import { CancelButton, CancelFailure, ExportTime, Facts, ReadyActions, Steps } from './parts.js';
import type { useRevisionExport } from './useRevisionExport.js';
import './exports.css';

export type RevisionExport = ReturnType<typeof useRevisionExport>;
type Props = {
  revision: SuiteRevision;
  suiteName: string;
  flow: RevisionExport;
  close: () => void;
  editHref: string;
  zip?: boolean;
};

/** "Overlay / Export script": Preparing, Ready, Uses secrets and Unknown, plus the start and failed states. */
export function ExportDialog({ revision, suiteName, flow, close, editHref, zip = false }: Props) {
  const job = flow.job;
  const secrets = secretNames(revision);
  const name = `${suiteName}, revision ${revision.ordinal}`;
  const closeButton = (
    <Button variant="text" onClick={close}>
      Close
    </Button>
  );
  if (secrets.length || job?.reason === 'unsupported_secrets')
    return (
      <Dialog
        className="script-export-dialog"
        title="This revision can’t be exported"
        onClose={close}
        actions={
          <>
            {closeButton}
            <Link className={buttonClass('primary')} to={editHref}>
              Open the editor
            </Link>
          </>
        }
      >
        <p>
          {name} uses {secrets.length ? `the secret ${secrets.join(', ')}` : 'a secret'}. A standalone script would have
          nowhere safe to read it from, so revisions that use secrets are never exported.
        </p>
        <p>Save a revision without secret references and export that one.</p>
      </Dialog>
    );
  return (
    <ExportState
      job={job}
      name={name}
      revision={revision}
      flow={flow}
      close={close}
      closeButton={closeButton}
      zip={zip}
    />
  );
}
type StateProps = { job: ExportJob; flow: RevisionExport; close: () => void; closeButton: ReactNode };
function ReadyDialog({ job, name, close, closeButton, flow, zip }: StateProps & { name: string; zip: boolean }) {
  const { readOnly } = useSessionAccess();
  const artifact = job.artifact!;
  return (
    <Dialog
      className="script-export-dialog"
      title={`${name} is ready as a k6 script`}
      onClose={close}
      actions={
        <>
          {closeButton}
          <Button
            variant="text"
            disabled={readOnly || flow.preparing || flow.create.unknown || flow.noEngine}
            onClick={flow.prepare}
          >
            {flow.preparing ? 'Preparing new script…' : 'Prepare again'}
          </Button>
          <ReadyActions job={job} zip={zip} />
        </>
      }
    >
      <Facts
        items={[
          ['File', artifact.name],
          ['Size', sizeText(artifact.bytes)],
          ['Script time limit', scriptLimitText(job.options.scriptTimeoutMs)],
          [
            'SHA-256',
            <code key="sha" title={artifact.sha256}>
              <span aria-hidden="true">
                {artifact.sha256.slice(0, 8)}…{artifact.sha256.slice(-5)}
              </span>
              <span className="sr-only">{artifact.sha256}</span>
            </code>,
          ],
          ['Made', <ExportTime key="made" value={job.madeAt} />],
        ]}
      />
      <p>
        {zip
          ? 'Extract script.js and run it with k6. The script is checked against this SHA-256 before packaging.'
          : 'Run it with k6 wherever you like. The download is checked against this SHA-256.'}
      </p>
      <p>The script stops at its declared time limit, including readiness and load.</p>
      <StartNotes job={undefined} flow={flow} />
    </Dialog>
  );
}

function UnknownDialog({ job, flow, close, closeButton }: StateProps) {
  return (
    <Dialog
      className="script-export-dialog"
      title="We can’t tell whether this export finished"
      onClose={close}
      actions={
        <>
          {closeButton}
          <CancelButton job={job} flow={flow} />
        </>
      }
    >
      <p>
        The agent stopped answering. The export stays Unknown and keeps its reserved space until the agent reports back;
        Beetle Lab never guesses a result.
      </p>
      <Facts
        items={[
          ['Last recorded report', <ExportTime key="heard" value={job.lastAgentReportAt} />],
          ['Reserved', `${sizeText(job.budget.outputBytes)} of output`],
        ]}
      />
      <CancelFailure flow={flow} />
    </Dialog>
  );
}

function PreparingDialog({
  job,
  ordinal,
  flow,
  close,
  closeButton,
}: Omit<StateProps, 'job'> & { job: ExportJob | undefined; ordinal: number }) {
  return (
    <Dialog
      className="script-export-dialog"
      title={`Preparing a k6 script from revision ${ordinal}`}
      onClose={close}
      description="The agent builds a standalone script; no load is sent and nothing is run. You can close this and come back to it from the revision."
      actions={
        <>
          {closeButton}
          {job && <CancelButton job={job} flow={flow} />}
        </>
      }
    >
      <Steps job={job} />
      <CancelFailure flow={flow} />
    </Dialog>
  );
}

type Stage = 'ready' | 'unknown' | 'preparing' | 'start';
function stageOf(job: ExportJob | undefined, preparing: boolean): Stage {
  if (job?.state === 'ready' && job.artifact) return 'ready';
  if (job?.state === 'unknown') return 'unknown';
  return (job && stepIndex(job.state) >= 0) || preparing ? 'preparing' : 'start';
}

function ExportState({
  job,
  name,
  revision,
  flow,
  close,
  closeButton,
  zip,
}: {
  job: ExportJob | undefined;
  name: string;
  zip: boolean;
  revision: SuiteRevision;
  flow: RevisionExport;
  close: () => void;
  closeButton: ReactNode;
}) {
  const shared = { flow, close, closeButton };
  switch (stageOf(job, flow.preparing)) {
    case 'ready':
      return <ReadyDialog job={job!} name={name} zip={zip} {...shared} />;
    case 'unknown':
      return <UnknownDialog job={job!} {...shared} />;
    case 'preparing':
      return <PreparingDialog job={job} ordinal={revision.ordinal} {...shared} />;
    default:
      return <StartState job={job} revision={revision} {...shared} />;
  }
}
function StartNotes({ job, flow }: { job: ExportJob | undefined; flow: RevisionExport }) {
  const { readOnly } = useSessionAccess();
  const errors = [flow.inputsFailed ? 'Could not read the workspace settings.' : '', flow.problem].filter(Boolean);
  return (
    <>
      {job?.reason && <p>{reasonText(job.reason)}.</p>}
      {flow.noEngine && <p>No export engine is installed.</p>}
      {errors.map((error) => (
        <p key={error} role="alert" className="field-error">
          {error}
        </p>
      ))}
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
const endedTitle = { failed: 'The last export failed', cancelled: 'The last export was cancelled' } as Record<
  string,
  string
>;

function StartState({
  job,
  revision,
  flow,
  close,
  closeButton,
}: {
  job: ExportJob | undefined;
  revision: SuiteRevision;
  flow: RevisionExport;
  close: () => void;
  closeButton: ReactNode;
}) {
  const { readOnly } = useSessionAccess();
  const ended = endedTitle[job?.state ?? ''];
  return (
    <Dialog
      className="script-export-dialog"
      title={ended ?? `Export revision ${revision.ordinal} as a k6 script`}
      onClose={close}
      description="The agent builds a standalone script that runs with plain k6. No load is sent."
      actions={
        <>
          {closeButton}
          <Button variant="primary" disabled={readOnly || flow.noEngine || flow.create.unknown} onClick={flow.prepare}>
            {ended ? 'Prepare again' : 'Prepare script'}
          </Button>
        </>
      }
    >
      <p>New scripts inherit this workspace’s configured run timeout, including readiness and load.</p>
      <Link to={routes.workspaceSettings(revision.scope.organizationId, revision.scope.workspaceId)}>
        Workspace settings
      </Link>
      <StartNotes job={ended ? job : undefined} flow={flow} />
    </Dialog>
  );
}
