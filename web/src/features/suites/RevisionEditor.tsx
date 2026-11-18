import { useSessionAccess } from '../../app/session.js';
import type { Suite, SuiteRevision } from '@beetle/contracts/api';
import { ConflictDialog } from '../suite-editor/ConflictDialog.js';
import { requestKey } from '../suite-editor/model.js';
import { jumpTo } from '../suite-editor/problems.js';
import { SavePanel } from '../suite-editor/SavePanel.js';
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
    const setup = /^\/(loadPlan\/scenarios\/[1-9]|selections|readiness|targetSampling)/.test(path);
    const request = /^\/requests\/(\d+)\/(name|query|headers|assertions|body\/format)/.exec(path);
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
  initial,
  refresh,
}: {
  suite: Suite;
  initial?: SuiteRevision;
  refresh: () => Promise<unknown>;
}) {
  const draft = useRevisionDraft(suite, initial, refresh);
  const { readOnly } = useSessionAccess();
  const { page, update } = useSuitePage();
  const view: EditorView = { mode: page.view, request: page.request };
  const setView = (next: EditorView) => update({ view: next.mode, request: next.request }, { push: true });
  return (
    <section className="suite-editor-layout" aria-label="Edit suite configuration">
      <div className="suite-editor-main">
        <ConfigFields
          text={draft.text}
          change={draft.setText}
          disabled={readOnly || draft.write.locked}
          validity={draft.validity}
          inputs={draft.catalog}
          view={view}
          setView={setView}
        />
      </div>
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
      {draft.conflict && (
        <ConflictDialog suite={suite} draft={draft.text} close={draft.closeConflict} saveOver={draft.saveOver} />
      )}
    </section>
  );
}
