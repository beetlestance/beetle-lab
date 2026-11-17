import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClientFailure, CreateSuiteRevisionRequest, Suite, SuiteRevision } from '@beetle/contracts/api';
import { useApi } from '../../app/api.js';
import { formatDraft, parseDraft, starter } from '../suites/draft.js';
import type { Config } from '../suites/draft.js';
import { useWrite } from '../suites/useWrite.js';
import { useInputCatalog } from './inputs.js';
import { inputReferences } from './model.js';
import { serverProblems, validate } from './problems.js';
import type { Problem } from './problems.js';

function tryParse(text: string): Config | null {
  try {
    return parseDraft(text);
  } catch {
    return null;
  }
}
const hasControlCharacter = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });

function collectProblems(
  config: Config | null,
  attempted: boolean,
  missing: readonly Problem[],
  failure: ApiClientFailure | null,
): Problem[] {
  if (!config) return [...missing];
  return [...(attempted ? validate(config) : []), ...missing, ...serverProblems(failure, config)];
}

/** Ordinal of the latest acknowledged revision and the one this session just saved. */
function useAcknowledged(value: SuiteRevision | null | undefined, initial: number, saved: () => void) {
  const [ordinal, setOrdinal] = useState(initial);
  const [done, setDone] = useState<number | null>(null);
  const latest = useRef(saved);
  latest.current = saved;
  useEffect(() => {
    if (!value) return;
    setOrdinal(value.ordinal);
    setDone(value.ordinal);
    latest.current();
  }, [value]);
  return { ordinal, saved: done, setSaved: setDone };
}

/** Draft text, revision message and the createSuiteRevision write behind "Suite / Edit". */
export function useRevisionDraft(suite: Suite, initial: SuiteRevision | undefined, refresh: () => Promise<unknown>) {
  const api = useApi();
  const [baseline, setBaseline] = useState(() => (initial ? formatDraft(initial.config) : starter()));
  const [text, setText] = useState(baseline);
  const [message, setMessage] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [conflict, setConflict] = useState(false);
  const submitted = useRef<string | null>(null);
  const reset = () => {
    setMessage('');
    setAttempted(false);
  };
  const params = {
    organizationId: suite.scope.organizationId,
    workspaceId: suite.scope.workspaceId,
    suiteId: suite.id,
  };
  const write = useWrite<CreateSuiteRevisionRequest, SuiteRevision>(
    (body, signal) => api.createSuiteRevision({ params, body, signal }),
    refresh,
  );
  const { ordinal, saved, setSaved } = useAcknowledged(write.value, initial?.ordinal ?? 0, () => {
    if (submitted.current !== null) setBaseline(submitted.current);
    reset();
  });
  useEffect(() => setConflict(write.failure?.protocol?.code === 'conflict'), [write.failure]);
  const config = tryParse(text);
  const catalog = useInputCatalog(suite.scope, config ? inputReferences(config) : []);
  const messageError = hasControlCharacter(message) ? 'Use a single line without control characters.' : '';
  const problems = collectProblems(config, attempted, catalog.problems, write.failure);
  const validity = useCallback((bad: boolean) => setInvalid(bad), []);

  function submit(expectedVersion: number) {
    setAttempted(true);
    if (!config || messageError || validate(config).length || catalog.problems.length) return;
    submitted.current = text;
    setSaved(null);
    const note = message.trim();
    void write.submit({
      scope: suite.scope,
      requestId: crypto.randomUUID(),
      expectedVersion,
      engineId: 'k6',
      configVersion: 1,
      config,
      ...(note ? { message: note } : {}),
    });
  }
  return {
    text,
    setText,
    message,
    setMessage,
    messageError,
    dirty: text !== baseline || message !== '',
    blocked: invalid || !!messageError,
    validity,
    catalog,
    problems,
    write,
    next: ordinal + 1,
    saved,
    conflict,
    closeConflict: () => setConflict(false),
    save: () => submit(suite.version),
    saveOver: (version: number) => {
      setConflict(false);
      write.newIntent();
      submit(version);
    },
    discard: () => {
      setText(baseline);
      reset();
      write.newIntent();
    },
  };
}
