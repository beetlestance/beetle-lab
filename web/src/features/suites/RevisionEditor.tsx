import { RawDraftContext } from '../suite-editor/raw-drafts.js';
import { encodeJson } from '@beetle/contracts';
import { normalizedMetadata } from '../suite-editor/metadata.js';
import { MetadataFields } from '../suite-editor/MetadataFields.js';
import { useSessionAccess } from '../../app/session.js';
import type { Suite, SuiteRevision, Workspace } from '@beetle/contracts/api';
import { ConflictDialog } from '../suite-editor/ConflictDialog.js';
import { EditorPageHeader } from '../suite-editor/EditorPageHeader.js';
import '../suite-editor/request-detail.css';
import { requestKey } from '../suite-editor/model.js';
import { jumpTo } from '../suite-editor/problems.js';
import { ProblemList, SavePanel } from '../suite-editor/SavePanel.js';
import { useRevisionDraft } from '../suite-editor/useRevisionDraft.js';
import '../suite-editor/editor.css';
import { ConfigFields } from './ConfigFields.js';
import type { EditorView } from './ConfigFields.js';
import { parseDraft } from './draft.js';
import { useSuitePage } from './useSuitePage.js';

/** The URL key of request `index`, or its position while the draft does not parse. */
function keyOf(text: string, index: number): string {
  try {
    return requestKey(parseDraft(text), index);
  } catch {
    return String(index + 1);
  }
}
/** Switches to the view that shows `path`, then focuses it once rendered. */
function jumpFor(text: string, setView: (view: EditorView) => void) {
  return (path: string) => {
    const setup =
      /^\/(loadPlan\/scenarios\/[1-9]|selections|readiness|targetSampling|secrets|datasets)/.test(path) ||
      /^\/loadPlan\/scenarios\/0\/(?!stages|executor|maxVUs)/.test(path);
    const request = /^\/requests\/(\d+)\/(name|query|headers|assertions|body)/.exec(path);
    if (!path) setView({ mode: 'json', request: null });
    else if (setup) setView({ mode: 'run-setup', request: null });
    else setView({ mode: 'form', request: request ? keyOf(text, Number(request[1])) : null });
    // The target view renders on the next frame.
    setTimeout(() => jumpTo(path), 0);
  };
}

/**
 * "Suite / Edit": the form, Run setup and JSON views with the save panel beside (below
 * on tablets). The view and open request live in the URL (`view`, `request`).
 */
export function RevisionEditor({
  suite,
  workspace,
  initial,
  refresh,
  baseVersion,
}: {
  suite: Suite;
  workspace: Workspace;
  initial?: SuiteRevision;
  refresh: () => Promise<unknown>;
  baseVersion?: number;
}) {
  const draft = useRevisionDraft(suite, initial, refresh, baseVersion);
  const { readOnly } = useSessionAccess();
  const { page, update } = useSuitePage();
  const view: EditorView = { mode: page.view, request: page.request };
  const setView = (next: EditorView) => update({ view: next.mode, request: next.request }, { push: true });
  const subeditor = view.mode === 'run-setup' || view.request !== null;
  const closePage = () => setView({ mode: 'form', request: null });
  return (
    <RawDraftContext.Provider value={draft.raw}>
      {subeditor && <EditorPageHeader text={draft.text} view={view} close={closePage} />}
      {subeditor && draft.problems.length > 0 && (
        <div className="editor-subpage-problems">
          <ProblemList problems={draft.problems} jump={jumpFor(draft.text, setView)} />
        </div>
      )}
      <section
        className={subeditor ? 'suite-editor-layout suite-editor-subpage' : 'suite-editor-layout'}
        aria-label="Edit suite configuration"
      >
        <div className="suite-editor-main">
          <ConfigFields
            scope={suite.scope}
            resetVersion={draft.resetVersion}
            metadata={
              <MetadataFields
                workspace={workspace}
                value={draft.metadata.value}
                change={draft.metadata.change}
                problems={draft.problems}
              />
            }
            text={draft.text}
            change={draft.setText}
            disabled={readOnly || draft.write.locked}
            validity={draft.validity}
            inputs={draft.catalog}
            view={view}
            setView={setView}
          />
        </div>
        {!subeditor && (
          <aside className="suite-editor-side">
            <SavePanel
              next={draft.next}
              message={draft.message}
              setMessage={draft.setMessage}
              messageError={draft.messageError}
              dirty={draft.dirty}
              blocked={readOnly || draft.blocked}
              problems={draft.problems}
              write={draft.write}
              saved={draft.saved}
              save={draft.save}
              discard={draft.discard}
              jump={jumpFor(draft.text, setView)}
            />
          </aside>
        )}
        {draft.conflict && <DraftConflict suite={suite} draft={draft} />}
      </section>
    </RawDraftContext.Provider>
  );
}

function DraftConflict({ suite, draft }: { suite: Suite; draft: ReturnType<typeof useRevisionDraft> }) {
  return (
    <ConflictDialog
      suite={suite}
      draft={() =>
        encodeJson(
          {
            config: parseDraft(draft.text),
            ...(draft.raw.dirty ? { unfinishedJson: draft.raw.snapshot() } : {}),
            metadata: {
              ...normalizedMetadata(draft.metadata.value),
              description: draft.metadata.value.description.trim() || null,
            },
            ...(draft.message.trim() ? { message: draft.message.trim() } : {}),
          },
          2097152,
        )
      }
      close={draft.closeConflict}
      saveOver={draft.saveOver}
    />
  );
}
