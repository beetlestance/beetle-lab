import { useEffect, useRef } from 'react';
import { Button } from '../../components/Button.js';
import type { EditorView } from '../suites/ConfigFields.js';
import { parseDraft } from '../suites/draft.js';
import { objects, requestIndex, text as string } from './model.js';

function pageTitle(text: string, view: EditorView): string {
  if (view.mode === 'run-setup') return 'Run setup';
  try {
    const config = parseDraft(text);
    const at = requestIndex(config, view.request);
    const request = at === null ? undefined : objects(config.requests)[at];
    return request ? `Request: ${string(request.method)} ${string(request.path)}` : 'Request';
  } catch {
    return 'Request';
  }
}
/** Done returns to the shared draft; only Save revision commits it. */
export function EditorPageHeader({ text, view, close }: { text: string; view: EditorView; close: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [view.mode, view.request]);
  const label = view.mode === 'run-setup' ? 'Back to editor' : 'Back to requests';
  return (
    <header className="editor-page-header">
      <h1 ref={heading} tabIndex={-1}>
        {pageTitle(text, view)}
      </h1>
      <div>
        <Button variant="text" onClick={close}>
          {label}
        </Button>
        <Button onClick={close}>Done</Button>
      </div>
    </header>
  );
}
