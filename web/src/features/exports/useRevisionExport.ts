import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ExportJob, SuiteRevision } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { exportRequest, exportTerminalStates } from './prepare.js';
import { useExportWrite } from './useWrite.js';

const live = (job: ExportJob | undefined) => !!job && !exportTerminalStates.includes(job.state);

/** Newest job for the revision on one bounded page (the API has no revision filter). */
function latestFor(items: readonly ExportJob[], revisionId: string): ExportJob | undefined {
  const id = revisionId.toLowerCase();
  return items
    .filter((job) => job.revisionId.toLowerCase() === id)
    .reduce<ExportJob | undefined>(
      (newest, job) => (!newest || Date.parse(job.requestedAt) > Date.parse(newest.requestedAt) ? job : newest),
      undefined,
    );
}

/** Settings and installed export profiles, read only once someone asks to prepare a script. */
function usePrepareInputs(revision: SuiteRevision, enabled: boolean) {
  const api = useApi();
  const { organizationId, workspaceId } = revision.scope;
  const params = { organizationId, workspaceId };
  const profiles = useQuery({
    queryKey: [...queryKeys.exports(organizationId, workspaceId), 'profiles'],
    queryFn: ({ signal }) => readResult(api.getExportProfiles({ params, signal })),
    enabled,
  });
  const settings = useQuery({
    queryKey: queryKeys.workspaceSettings(organizationId, workspaceId),
    queryFn: ({ signal }) => readResult(api.getWorkspaceSettings({ params, signal })),
    enabled,
  });
  return { profiles, settings };
}

/** The newest job for the revision on the first page, then that job (or one just created) polled. */
function useJob(revision: SuiteRevision, created: string | null) {
  const api = useApi();
  const { organizationId, workspaceId } = revision.scope;
  const params = { organizationId, workspaceId };
  const listing = useQuery({
    queryKey: [...queryKeys.exports(organizationId, workspaceId), 'page', 'revision', revision.id.toLowerCase()],
    queryFn: ({ signal }) => readResult(api.listExports({ params, query: { limit: 100 }, signal })),
    refetchInterval: (query) => (live(latestFor(query.state.data?.items ?? [], revision.id)) ? 2000 : false),
  });
  const latest = latestFor(listing.data?.items ?? [], revision.id);
  const followed = created ?? latest?.id ?? '';
  const detail = useQuery({
    queryKey: queryKeys.export(organizationId, workspaceId, followed),
    enabled: followed !== '',
    queryFn: ({ signal }) => readResult(api.getExport({ params: { ...params, exportId: followed }, signal })),
    refetchInterval: (query) => (query.state.status !== 'error' && live(query.state.data) ? 1000 : false),
  });
  return { listing, detail, job: detail.data ?? latest };
}

/** Builds and sends the create request; one made before settings and profiles arrive is sent once they do. */
function usePrepare(revision: SuiteRevision, create: ReturnType<typeof useExportWrite>) {
  const [asked, setAsked] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState('');
  const { profiles, settings } = usePrepareInputs(revision, asked);
  const failed = profiles.isError || settings.isError;
  const ready = !!profiles.data && !!settings.data;
  function send() {
    try {
      const body = exportRequest(revision, settings.data!, profiles.data!.profiles, crypto.randomUUID());
      setProblem('');
      void create.send({ kind: 'create', body });
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'The export could not be started.');
    }
  }
  useEffect(() => {
    if (!waiting || !ready) return;
    setWaiting(false);
    send();
  }, [waiting, ready]);
  return {
    prepare: () => {
      setAsked(true);
      if (ready) send();
      else setWaiting(true);
    },
    preparing: (waiting && !failed) || create.pending,
    inputsFailed: failed,
    noEngine: profiles.data?.profiles.length === 0,
    problem: problem || (create.message ?? ''),
  };
}

/**
 * The script export of one revision: finds the newest job for it on the first page of the
 * workspace's exports, follows a job this view creates, and polls only while it is preparing.
 */
export function useRevisionExport(revision: SuiteRevision) {
  const create = useExportWrite();
  const cancel = useExportWrite();
  const job = useJob(revision, create.id);
  return { ...job, ...usePrepare(revision, create), create, cancel };
}
