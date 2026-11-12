import { executionArtifacts } from '@beetle/contracts';
import { expect, it, vi } from 'vitest';
import { runArtifactContentPath } from '@beetle/contracts/api';
import { published } from './fixture.js';
import { httpFixture } from './http-fixture.js';
import { RunArtifacts } from '../../src/adapters/outbound/sqlite/run-artifacts/index.js';
import type { RunArtifactPage } from '@beetle/contracts/api';
import type { PublishedArtifactRead } from '../../src/ports/run-artifacts.js';
import { deferred, pending } from '../files/output-bytes/fixture.js';
import { scope } from '../storage/fixture.js';
async function controlled() {
  const f = await published([Buffer.from('synthetic original')]); const reader = new RunArtifacts(f.db, f.reads);
  const params = {organizationId: scope.organizationId, workspaceId: scope.workspaceId, runId: f.key.runId,
    attemptId: f.key.attempt.attemptId, artifactId: executionArtifacts(f.envelope.manifest.result)[0]!.artifactId};
  const release = deferred(); const nativeDone = deferred(); let signal: AbortSignal | undefined;
  const http = await httpFixture({listRunArtifacts: async query => reader.execute({kind: 'listRunArtifacts', query}) as RunArtifactPage,
    getRunArtifact: async key => reader.execute({kind: 'getRunArtifact', key}) as PublishedArtifactRead}, {read: (request, context) => {
      signal = context.signal;
      const job = f.files.store.read(request, context);
      const settled = job.settled.then(async () => {nativeDone.resolve(); await release.promise;});
      return {result: job.result, settled};
    }});
  return {f, http, release, nativeDone, path: runArtifactContentPath(params), signal: () => signal};
}
it('withholds chunked EOF and the one HTTP credit until native settlement, then completes verified content', async () => {
  const c = await controlled();
  try {
    const response = await c.http.request(c.path); const body = response.arrayBuffer(); await c.nativeDone.promise;
    expect(await pending(body)).toBe(true);
    const refused = await c.http.request(c.path); expect(refused.status).toBe(503);
    c.release.resolve(); expect(Buffer.from(await body).toString()).toBe('synthetic original');
  } finally {c.release.resolve(); await c.http.close(); await c.f.files.dispose();}
});
it('disconnect cancels the original and shutdown retains ownership until late native settlement', async () => {
  const c = await controlled();
  try {
    const abort = new AbortController();
    const response = await fetch(c.http.origin + c.path, {headers: c.http.headers, signal: abort.signal});
    const body = response.arrayBuffer(); const rejected = expect(body).rejects.toThrow();
    await c.nativeDone.promise; abort.abort(); await rejected;
    await vi.waitFor(() => expect(c.signal()?.aborted).toBe(true));
    const close = c.http.routes.close(); expect(await pending(close)).toBe(true);
    expect((await c.http.request(c.path)).status).toBe(503);
    c.release.resolve(); await close;
  } finally {c.release.resolve(); await c.http.close(); await c.f.files.dispose();}
});
it.each(['settlement', 'streamed hash'] as const)('destroys midstream bytes without successful EOF on %s failure', async mode => {
  const f = await published([Buffer.from('synthetic original')]); const reader = new RunArtifacts(f.db, f.reads);
  const params = {organizationId: scope.organizationId, workspaceId: scope.workspaceId, runId: f.key.runId,
    attemptId: f.key.attempt.attemptId, artifactId: executionArtifacts(f.envelope.manifest.result)[0]!.artifactId};
  const http = await httpFixture({listRunArtifacts: async query => reader.execute({kind: 'listRunArtifacts', query}) as RunArtifactPage,
    getRunArtifact: async key => reader.execute({kind: 'getRunArtifact', key}) as PublishedArtifactRead}, {read: (request, context) => {
      const job = f.files.store.read({...request, sink: {write: async chunk => {
        const altered = Buffer.from(chunk); if (mode === 'streamed hash') altered[0] = altered[0]! ^ 1;
        await request.sink.write(altered);
      }}}, context);
      return {result: job.result, settled: job.settled.then(() => {if (mode === 'settlement') throw new Error('Synthetic failed close check');})};
    }});
  try {
    const response = await http.request(runArtifactContentPath(params));
    await expect(response.arrayBuffer()).rejects.toThrow();
  } finally {await http.close(); await f.files.dispose();}
});
