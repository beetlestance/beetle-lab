import { ScriptSource } from './ScriptSource.js';
import { useQueries } from '@tanstack/react-query';
import type { ExportJob, SuiteRevision } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { Button } from '../../components/Button.js';
import { EmptyState, LoadingState } from '../../components/States.js';
import { maximumShownScriptBytes } from '../exports/scriptText.js';
import type { RevisionExport } from '../exports/ExportDialog.js';

/** Names of the input files the script opens, from the revision's input manifest (bounded). */
function useInputNames(revision: SuiteRevision): string[] | undefined {
  const api = useApi();
  const { organizationId, workspaceId } = revision.scope;
  const reads = useQueries({
    queries: revision.inputManifest
      .slice(0, 64)
      .map((entry) => ({
        queryKey: queryKeys.input(organizationId, workspaceId, entry.id),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          readResult(api.getInput({ params: { organizationId, workspaceId, inputId: entry.id }, signal })),
      })),
  });
  if (reads.some((read) => !read.data)) return undefined;
  return reads.map((read) => read.data!.name);
}

function NoScript({ job, flow, open }: { job: ExportJob | undefined; flow: RevisionExport; open: () => void }) {
  if (job && job.state !== 'ready' && job.state !== 'failed' && job.state !== 'cancelled')
    return (
      <EmptyState title="The script is being prepared" compact actions={<Button onClick={open}>Show progress</Button>}>
        The agent is writing a standalone k6 script for this revision. It appears here when it is ready.
      </EmptyState>
    );
  return (
    <EmptyState
      title="This revision has no script yet"
      compact
      actions={
        <Button variant="primary" onClick={open}>
          Prepare script
        </Button>
      }
    >
      A script is built on request by the agent from the saved revision; no load is sent.
      {flow.job?.state === 'failed' ? ' The last attempt failed.' : ''}
    </EmptyState>
  );
}

type ScriptRead = { data?: string | undefined; isError: boolean; isPending: boolean; error: Error | null };

function ReadyScript({ job, names, script }: { job: ExportJob; names: string[] | undefined; script: ScriptRead }) {
  const put = names?.length ? ` Put ${names.join(', ')} next to it.` : '';
  return (
    <>
      <p className="script-note">
        Runs with plain k6: <code>k6 run {job.artifact!.name}</code>.{put}
      </p>
      {script.isPending && <LoadingState label="Reading the script…" />}
      {script.isError && (
        <p role="alert" className="field-error">
          {script.error?.message ?? 'The script could not be read.'}
        </p>
      )}
      {script.data !== undefined && <ScriptSource text={script.data} />}
    </>
  );
}

/** "Script / revision": the exported script with line numbers, or a way to prepare one. */
export function ScriptTab({
  revision,
  flow,
  script,
  open,
}: {
  revision: SuiteRevision;
  flow: RevisionExport;
  script: ScriptRead;
  open: () => void;
}) {
  const names = useInputNames(revision);
  const job = flow.job;
  if (flow.listing.isError || flow.detail.isError)
    return (
      <div role="alert">
        <p className="field-error">Could not read this revision’s exports.</p>
        <Button
          onClick={() => {
            void flow.listing.refetch();
            if (flow.detail.isError) void flow.detail.refetch();
          }}
        >
          Retry exports
        </Button>
      </div>
    );
  if (flow.listing.isPending) return <LoadingState label="Looking for this revision’s script…" />;
  if (job?.state !== 'ready' || !job.artifact) return <NoScript job={job} flow={flow} open={open} />;
  if (job.artifact.bytes > maximumShownScriptBytes)
    return (
      <EmptyState
        title="The script is too large to show here"
        compact
        actions={<Button onClick={open}>Download</Button>}
      >
        It is {job.artifact.bytes.toLocaleString('en-US')} bytes. Download it to read it.
      </EmptyState>
    );
  return <ReadyScript job={job} names={names} script={script} />;
}
