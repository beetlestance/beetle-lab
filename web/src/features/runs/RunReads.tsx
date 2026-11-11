import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ApiContext, useApi } from '../../app/api.js';
import { RunReadGate } from './read-gate.js';
/** Coordinate finite detail panels without changing storage caps or retrying HTTP calls. */
export function RunReads({ children }: { children: ReactNode }) {
  const api = useApi();
  const gate = useMemo(() => new RunReadGate(), [api]);
  useEffect(() => () => gate.close(), [gate]);
  const client = useMemo(() => ({ ...api,
    getRunResult: (request: Parameters<typeof api.getRunResult>[0]) => gate.run(request.signal, () => api.getRunResult(request)),
    listRunEvents: (request: Parameters<typeof api.listRunEvents>[0]) => gate.run(request.signal, () => api.listRunEvents(request)),
    listRunArtifacts: (request: Parameters<typeof api.listRunArtifacts>[0]) => gate.run(request.signal, () => api.listRunArtifacts(request)),
    listRunMetricSeries: (request: Parameters<typeof api.listRunMetricSeries>[0]) => gate.run(request.signal, () => api.listRunMetricSeries(request)),
    getRunMetricSamples: (request: Parameters<typeof api.getRunMetricSamples>[0]) => gate.run(request.signal, () => api.getRunMetricSamples(request)),
  }), [api, gate]);
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}
