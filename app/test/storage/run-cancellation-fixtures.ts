import { prepareCancelRunCommand } from '../../src/application/runs/index.js';
import type { CancelRunRequest } from '@beetle/contracts/api';
import type { ClaimsFixture } from './dispatch-claim-fixtures.js';
import { digest, scope, requestId, uuid } from './fixture.js';

export function cancelCommand(id = uuid(70), request: CancelRunRequest = { scope, requestId: requestId() }) {
  return prepareCancelRunCommand({ kind: 'cancelRun', id, request }, digest);
}
export function cancel(f: ClaimsFixture, command = cancelCommand()) {
  return f.store.execute({ kind: 'cancelRun', command });
}
export function retained(f: ClaimsFixture) {
  return ['attempts', 'dispatch_outbox', 'execution_intents', 'execution_records', 'attempt_output_allocations', 'installation_storage_usage']
    .map(table => f.db.prepare(`SELECT * FROM ${table}`).all());
}
