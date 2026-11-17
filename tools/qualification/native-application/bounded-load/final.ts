import assert from 'node:assert/strict';
import type { Run } from '@beetle/contracts/api';
import { runArtifactContentPath } from '@beetle/contracts/api';
import { readContent, hash } from '../compose/public.js';
import type { automaticSession } from '../compose/public.js';
import { readyContent } from '../compose/content-readiness.js';
import { finalDrain } from '../soak/final.js';
import { value } from '../public-api.js';
import { numericEvidence } from './numeric.js';
export async function final(
  client: Awaited<ReturnType<typeof automaticSession>>,
  run: Run,
  captured?: (value: Awaited<ReturnType<typeof finalDrain>>) => void,
) {
  const drained = await finalDrain(client, run);
  captured?.(drained);
  const params = {
    organizationId: run.scope.organizationId,
    workspaceId: run.scope.workspaceId,
    runId: run.id,
    attemptId: run.activeAttemptId,
  };
  const listed = value(await client.api.listRunArtifacts({ params, query: { limit: 100 } }));
  const item = listed.items.find((row) => row.kind === 'numeric-final');
  assert(item && item.bytes <= 65536);
  const bytes = await readContent(
    await readyContent((signal) =>
      client.content(runArtifactContentPath({ ...params, artifactId: item.artifactId }), {}, signal),
    ),
    65536,
  );
  assert.equal(bytes.length, item.bytes);
  assert.equal(hash(bytes), item.sha256);
  return {
    ...drained,
    numeric: numericEvidence(JSON.parse(bytes.toString()), {
      organizationId: run.scope.organizationId,
      workspaceId: run.scope.workspaceId,
      attemptId: run.activeAttemptId,
      generation: 1,
    }),
  };
}
