import './start-run.css';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Suite, SuiteRevisionSummary, WorkspaceSettings } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { Banner } from '../../components/Banner.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { Checkbox, Select, TextInput } from '../../components/Fields.js';
import { QueryState } from '../../components/QueryState.js';
import type { RunValues } from '../execution-request/index.js';
import { captureRequest, initialValues } from '../execution-request/index.js';
import { useSubmission } from '../runs/useSubmission.js';
import { targetOf } from './details.js';
import { BudgetFacts, BudgetFields, Preview, RevisionSelect, useBudgetDraft } from './StartFields.js';

type StartProps = {
  suite: Suite;
  workspaceName: string;
  revisions: readonly SuiteRevisionSummary[];
  initialRevisionId: string;
  close: () => void;
};
/**
 * Start run dialog: pick a saved revision, preview its plan, review the effective
 * budget (or change it for this run only), and submit through createRun. The
 * target is read-only because a run cannot override it.
 */
export function StartRun(props: StartProps) {
  const { suite, close } = props;
  const api = useApi();
  const client = useQueryClient();
  const { organizationId, workspaceId } = suite.scope;
  const settingsKey = queryKeys.workspaceSettings(organizationId, workspaceId);
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: ({ signal }) => readResult(api.getWorkspaceSettings({ params: { organizationId, workspaceId }, signal })),
  });
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: settingsKey, type: 'inactive' });
      client.removeQueries({ queryKey: settingsKey, type: 'inactive' });
    },
    [client, organizationId, workspaceId],
  );
  return (
    <Dialog className="start-run-dialog" title={`Start ${suite.name}`} onClose={close}>
      {settings.data ? (
        <StartForm {...props} settings={settings.data} />
      ) : (
        <>
          <QueryState query={settings}>{() => null}</QueryState>
          <div className="dialog-actions">
            <Button variant="text" onClick={close}>
              Not now
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
/** The chosen revision, rejected if it belongs to another suite. */
function useSuiteRevision(suite: Suite, revisionId: string) {
  const api = useApi();
  const { organizationId, workspaceId } = suite.scope;
  return useQuery({
    queryKey: queryKeys.suiteRevision(organizationId, workspaceId, revisionId),
    queryFn: async ({ signal }) => {
      const result = await readResult(
        api.getSuiteRevision({ params: { organizationId, workspaceId, revisionId }, signal }),
      );
      if (result.suiteId !== suite.id) throw new Error('Revision belongs to another suite');
      return result;
    },
  });
}
function StartForm({
  suite,
  workspaceName,
  revisions,
  initialRevisionId,
  settings,
  close,
}: StartProps & { settings: WorkspaceSettings }) {
  const [revisionId, setRevisionId] = useState(initialRevisionId);
  const [values, setValues] = useState(() => initialValues(settings));
  const draft = useBudgetDraft(values);
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = useSubmission();
  const locked = submit.pending || submit.unknown;
  const revision = useSuiteRevision(suite, revisionId);
  const listed = revisions.some((item) => item.id === revisionId);
  const options = listed || !revision.data ? revisions : [revision.data, ...revisions];
  function send() {
    if (locked || !revision.data) return;
    try {
      const run = { ...values, budget: draft.budget };
      const body = captureRequest({ revision: revision.data, settings, values: run, requestId: crypto.randomUUID() });
      if (note.trim()) body.note = note;
      setError(null);
      void submit.send(body);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Check the entered values.');
    }
  }
  return (
    <form
      className="start-run"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <fieldset disabled={locked}>
        <legend className="sr-only">Run settings</legend>
        <RevisionSelect suite={suite} options={options} value={revisionId} onChange={setRevisionId} />
        <QueryState query={revision}>{(saved) => <Preview revision={saved} />}</QueryState>
        <BudgetFacts
          settings={settings}
          revision={revision.data}
          limitMs={Number(draft.budget.timeoutMs)}
          workspaceName={workspaceName}
          changing={changing}
          change={() => setChanging(true)}
          target={revision.data ? targetOf(revision.data.config) : null}
        />
        <RunOptions settings={settings} values={values} setValues={setValues} />
        {changing && <BudgetFields settings={settings} text={draft.text} change={draft.change} />}
        <TextInput
          label="Note for this run (optional)"
          value={note}
          maxLength={1000}
          placeholder="For example: after the connection-pool fix"
          onChange={(event) => setNote(event.target.value)}
        />
      </fieldset>
      <SubmitBar submit={submit} error={error} ready={Boolean(revision.data)} close={close} />
    </form>
  );
}
function RunOptions({
  settings,
  values,
  setValues,
}: {
  settings: WorkspaceSettings;
  values: RunValues;
  setValues: (values: RunValues) => void;
}) {
  const profiles = settings.effective.runDefaults.engineProfile.allowedValues;
  return (
    <>
      {profiles.length > 1 && (
        <Select
          label="Engine profile"
          value={values.profile}
          onChange={(event) => setValues({ ...values, profile: event.target.value })}
        >
          {profiles.map((profile) => (
            <option key={profile}>{profile}</option>
          ))}
        </Select>
      )}
      <Checkbox
        label="Run alone. Other runs wait until this one ends."
        checked={values.mode === 'isolated'}
        onChange={(event) => setValues({ ...values, mode: event.target.checked ? 'isolated' : 'parallel' })}
      />
    </>
  );
}
function SubmitBar({
  submit,
  error,
  ready,
  close,
}: {
  submit: ReturnType<typeof useSubmission>;
  error: string | null;
  ready: boolean;
  close: () => void;
}) {
  const locked = submit.pending || submit.unknown;
  return (
    <>
      {(error || submit.message) && (
        <Banner
          tone="danger"
          actions={
            submit.unknown && (
              <Button size="sm" disabled={submit.pending} onClick={() => void submit.send()}>
                Replay original request
              </Button>
            )
          }
        >
          {error ?? submit.message}
        </Banner>
      )}
      <div className="dialog-actions">
        <Button variant="text" disabled={locked} onClick={close}>
          Not now
        </Button>
        <Button
          variant="primary"
          type="submit"
          loading={submit.pending}
          loadingLabel="Starting…"
          disabled={!ready || submit.unknown}
        >
          Start run
        </Button>
      </div>
    </>
  );
}
