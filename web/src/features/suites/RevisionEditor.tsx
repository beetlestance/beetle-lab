import { useState } from 'react';
import type { Suite, SuiteRevision } from '@beetle/contracts/api';
import { ConflictDialog } from '../suite-editor/ConflictDialog.js';
import { jumpTo } from '../suite-editor/problems.js';
import { SavePanel } from '../suite-editor/SavePanel.js';
import { useRevisionDraft } from '../suite-editor/useRevisionDraft.js';
import '../suite-editor/editor.css';
import { ConfigFields } from './ConfigFields.js';
import type { EditorView } from './ConfigFields.js';

/** Switches to the view that shows `path`, then focuses it once rendered. */
function jumpFor(setView: (view: EditorView) => void) {
  return (path: string) => {
    const setup = /^\/(loadPlan\/scenarios\/[1-9]|selections|readiness|targetSampling)/.test(path);
    const request = /^\/requests\/(\d+)\/(name|query|headers|assertions|body\/format)/.exec(path);
    if (!path) setView({ mode: 'json', request: null });
    else setView({ mode: setup ? 'setup' : 'form', request: request ? Number(request[1]) : null });
    // The target view renders on the next frame.
    setTimeout(() => jumpTo(path), 0);
  };
}

/** "Suite / Edit": the form, Run setup and JSON views with the save panel beside (below on tablets). */
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
  const [view, setView] = useState<EditorView>({ mode: 'form', request: null });
  return (
    <section className="suite-editor-layout" aria-label="Edit suite configuration">
      <div className="suite-editor-main">
        <ConfigFields
          text={draft.text}
          change={draft.setText}
          disabled={draft.write.locked}
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
          blocked={draft.blocked}
          problems={draft.problems}
          write={draft.write}
          saved={draft.saved}
          save={draft.save}
          discard={draft.discard}
          jump={jumpFor(setView)}
        />
      </aside>
      {draft.conflict && (
        <ConflictDialog suite={suite} draft={draft.text} close={draft.closeConflict} saveOver={draft.saveOver} />
      )}
    </section>
  );
}
