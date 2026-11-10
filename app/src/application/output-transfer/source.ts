import { validate } from '@beetle/contracts';
import type { ClientResult, ClientFailure } from '@beetle/contracts';
import type { Owned, SourceEnvelope } from '@beetle/contracts/output-source';
import type { EventBinding } from '../../ports/events.js';
import type { OutputTransferOptions } from '../../ports/output-transfer.js';
import type { RunnerOutputClient } from '../../ports/output-source.js';
import type { OutputCustodyState } from '../../ports/output-custody.js';
import type { TransferOwner } from './ownership.js';
import { fail, requireTransfer as check } from './errors.js';
import { envelope, matchedState, state } from './validation.js';

export function sourceReply<T>(reply: ClientResult<T>, original: EventBinding, pending = false): T | null {
  if (reply.ok) return reply.value;
  const error = reply.error;
  if (error.kind === 'cancelled') fail('cancelled');
  if (error.kind !== 'protocol') fail('transport');
  return disposition(error, original, pending);
}
function disposition(error: ClientFailure, original: EventBinding, pending: boolean): null {
  const value = error.protocol;
  if (!value) fail('transport');
  if (error.status !== 409 || value.attemptId !== original.key.attempt.attemptId) fail('transport');
  check(value.organizationId === original.key.attempt.organizationId
    && value.workspaceId === original.key.attempt.workspaceId, 'transport');
  if (value.reason === 'source_unavailable' && value.retry === 'never') fail('source_unavailable');
  if (pending) return initialSourceDisposition(value);
  fail('transport');
}
function initialSourceDisposition(value: NonNullable<ClientFailure['protocol']>): null {
  if (value.reason === 'source_pending' && value.retry === 'transport') return null;
  if (value.reason === 'source_absent' && value.retry === 'never') {
    check(validate('ProtocolError', value).ok, 'transport'); fail('source_absent');
  }
  fail('transport');
}
export function client(options: OutputTransferOptions, owner: TransferOwner, original: EventBinding): RunnerOutputClient {
  owner.check();
  const output = options.gateway.output({...original.key.attempt, journalAuthority: original.journalAuthority});
  owner.check(); return output;
}
export async function loadSource(options: OutputTransferOptions, owner: TransferOwner, original: EventBinding): Promise<{
  source: Owned<SourceEnvelope>; state: Extract<OutputCustodyState, {kind: 'adopted'}>;
} | null> {
  let retained = state(await owner.call(() => options.metadata.load(original)), original);
  if (retained.kind === 'pending') {
    const output = client(options, owner, original);
    const reply = await owner.call(() => output.source(owner.controller.signal));
    const remote = sourceReply(reply, original, true); if (remote === null) return null;
    const captured = envelope(remote, original);
    retained = state(await owner.call(() => options.metadata.adopt({binding: original, envelope: captured})), original);
    check(retained.kind === 'adopted'); matchedState(retained, captured);
  }
  check(retained.kind === 'adopted');
  const local = await owner.call(() => options.metadata.readSource(original)); check(local !== null);
  const source = envelope(local, original); matchedState(retained, source);
  return {source, state: retained};
}
