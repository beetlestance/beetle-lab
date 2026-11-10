import { eventFixture, request } from '../storage/events/fixtures.js';
import { payloadFixture } from '../storage/output-payload-fixtures.js';
import { EventCustody } from '../../src/adapters/outbound/sqlite/event-custody/index.js';
import { RunEvents } from '../../src/adapters/outbound/sqlite/run-events/index.js';
import { RunReads } from '../../src/adapters/outbound/sqlite/run-reads.js';
import { Suites } from '../../src/adapters/outbound/sqlite/suites.js';
import { Entities } from '../../src/adapters/outbound/sqlite/entities.js';
export { scope, uuid } from '../storage/fixture.js';
export { request, event } from '../storage/events/fixtures.js';
export { guardsOff } from '../run-results/fixture.js';
export function fixture() {
  const f = payloadFixture(90000);
  const reader = new RunEvents(f.db, f.reads);
  const events = new EventCustody(f.db, 'synthetic-installation');
  const query = { id: f.key.runId, scope: f.reads.get({ id: f.key.runId, scope: { kind: 'workspace',
    organizationId: f.key.attempt.organizationId, workspaceId: f.key.attempt.workspaceId } }).scope, limit: 100 };
  return { ...f, reader, events, query };
}
export function smallFixture() {
  const f = eventFixture(90000);
  const reads = new RunReads(f.db, new Suites(f.db, new Entities(f.db)));
  return { ...f, reader: new RunEvents(f.db, reads), request: request(f.binding) };
}
