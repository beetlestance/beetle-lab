import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inputContentPath} from '@beetle/contracts/api';
import type {InputRecord} from '@beetle/contracts/api';
import type {automaticSession} from '../compose/public.js';
import {readReadyPublic} from '../compose/public.js';
import {pause, value} from '../public-api.js';
/** Full storage may fence metadata. Preserve unknown, free only filler, restart and replay the exact intent. */
export async function deleteUnderFull(client: Awaited<ReturnType<typeof automaticSession>>, record: InputRecord,
 operations: {fill(action: 'fill' | 'free'): unknown; restart(): void}) {
 const params = {organizationId: record.scope.organizationId, workspaceId: record.scope.workspaceId, inputId: record.id};
 const intent = {scope: record.scope, requestId: randomUUID(), expectedVersion: record.version};
 const full = operations.fill('fill'); const deletion = await client.api.deleteInput({params, body: intent});
 if (!deletion.ok) assert(deletion.error.kind === 'protocol' && deletion.error.status === 503);
 const during = await client.api.getInput({params});
 if (during.ok) assert(['published', 'deleting', 'deleted'].includes(during.value.state));
 else assert(during.error.kind === 'protocol' && during.error.status === 503);
 const observed = {accepted: deletion.ok, state: during.ok ? during.value.state : 'unknown', readStatus: during.ok ? 200 : during.error.status};
 const free = operations.fill('free'); operations.restart();
 const afterRestart = await readReadyPublic(signal => client.api.getInput({params, signal}));
 assert(['published', 'deleting', 'deleted'].includes(afterRestart.state));
 value(await client.api.deleteInput({params, body: intent}));
 for (let calls = 0; calls < 40; calls++) {record = value(await client.api.getInput({params})); if (record.state === 'deleted') break; await pause();}
 assert.equal(record.state, 'deleted'); const missing = await client.content(inputContentPath(params)); assert.equal(missing.status, 409); await missing.body?.cancel();
 return {full, during: observed, free, restarted: true, sameIntentReplayed: true, deleted: true, contentStatus: missing.status};
}
