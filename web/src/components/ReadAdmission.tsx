import { useLayoutEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ApiContext, useApi } from '../app/api.js';
import { ReadGate } from './read-gate.js';
/** Coordinate finite detail panels without changing storage caps or retrying HTTP calls. */
export function ReadAdmission({ children }: { children: ReactNode }) {
  const api = useApi();
  const owner = useMemo(() => ({ gate: new ReadGate() }), [api]);
  useLayoutEffect(() => {
    const gate = new ReadGate(); owner.gate = gate;
    return () => gate.close();
  }, [owner]);
  const client = useMemo(() => ({ ...api,
    getWorkspaceSettings:(request:Parameters<typeof api.getWorkspaceSettings>[0])=>owner.gate.run(request.signal,()=>api.getWorkspaceSettings(request)),
    listWorkspaceRetention:(request:Parameters<typeof api.listWorkspaceRetention>[0])=>owner.gate.run(request.signal,()=>api.listWorkspaceRetention(request)),
    getWorkspaceRetentionPreview:(request:Parameters<typeof api.getWorkspaceRetentionPreview>[0])=>owner.gate.run(request.signal,()=>api.getWorkspaceRetentionPreview(request)),
    getWorkspaceRetentionStatus:(request:Parameters<typeof api.getWorkspaceRetentionStatus>[0])=>owner.gate.run(request.signal,()=>api.getWorkspaceRetentionStatus(request)),
    getRunResult: (request: Parameters<typeof api.getRunResult>[0]) => owner.gate.run(request.signal, () => api.getRunResult(request)),
    listRunEvents: (request: Parameters<typeof api.listRunEvents>[0]) => owner.gate.run(request.signal, () => api.listRunEvents(request)),
    listRunArtifacts: (request: Parameters<typeof api.listRunArtifacts>[0]) => owner.gate.run(request.signal, () => api.listRunArtifacts(request)),
    listRunMetricSeries: (request: Parameters<typeof api.listRunMetricSeries>[0]) => owner.gate.run(request.signal, () => api.listRunMetricSeries(request)),
    getRunMetricSamples: (request: Parameters<typeof api.getRunMetricSamples>[0]) => owner.gate.run(request.signal, () => api.getRunMetricSamples(request)),
  }), [api, owner]);
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}
