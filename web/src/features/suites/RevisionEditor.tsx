import { useState } from 'react';
import type { CreateSuiteRevisionRequest, Suite, SuiteRevision } from '@beetle/contracts/api';
import { useApi } from '../../app/api.js';
import { ConfigFields } from './ConfigFields.js';
import { draftText, parseDraft, starter } from './draft.js';
import { useWrite, WriteStatus } from './useWrite.js';

export function RevisionEditor({ suite, initial, refresh }: { suite: Suite; initial?: SuiteRevision; refresh: () => Promise<unknown> }) {
  const api = useApi();
  const [text, setText] = useState(() => initial ? draftText(initial.config) : starter());
  const [invalidPart, setInvalidPart] = useState(false);
  const [error, setError] = useState('');
  const params = { organizationId: suite.scope.organizationId, workspaceId: suite.scope.workspaceId, suiteId: suite.id };
  const write = useWrite<CreateSuiteRevisionRequest>((body, signal) => api.createSuiteRevision({ params, body, signal }), refresh);
  function save() {
    try {
      const config = parseDraft(text); setError('');
      void write.submit({ scope: suite.scope, requestId: crypto.randomUUID(), expectedVersion: suite.version, engineId: 'k6', configVersion: 1, config });
    } catch (caught) { setError((caught as Error).message); }
  }
  return <section className="suite-editor" aria-label="New immutable revision">
    <h2>New immutable revision</h2><p>Saving appends a revision; earlier revisions stay unchanged. Configuration limit: 1 MiB UTF-8.</p>
    <form onSubmit={event => { event.preventDefault(); save(); }}>
      <ConfigFields text={text} change={setText} disabled={write.locked} validity={setInvalidPart} />
      {error && <p role="alert" className="notice error">{error}</p>}
      <button className="primary" disabled={write.locked || invalidPart} type="submit">Save new revision</button>
    </form>
    <WriteStatus write={write} refresh={refresh} />
    <p>Server structural preflight is reported on saved revisions. Engine semantic validation and execution have not run.</p>
  </section>;
}
