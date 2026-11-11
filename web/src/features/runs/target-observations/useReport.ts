import { useEffect, useMemo, useState } from 'react';
import type { TargetRuntimeReport } from '@beetle/contracts/target-runtime';
import { useApi } from '../../../app/api.js';
import { targetReportReads } from './read.js';
import type { TargetRead, TargetReportReads } from './read.js';
type Reader = Pick<TargetReportReads, 'read'>;
type State = {readonly owner: object; readonly status: 'loading' | 'error'}
  | {readonly owner: object; readonly status: 'ready'; readonly report: TargetRuntimeReport};
export function useTargetReport(selection: Omit<TargetRead, 'signal'>, reads: Reader = targetReportReads) {
  const api = useApi(); const {params, artifact} = selection;
  const {organizationId, workspaceId, runId, attemptId, artifactId} = params;
  const {bytes, kind, sha256, relativePath, sealedAt} = artifact;
  const selectedId = artifact.artifactId;
  const owner = useMemo(() => ({session: api, params: {organizationId, workspaceId, runId, attemptId, artifactId},
    artifact: {artifactId: selectedId, bytes, kind, sha256, relativePath, sealedAt}, reads}),
    [api, reads, organizationId, workspaceId, runId, attemptId, artifactId, selectedId, bytes, kind, sha256, relativePath, sealedAt]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({owner, status: 'loading'});
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setState({owner, status: 'loading'});
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('Target report retired');
      return owner.reads.read({params: owner.params, artifact: owner.artifact, signal: controller.signal});
    }).then(report => {
      if (active && !controller.signal.aborted) setState({owner, status: 'ready', report});
    }, () => {if (active && !controller.signal.aborted) setState({owner, status: 'error'});});
    return () => {active = false; controller.abort();};
  }, [owner, revision]);
  return {state: state.owner === owner ? state : {owner, status: 'loading' as const}, retry: () => setRevision(value => value + 1)};
}
