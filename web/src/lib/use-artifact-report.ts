import { useEffect, useMemo, useState } from 'react';
import type { ArtifactRead } from './verified-artifact.js';
export interface ArtifactReader<T> {read(input: ArtifactRead): Promise<T>}
type State<T> = {readonly owner: object; readonly status: 'loading' | 'error'}
  | {readonly owner: object; readonly status: 'ready'; readonly value: T};
/** Session/selection display lease; timeout retires display without refunding physical reader credits. */
export function useArtifactReport<T>(selection: Omit<ArtifactRead, 'signal'>, reads: ArtifactReader<T>, session: object) {
  const {params, artifact} = selection;
  const {organizationId, workspaceId, runId, attemptId, artifactId} = params;
  const {bytes, kind, sha256, relativePath, sealedAt} = artifact; const selectedId = artifact.artifactId;
  const owner = useMemo(() => ({session, params: {organizationId, workspaceId, runId, attemptId, artifactId},
    artifact: {artifactId: selectedId, bytes, kind, sha256, relativePath, sealedAt}, reads}),
    [session, reads, organizationId, workspaceId, runId, attemptId, artifactId, selectedId, bytes, kind, sha256, relativePath, sealedAt]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State<T>>({owner, status: 'loading'});
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setState({owner, status: 'loading'});
    const timer = setTimeout(() => {
      controller.abort(); if (active) setState({owner, status: 'error'});
    }, 5000);
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error('Artifact report retired');
      return owner.reads.read({params: owner.params, artifact: owner.artifact, signal: controller.signal});
    }).then(value => {
      clearTimeout(timer);
      if (active && !controller.signal.aborted) setState({owner, status: 'ready', value});
    }, () => {
      clearTimeout(timer);
      if (active && !controller.signal.aborted) setState({owner, status: 'error'});
    });
    return () => {active = false; clearTimeout(timer); controller.abort();};
  }, [owner, revision]);
  return {state: state.owner === owner ? state : {owner, status: 'loading' as const}, retry: () => setRevision(value => value + 1)};
}
