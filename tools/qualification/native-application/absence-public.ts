import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ApiClient, Run } from '@beetle/contracts/api';
import { pause, value } from './public-api.js';

export async function finishedAbsence(api: ApiClient, queued: Run) {
  const params = { organizationId: queued.scope.organizationId, workspaceId: queued.scope.workspaceId, runId: queued.id };
  const deadline = Date.now() + 60000;
  for (let calls = 0; calls < 180 && Date.now() < deadline; calls++) {
    const run = value(await api.getRun({ params }));
    if (['finished', 'cancelled', 'errored'].includes(run.state)) {
      assert.equal(run.state, 'errored'); assert.equal(run.outcome, 'inconclusive');
      assert.equal(run.validationStatus, 'pending'); assert.equal(run.reason, 'budget_unavailable');
      const result = value(await api.getRunResult({ params }));
      assert.equal(result.result, null); assert.equal(result.activeAttemptId, run.activeAttemptId);
      const other = { ...params, workspaceId: randomUUID() };
      for (const denied of [await api.getRun({ params: other }), await api.getRunResult({ params: other })]) {
        assert(!denied.ok && denied.error.status === 404, 'Wrong workspace must not expose run/result');
      }
      return { run, result, params };
    }
    await pause();
  }
  throw new Error('Public run did not reach verified absence settlement');
}
