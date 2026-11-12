import { afterAll, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ApiClientResult, Run } from '@beetle/contracts/api';
import { openApplication } from '../../../src/bootstrap/api.js';
import { authenticatedClient } from '../../../src/client/cli/auth.js';
import { parseOptions } from '../../../src/client/cli/options.js';
import { nodeFetch } from '../../../src/client/cli/http.js';
import { runClient } from '../../../src/client/cli/main.js';
import { storageFixture, observation, settingsFixture } from '../../storage/fixture.js';
import { runOptions } from '../../storage/runs-fixture.js';
import { request as revisionRequest } from '../../storage/suites-fixture.js';
const storage = storageFixture(); const roots: string[] = [];
afterAll(async () => {await Promise.all(roots.map(root => rm(root, {recursive: true, force: true})));});
function value<T>(result: ApiClientResult<T>): T {if (!result.ok) throw new Error(`Synthetic setup ${result.error.kind}`); return result.value;}
function captures() {
  const stdout: string[] = []; const stderr: string[] = [];
  return {stdout, stderr, streams: {stdout: {write: async (text: string) => {stdout.push(text);}}, stderr: {write: async (text: string) => {stderr.push(text);}}}};
}
it('pairs over real TCP, enqueues/replays/cancels durable runs and compares them without frontend or engine execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beetle-automation-http-')); roots.push(root);
  const origin = 'http://127.0.0.1:43127'; const settings = settingsFixture();
  const app = await openApplication({externalOrigin: origin, metadata: {path: storage.path(), workerUrl: storage.workerUrl(),
    installation: settings.chain.installation, runtime: observation(settings.runtime), ...runOptions()}});
  try {
    await app.server.listen({host: '127.0.0.1', port: 0}); const address = app.server.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing synthetic listener');
    const endpoint = `http://127.0.0.1:${address.port}`; const session = join(root, 'session.json'); const token = join(root, 'token');
    await writeFile(token, app.bootstrapToken + '\n', {mode: 0o600});
    const common = ['--endpoint', endpoint, '--origin', origin, '--session-file', session]; const paired = captures();
    expect(await runClient(['pair', ...common, '--token-file', token], paired.streams)).toBe(0);
    expect(paired.stdout).toEqual(['{"paired":true}\n']); expect(paired.stderr).toEqual([]);
    const saved = await readFile(session, 'utf8'); expect(saved).not.toContain(app.bootstrapToken); expect((await stat(session)).mode & 0o777).toBe(0o600);
    const api = await authenticatedClient(parseOptions(['pair', ...common, '--token-file', token]));
    const org = value(await api.createOrganization({body: {scope: {kind: 'installation'}, requestId: randomUUID(), name: 'Synthetic CI', slug: 'synthetic-ci'}}));
    const workspace = value(await api.createWorkspace({params: {organizationId: org.id}, body: {scope: {kind: 'organization', organizationId: org.id}, requestId: randomUUID(), name: 'Synthetic workspace'}}));
    const scope = {kind: 'workspace' as const, organizationId: org.id, workspaceId: workspace.id}; const params = {organizationId: org.id, workspaceId: workspace.id};
    const suite = value(await api.createSuite({params, body: {scope, requestId: randomUUID(), name: 'Synthetic test'}}));
    const revision = value(await api.createSuiteRevision({params: {...params, suiteId: suite.id}, body: {...revisionRequest(), scope, requestId: randomUUID()}}));
    const requestFile = join(root, 'run.json'); const runBody = {scope, requestId: randomUUID(), revisionId: revision.id, engineProfile: 'standard',
      budget: settings.chain.installation.values.runDefaults.budget, executionPolicy: {mode: 'parallel', preferIdle: false}};
    await writeFile(requestFile, JSON.stringify(runBody)); const submitted = captures();
    expect(await runClient(['run', ...common, '--request-file', requestFile], submitted.streams)).toBe(0);
    const first = (JSON.parse(submitted.stdout[0]!) as {run: Run}).run; expect(first.state).toBe('queued');
    const runFlags = ['--organization', org.id, '--workspace', workspace.id, '--run', first.id];
    const status = captures(); expect(await runClient(['status', ...common, ...runFlags], status.streams)).toBe(5); expect(status.stdout.join('')).toContain('"waiting":true');
    const cancelFile = join(root, 'cancel.json'); await writeFile(cancelFile, JSON.stringify({scope, requestId: randomUUID()}));
    expect(await runClient(['cancel', ...common, ...runFlags, '--request-file', cancelFile], captures().streams)).toBe(0);
    const cancelled = captures(); expect(await runClient(['status', ...common, ...runFlags], cancelled.streams)).toBe(4);
    expect((JSON.parse(cancelled.stdout[0]!) as {run: Run}).run.state).toBe('cancelled');
    const result = captures(); expect(await runClient(['result', ...common, ...runFlags], result.streams)).toBe(0); expect(JSON.parse(result.stdout[0]!) as object).toMatchObject({result: null});
    await writeFile(requestFile, JSON.stringify({...runBody, requestId: randomUUID()})); let mutations = 0;
    const lost: typeof fetch = async (input, init) => {const response = await nodeFetch(input, init); if (init?.method === 'POST') {mutations++; await response.body?.cancel(); throw new Error('Synthetic lost reply secret canary');} return response;};
    const unknown = captures(); expect(await runClient(['run', ...common, '--request-file', requestFile], unknown.streams, lost)).toBe(3);
    expect(mutations).toBe(1); expect(unknown.stderr.join('')).toContain('outcome_unknown'); expect(unknown.stderr.join('')).not.toContain('canary');
    const replay = captures(); expect(await runClient(['run', ...common, '--request-file', requestFile], replay.streams)).toBe(0);
    const second = (JSON.parse(replay.stdout[0]!) as {run: Run}).run;
    expect(value(await api.listRuns({params, query: {limit: 100}})).items).toHaveLength(2);
    await writeFile(cancelFile, JSON.stringify({scope, requestId: randomUUID()}));
    expect(await runClient(['cancel', ...common, ...runFlags.slice(0, 4), '--run', second.id, '--request-file', cancelFile], captures().streams)).toBe(0);
    const comparisonFile = join(root, 'compare.json'); await writeFile(comparisonFile, JSON.stringify({scope, runIds: [first.id, second.id], metric: null}));
    const compared = captures(); expect(await runClient(['compare', ...common, '--request-file', comparisonFile], compared.streams)).toBe(0);
    expect(JSON.parse(compared.stdout[0]!) as object).toMatchObject({baselineRunId: first.id, items: [{run: {id: first.id}}, {run: {id: second.id}}]});
    expect(compared.stdout.join('')).not.toContain(app.bootstrapToken); expect(compared.stdout.join('')).not.toContain(JSON.parse(saved).cookie as string);
  } finally {await app.close();}
});
