import { useLayoutEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ApiContext, useApi } from '../app/api.js';
import { ReadGate } from '../lib/read-gate.js';
/** Coordinate finite detail panels without changing storage caps or retrying HTTP calls. */
export function ReadAdmission({ children }: { children: ReactNode }) {
  const api = useApi();
  const owner = useMemo(() => ({ metadata: new ReadGate(), metrics: new ReadGate() }), [api]);
  useLayoutEffect(() => {
    const metadata = new ReadGate();
    const metrics = new ReadGate();
    owner.metadata = metadata;
    owner.metrics = metrics;
    return () => {
      metadata.close();
      metrics.close();
    };
  }, [owner]);
  const client = useMemo(
    () => ({
      ...api,
      getWorkspaceSettings: (request: Parameters<typeof api.getWorkspaceSettings>[0]) =>
        owner.metadata.run(request.signal, () => api.getWorkspaceSettings(request)),
      listWorkspaceRetention: (request: Parameters<typeof api.listWorkspaceRetention>[0]) =>
        owner.metadata.run(request.signal, () => api.listWorkspaceRetention(request)),
      getWorkspaceRetentionPreview: (request: Parameters<typeof api.getWorkspaceRetentionPreview>[0]) =>
        owner.metadata.run(request.signal, () => api.getWorkspaceRetentionPreview(request)),
      getWorkspaceRetentionStatus: (request: Parameters<typeof api.getWorkspaceRetentionStatus>[0]) =>
        owner.metadata.run(request.signal, () => api.getWorkspaceRetentionStatus(request)),
      getSuite: (request: Parameters<typeof api.getSuite>[0]) =>
        owner.metadata.run(request.signal, () => api.getSuite(request)),
      getSuiteRevision: (request: Parameters<typeof api.getSuiteRevision>[0]) =>
        owner.metadata.run(request.signal, () => api.getSuiteRevision(request)),
      listSuites: (request: Parameters<typeof api.listSuites>[0]) =>
        owner.metadata.run(request.signal, () => api.listSuites(request)),
      listSuiteRevisions: (request: Parameters<typeof api.listSuiteRevisions>[0]) =>
        owner.metadata.run(request.signal, () => api.listSuiteRevisions(request)),
      getRunResult: (request: Parameters<typeof api.getRunResult>[0]) =>
        owner.metadata.run(request.signal, () => api.getRunResult(request)),
      listRunEvents: (request: Parameters<typeof api.listRunEvents>[0]) =>
        owner.metadata.run(request.signal, () => api.listRunEvents(request)),
      listRunArtifacts: (request: Parameters<typeof api.listRunArtifacts>[0]) =>
        owner.metadata.run(request.signal, () => api.listRunArtifacts(request)),
      listRunMetricSeries: (request: Parameters<typeof api.listRunMetricSeries>[0]) =>
        owner.metrics.run(request.signal, () => api.listRunMetricSeries(request)),
      getRunChartHistory: (request: Parameters<typeof api.getRunChartHistory>[0]) =>
        owner.metrics.run(request.signal, () => api.getRunChartHistory(request)),
      getRunMetricOverview: (request: Parameters<typeof api.getRunMetricOverview>[0]) =>
        owner.metrics.run(request.signal, () => api.getRunMetricOverview(request)),
      getRunLatencyAttribution: (request: Parameters<typeof api.getRunLatencyAttribution>[0]) =>
        owner.metrics.run(request.signal, () => api.getRunLatencyAttribution(request)),
      getRunMetricSamples: (request: Parameters<typeof api.getRunMetricSamples>[0]) =>
        owner.metrics.run(request.signal, () => api.getRunMetricSamples(request)),
    }),
    [api, owner],
  );
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}
