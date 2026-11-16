import { expect, it } from 'vitest';
import { fixture, metric, uuid } from '../../run-comparison/fixture.js';
import { httpFixture } from './fixture.js';
it('serves generated comparison JSON over paired authenticated TCP and refuses foreign/body/query input before source reads', async () => {
  const f = fixture(); const service = f.service(); const http = await httpFixture(service);
  const params = {organizationId: f.request.scope.organizationId, workspaceId: f.request.scope.workspaceId};
  const path = `/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}/comparisons`;
  const raw = (body: unknown, patch: Record<string, string> = {}, suffix = '') => fetch(http.origin + path + suffix,
    {method: 'POST', headers: {...http.headers, 'content-type': 'application/json', ...patch}, body: JSON.stringify(body)});
  try {
    const request = {...f.request, metric}; const result = await http.client.compareRuns({params, body: request});
    expect(result).toMatchObject({ok: true, value: {baselineRunId: request.runIds[0], metricBinding: {requestId: 'get', assertionId: null}}});
    const before = f.calls.length;
    expect((await fetch(http.origin + path, {method: 'POST', headers: {origin: http.origin, 'content-type': 'application/json'}, body: '{}'})).status).toBe(401);
    expect((await raw(request, {'x-beetle-csrf': 'wrong'})).status).toBe(403);
    expect((await raw(request, {origin: 'http://127.0.0.1:1'})).status).toBe(403);
    expect((await raw({...request, scope: {...request.scope, workspaceId: uuid(999)}})).status).toBe(403);
    expect((await raw({...request, extra: true})).status).toBe(400);
    expect((await raw(request, {}, '?ignored=yes')).status).toBe(400);
    expect((await raw({...request, padding: 'x'.repeat(4096)})).status).toBe(413);
    expect(f.calls).toHaveLength(before);
  } finally {await http.close();}
});
