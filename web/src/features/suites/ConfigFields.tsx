import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { SUITE_MAXIMUM_CONFIG_BYTES } from '@beetle/contracts/api';
import type { SuiteEditorView } from '../../app/routes.js';
import { JsonDraftInput } from '../suite-editor/JsonDraftInput.js';
import { SegmentedFilter } from '../../components/SegmentedFilter.js';
import type { InputCatalog } from '../suite-editor/fields.js';
import { AboutSection, LoadSection } from '../suite-editor/LoadSection.js';
import { DatasetsSection, ThresholdsSection } from '../suite-editor/PassAndData.js';
import { requestIndex, requestKey } from '../suite-editor/model.js';
import { fieldId } from '../suite-editor/problems.js';
import { RequestDetail } from '../suite-editor/RequestDetail.js';
import { RequestsSection } from '../suite-editor/RequestsSection.js';
import { RunSetup } from '../suite-editor/RunSetup.js';
import { formatDraft, parseDraft } from './draft.js';
import type { Config } from './draft.js';

/** The editor view as the URL holds it: `request` is a routes.suitePage request key. */
export type EditorView = { mode: SuiteEditorView; request: string | null };

type ConfigFieldsProps = {
  scope: WorkspaceScope;
  resetVersion: number;
  metadata?: ReactNode;
  text: string;
  change: (text: string) => void;
  disabled: boolean;
  validity: (invalid: boolean) => void;
  inputs: InputCatalog;
  view: EditorView;
  setView: (view: EditorView) => void;
};

function parse(text: string): { config: Config; error: string } {
  try {
    return { config: parseDraft(text), error: '' };
  } catch (caught) {
    return { config: {}, error: (caught as Error).message };
  }
}

type BodyProps = {
  scope: WorkspaceScope;
  metadata?: ReactNode;
  config: Config;
  set: (next: Config) => void;
  inputs: InputCatalog;
  view: EditorView;
  setView: (view: EditorView) => void;
};

/** The structured views: Run setup, one request, or every form section. */
function StructuredView({ config, set, inputs, view, setView, metadata, scope }: BodyProps) {
  if (view.mode === 'run-setup') return <RunSetup config={config} set={set} inputs={inputs} />;
  const request = requestIndex(config, view.request);
  if (request !== null)
    return (
      <RequestDetail
        key={requestKey(config, request)}
        scope={scope}
        config={config}
        set={set}
        index={request}
        inputs={inputs}
        close={() => setView({ mode: 'form', request: null })}
      />
    );
  return (
    <>
      <AboutSection config={config} set={set} metadata={metadata} />
      <LoadSection config={config} set={set} openSetup={() => setView({ mode: 'run-setup', request: null })} />
      <RequestsSection
        config={config}
        set={set}
        inputs={inputs}
        open={(request, addCheck) => {
          if (addCheck) addBlankCheck(config, request, set);
          setView({ mode: 'form', request: requestKey(config, request) });
        }}
      />
      <ThresholdsSection config={config} set={set} />
      <DatasetsSection config={config} set={set} inputs={inputs} />
      <p className="editor-note">
        Secrets and anything the form does not show stay in the complete JSON and are saved unchanged.
      </p>
    </>
  );
}

/** Form, Run setup and complete-JSON views over one draft text; the text is the only source of truth. */
export function ConfigFields({
  text,
  change,
  disabled,
  validity,
  inputs,
  view,
  setView,
  metadata,
  scope,
  resetVersion,
}: ConfigFieldsProps) {
  const [intakeError, setIntakeError] = useState('');
  useEffect(() => setIntakeError(''), [resetVersion]);
  const { config, error } = parse(text);
  const problem = error || intakeError;
  useEffect(() => {
    validity(!!problem);
  }, [problem, validity]);
  function set(next: Config) {
    try {
      change(formatDraft(next));
      setIntakeError('');
      return true;
    } catch {
      setIntakeError('That change would push the configuration past 1 MiB or the JSON limits; it was not applied.');
      return false;
    }
  }
  function editJson(next: string) {
    if (next.length > SUITE_MAXIMUM_CONFIG_BYTES)
      return setIntakeError('Text exceeds 1 MiB characters; previous draft retained.');
    setIntakeError('');
    change(next);
  }
  const structured = disabled || !!error;
  const subeditor = view.mode === 'run-setup' || view.request !== null;
  return (
    <div className="suite-config">
      {!subeditor && (
        <SegmentedFilter<SuiteEditorView>
          label="Configuration editor mode"
          value={view.mode}
          onChange={(mode) => setView({ mode, request: null })}
          options={[
            { value: 'form', label: 'Form editor', disabled: structured },
            { value: 'json', label: 'Complete configuration JSON', disabled },
          ]}
        />
      )}
      {problem && (
        <p role="alert" className="field-error">
          {problem}
        </p>
      )}
      <fieldset key={resetVersion} disabled={disabled} className="editor-sections">
        <legend className="sr-only">Configuration</legend>
        {view.mode === 'json' || error ? (
          <CompleteConfigJson text={text} editJson={editJson} parseError={error} />
        ) : (
          <StructuredView
            scope={scope}
            metadata={metadata}
            config={config}
            set={set}
            inputs={inputs}
            view={view}
            setView={setView}
          />
        )}
      </fieldset>
    </div>
  );
}

function addBlankCheck(config: Config, index: number, set: (next: Config) => void) {
  const requests = Array.isArray(config.requests) ? [...(config.requests as unknown[])] : [];
  const request = requests[index];
  if (!request || typeof request !== 'object' || Array.isArray(request)) return;
  const row = request as Record<string, unknown>;
  const checks = Array.isArray(row.assertions) ? row.assertions : [];
  const taken = new Set(
    checks.map((check) => (check && typeof check === 'object' ? (check as { id?: unknown }).id : '')),
  );
  let id = 'check';
  for (let n = 2; taken.has(id); n++) id = `check_${n}`;
  requests[index] = { ...row, assertions: [...checks, { id, required: true, kind: 'statusEq', value: 200 }] };
  set({ ...config, requests });
}

function CompleteConfigJson({
  text,
  editJson,
  parseError,
}: {
  text: string;
  editJson(text: string): void;
  parseError: string;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={fieldId('')}>
        Complete configuration JSON
      </label>
      <JsonDraftInput
        id={fieldId('')}
        autoFocus
        className="config-json"
        value={text}
        onChange={(event) => editJson(event.target.value)}
        aria-describedby="complete-json-help"
      />
      <p className="editor-note" id="complete-json-help">
        {parseError
          ? 'Fix the JSON to return to the form.'
          : 'JSON is parseable. Switching back to the form keeps these values. Save checks the complete configuration and any unfinished field edits.'}
      </p>
    </div>
  );
}
