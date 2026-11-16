import { encodeRunEventCursor } from '@beetle/contracts/api';
import type { ApiClient, Run, RunEventPage } from '@beetle/contracts/api';
import { readResult } from '../../../app/api.js';
import { project, type Timeline } from './projection.js';
export interface Owner { scope: Run['scope']; runId: string; attemptId: string; active: boolean }
type PageReader = (limit: number, cursor?: string) => Promise<RunEventPage>;
function assertLive(owner: Owner, signal: AbortSignal) {
  if (!owner.active || signal.aborted) throw new DOMException('Activity read retired', 'AbortError');
}
/** Return only projected facts before issuing the second read, releasing its raw first page. */
async function bootstrap(read: PageReader, owner: Owner) {
  const page = await read(1);
  const skipped = page.durableThrough > 100;
  const cursor = skipped ? encodeRunEventCursor({ organizationId: owner.scope.organizationId, workspaceId: owner.scope.workspaceId,
    runId: owner.runId, attemptId: owner.attemptId, generation: 1, afterSeq: page.durableThrough - 100 }) : page.resumeCursor;
  return { initial: project(page), more: page.nextCursor !== null, skipped, cursor };
}
export async function readTimeline(input: {
  api: ApiClient; owner: Owner; signal: AbortSignal; previous: Timeline | undefined;
}): Promise<Timeline> {
  const { api, owner, signal, previous } = input;
  const read: PageReader = async (limit, cursor) => {
    assertLive(owner, signal);
    const page = await readResult(api.listRunEvents({ params: { organizationId: owner.scope.organizationId,
      workspaceId: owner.scope.workspaceId, runId: owner.runId },
      query: { limit, ...(cursor === undefined ? {} : { cursor }) }, signal }));
    assertLive(owner, signal);
    if (page.activeAttemptId.toLowerCase() !== owner.attemptId.toLowerCase()) throw new Error('Activity attempt changed; refresh run details');
    return page;
  };
  if (previous) return project(await read(100, previous.cursor), previous);
  const plan = await bootstrap(read, owner);
  if (!plan.more) return plan.initial;
  const tail = await read(100, plan.cursor);
  return project(tail, plan.skipped ? undefined : plan.initial, plan.skipped);
}
