import fixture from '../../../../../contracts/fixtures/api/valid/run-comparison.json' with {type: 'json'};
import { render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { StrictMode } from 'react';
import { comparisonFields, comparisonWarnings, validateApi } from '@beetle/contracts/api';
import type { RunComparisonSnapshot, RunMetricKey } from '@beetle/contracts/api';
import { ApiContext } from '../../../app/api.js';
import { routes } from '../../../app/routes.js';
import { RunComparison } from './index.js';
import { page, samples, series } from '../metrics/fixtures.js';
export { json, testClient, deferred, apiError } from '../../../app/test-fixtures.js';
const checked = validateApi('RunComparisonSnapshot', fixture);
if (!checked.ok) throw new Error('Invalid comparison fixture');
const source = checked.value;
export const scope = {organizationId: source.scope.organizationId, workspaceId: source.scope.workspaceId};
export const runIds = source.items.map(item => item.run.id);
export function snapshot(metric: RunMetricKey | null = null, ids = runIds): RunComparisonSnapshot {
  const result = structuredClone(source); result.metric = metric; result.baselineRunId = ids[0]!;
  result.metricBinding = metric ? {requestId: null, assertionId: null} : null;
  result.items = ids.map((id, index) => {
    const item = structuredClone(source.items[Math.min(index, 1)]!); item.run.id = id;
    if (metric) item.metric = {availability: 'ready', reason: null, series: {...series, ordinal: index + 2},
      manifestDigest: 'c'.repeat(64), measurementSourceTimeMs: 0, coverage: page().coverage};
    return item;
  });
  result.items.forEach(item => {item.differences.fields = comparisonFields(result.items[0]!, item); item.warnings = comparisonWarnings(item);});
  return result;
}
export function catalogue() {
  const run = source.items[0]!.run;
  return {...page(), scope: source.scope, id: run.id, attemptId: run.activeAttemptId};
}
export function sampleReply(id: string, ordinal: number, ids = runIds) {
  const run = snapshot(null, ids).items.find(item => item.run.id === id)!.run;
  return {...samples(1, 1, {...series, ordinal}), id, scope: source.scope, attemptId: run.activeAttemptId, windows: 1, nextCursor: null};
}
function Navigation() {
  const navigate = useNavigate();
  return <button onClick={() => void navigate(routes.comparison(scope.organizationId, scope.workspaceId, [...runIds].reverse()))}>Reverse runs</button>;
}
export function mountComparison(api: React.ContextType<typeof ApiContext>, strict = false, search?: string) {
  const path = search ?? routes.comparison(scope.organizationId, scope.workspaceId, runIds);
  function surface(client = api) {return <ApiContext.Provider value={client}><RunComparison {...scope} /><Navigation /></ApiContext.Provider>;}
  const wrap = (client = api) => <MemoryRouter initialEntries={[path]}>{strict ? <StrictMode>{surface(client)}</StrictMode> : surface(client)}</MemoryRouter>;
  const view = render(wrap()); return {...view, session: (client: typeof api) => view.rerender(wrap(client))};
}
