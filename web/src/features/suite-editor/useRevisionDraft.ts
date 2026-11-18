import { normalizedMetadata, useMetadataDraft } from './metadata.js';
import { useCallback, useEffect, useState } from 'react';
import type { ApiClientFailure, Suite, SuiteRevision } from '@beetle/contracts/api';
import { formatDraft, parseDraft, starter } from '../suites/draft.js';
import type { Config } from '../suites/draft.js';
import { useRevisionSave } from './useRevisionSave.js';
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

const messageProblem = (message: string) =>
  hasControlCharacter(message) ? 'Use a single line without control characters.' : '';

function collectProblems(
  config: Config | null,
  attempted: boolean,
  missing: readonly Problem[],
  failure: ApiClientFailure | null,
): Problem[] {
  if (!config) return [...missing];
  return [...(attempted ? validate(config) : []), ...missing, ...serverProblems(failure, config)];
}

/** Draft text, revision message and the createSuiteRevision write behind "Suite / Edit". */
export function useRevisionDraft(
  suite: Suite,
  initial: SuiteRevision | undefined,
  refresh: () => Promise<unknown>,
  baseVersion = suite.version,
) {
  const metadata = useMetadataDraft(suite);
  const [baseline, setBaseline] = useState(() => (initial ? formatDraft(initial.config) : starter()));
  const [text, setText] = useState(baseline);
  const [message, setMessage] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const saved = useRevisionSave(suite, initial?.ordinal ?? 0, baseVersion, refresh);
  const write = saved.write;
  const reset = () => {
    setMessage('');
    setAttempted(false);
  };
  useEffect(() => {
    const ack = saved.acknowledged;
    if (!ack) return;
    setBaseline(ack.text);
    metadata.acknowledge(ack.metadata, ack.patch, ack.version);
    setMessage((previous) => (previous === ack.message ? '' : previous));
    setAttempted(false);
  }, [saved.acknowledged]);
  const config = tryParse(text);
  const catalog = useInputCatalog(suite.scope, config ? inputReferences(config) : []);
  const messageError = messageProblem(message);
  const problems = [...metadata.problems, ...collectProblems(config, attempted, catalog.problems, write.failure)];
  const validity = useCallback((bad: boolean) => setInvalid(bad), []);

  function submit(version?: number) {
    setAttempted(true);
    if (!config || messageError || validate(config).length || catalog.problems.length || metadata.problems.length)
      return;
    saved.send({ text, config, message, metadata: normalizedMetadata(metadata.value), patch: metadata.patch }, version);
  }
  return {
    text,
    setText,
    message,
    setMessage,
    messageError,
    metadata,
    dirty: initial === undefined || text !== baseline || message !== '' || metadata.dirty,
    blocked: invalid || !!messageError || metadata.problems.length > 0,
    validity,
    catalog,
    problems,
    write,
    next: saved.next,
    saved: saved.saved,
    conflict: saved.conflict,
    closeConflict: saved.closeConflict,
    save: () => submit(),
    saveOver: (version: number) => submit(version),
    discard: () => {
      setText(baseline);
      metadata.discard();
      reset();
      write.newIntent();
    },
  };
}
