import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Suite } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { Button, buttonClass } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { LoadingState } from '../../components/States.js';

export function savedWhen(savedAt: string | null | undefined, savedBy: string | null | undefined, now = new Date()) {
  const parts: string[] = [];
  if (savedAt) {
    const date = new Date(savedAt);
    if (!Number.isNaN(date.getTime())) {
      const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      parts.push(
        date.toDateString() === now.toDateString()
          ? `at ${time}`
          : `on ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`,
      );
    }
  }
  if (savedBy) parts.push(`by ${savedBy}`);
  return parts.join(' ');
}

/** The suite and its current revision, read fresh for the conflict overlay and dropped when it closes. */
function useLatest(suite: Suite) {
  const api = useApi();
  const client = useQueryClient();
  const { organizationId, workspaceId } = suite.scope;
  const key = [...queryKeys.suite(organizationId, workspaceId, suite.id), 'conflict'] as const;
  const fresh = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      readResult(api.getSuite({ params: { organizationId, workspaceId, suiteId: suite.id }, signal })),
    gcTime: 0,
  });
  const currentId = fresh.data?.currentRevisionId ?? '';
  const revision = useQuery({
    queryKey: queryKeys.suiteRevision(organizationId, workspaceId, currentId),
    enabled: !!currentId,
    queryFn: async ({ signal }) => {
      const value = await readResult(
        api.getSuiteRevision({ params: { organizationId, workspaceId, revisionId: currentId }, signal }),
      );
      if (value.suiteId !== suite.id) throw new Error('Revision belongs to another suite');
      return value;
    },
  });
  useEffect(() => () => client.removeQueries({ queryKey: key }), [client]);
  return {
    version: fresh.data?.version,
    latest: revision.data,
    ready: !!fresh.data && (!currentId || !!revision.data),
    failed: fresh.isError || revision.isError,
    retry: () => {
      void fresh.refetch();
      if (currentId) void revision.refetch();
    },
  };
}

function CopyButton({ draft, failed }: { draft: () => string; failed: (value: boolean) => void }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={() => {
        const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
        if (!clipboard) return failed(true);
        let text: string;
        try {
          text = draft();
        } catch {
          return failed(true);
        }
        clipboard.writeText(text).then(
          () => setDone(true),
          () => failed(true),
        );
      }}
    >
      {done ? 'Copied' : 'Copy my edits'}
    </Button>
  );
}

/**
 * "Overlay / Save conflict": another save moved the suite on. Reads the suite and its current revision
 * fresh; the draft stays untouched until the person chooses.
 */
export function ConflictDialog({
  suite,
  draft,
  close,
  saveOver,
}: {
  suite: Suite;
  draft: () => string;
  close: () => void;
  saveOver: (version: number) => void;
}) {
  const { organizationId, workspaceId } = suite.scope;
  const { version, latest, ready, failed, retry } = useLatest(suite);
  const [copyFailed, setCopyFailed] = useState(false);
  const title = latest
    ? `Revision ${latest.ordinal} was saved ${savedWhen(latest.savedAt, latest.savedBy)}`.trim()
    : 'Another revision was saved';
  return (
    <Dialog
      title={title}
      onClose={close}
      description="Your edits are still here and were not saved. Save them on top as the next revision, or copy them first and look at what changed."
      actions={
        <>
          <CopyButton draft={draft} failed={setCopyFailed} />
          {latest && (
            <a
              className={buttonClass('secondary')}
              href={routes.suiteScript(organizationId, workspaceId, suite.id, latest.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open revision {latest.ordinal}
            </a>
          )}
          <Button variant="primary" disabled={!ready} onClick={() => version !== undefined && saveOver(version)}>
            {latest ? `Save as revision ${latest.ordinal + 1}` : 'Save on top'}
          </Button>
        </>
      }
    >
      <p className="editor-note">The copy includes your configuration, suite details and revision message.</p>
      {!ready && !failed && <LoadingState label="Reading the latest revision…" />}
      {failed && (
        <div role="alert">
          <p className="field-error">Could not read the latest revision. Your draft is kept.</p>
          <Button size="sm" onClick={retry}>
            Retry reading
          </Button>
        </div>
      )}
      {copyFailed && (
        <p className="field-error">
          Copying failed. Your configuration and suite details are still kept in this editor.
        </p>
      )}
    </Dialog>
  );
}
