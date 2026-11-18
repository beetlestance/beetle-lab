import { useEffect, useRef, useState } from 'react';
import type { CreateSuiteRevisionRequest, Suite, SuiteMetadataChanges, SuiteRevision } from '@beetle/contracts/api';
import { useApi } from '../../app/api.js';
import { useWrite } from '../suites/useWrite.js';
import type { Config } from '../suites/draft.js';
import type { MetadataValues } from './metadata.js';

export type RevisionSubmission = {
  text: string;
  config: Config;
  message: string;
  metadata: MetadataValues;
  patch: SuiteMetadataChanges | undefined;
};
export type AcknowledgedRevision = RevisionSubmission & { version: number };
/** Owns the frozen optimistic version, one mutation attempt and its actual receipt. */
export function useRevisionSave(
  suite: Suite,
  initialOrdinal: number,
  baseVersion: number,
  refresh: () => Promise<unknown>,
) {
  const api = useApi();
  const params = {
    organizationId: suite.scope.organizationId,
    workspaceId: suite.scope.workspaceId,
    suiteId: suite.id,
  };
  const write = useWrite<CreateSuiteRevisionRequest, SuiteRevision>(
    (body, signal) => api.createSuiteRevision({ params, body, signal }),
    refresh,
  );
  const [version, setVersion] = useState(baseVersion);
  const [next, setNext] = useState(initialOrdinal + 1);
  const [saved, setSaved] = useState<number | null>(null);
  const [acknowledged, setAcknowledged] = useState<AcknowledgedRevision | null>(null);
  const [conflict, setConflict] = useState(false);
  const submitted = useRef<AcknowledgedRevision | null>(null);
  useEffect(() => {
    if (!write.value || !submitted.current) return;
    setVersion(submitted.current.version + 1);
    setNext(write.value.ordinal + 1);
    setSaved(write.value.ordinal);
    setAcknowledged(submitted.current);
  }, [write.value]);
  useEffect(() => {
    const failure = write.failure?.protocol;
    setConflict(failure?.code === 'conflict' && !failure.fields.some((field) => field.path.startsWith('/metadata/')));
  }, [write.failure]);
  function send(draft: RevisionSubmission, override?: number) {
    if (override !== undefined) {
      setConflict(false);
      write.newIntent();
    }
    const expectedVersion = override ?? version;
    submitted.current = { ...draft, version: expectedVersion };
    setSaved(null);
    const note = draft.message.trim();
    void write.submit({
      scope: suite.scope,
      requestId: crypto.randomUUID(),
      expectedVersion,
      engineId: 'k6',
      configVersion: 1,
      config: draft.config,
      ...(note ? { message: note } : {}),
      ...(draft.patch ? { metadata: draft.patch } : {}),
    });
  }
  return { write, acknowledged, send, status: { next, saved, conflict, closeConflict: () => setConflict(false) } };
}
