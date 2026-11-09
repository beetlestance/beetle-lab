import type { InputControl, InputCommand, InputRecord } from '../../src/ports/inputs.js';
import type { Metadata } from '../../src/adapters/outbound/sqlite/index.js';
import { inputIntentDigest } from '../../src/adapters/outbound/sqlite/input-validation.js';
import { settingsFixture, observation, requestId, uuid, scope } from './fixture.js';
export function inputOptions(storageBytes = 10_000_000, reserve = 1000) {
  const value = settingsFixture();
  value.chain.installation.values.pool.storageBytes = storageBytes;
  value.chain.installation.values.pool.freeSpaceReserveBytes = reserve;
  value.runtime.pool.storageBytes = Number.MAX_SAFE_INTEGER;
  value.runtime.pool.freeSpaceReserveBytes = Number.MAX_SAFE_INTEGER;
  return { installation: value.chain.installation, runtime: observation(value.runtime) };
}
export function inputCommand(value: InputControl): InputCommand { return { ...value, intentDigest: inputIntentDigest(value) }; }
export function createInput(id = 90, bytes = 12, owner = scope): InputCommand {
  return inputCommand({ kind: 'createInput', id: uuid(id), request: { scope: owner, requestId: requestId(),
    name: ` Input ${id} `, sha256: 'a'.repeat(64), bytes } });
}
export function transition(input: InputRecord, kind: 'sealInput' | 'deleteInput', identity = requestId()): InputCommand {
  return inputCommand({ kind, id: input.id, request: { scope: input.scope, requestId: identity, expectedVersion: input.version } });
}
/** Trusted future byte-service advances only: no filesystem byte custody is established. */
export async function trustedPublish(metadata: Metadata, input: InputRecord): Promise<InputRecord> {
  const key = { scope: input.scope, id: input.id };
  if (input.bytes) input = await metadata.inputs.advance({ kind: 'commitInputOffset', key, expectedVersion: input.version, offset: input.bytes });
  const accepted = await metadata.inputs.control(transition(input, 'sealInput'));
  if (!('acceptedVersion' in accepted)) throw new Error('Expected seal fixture receipt');
  return metadata.inputs.advance({ kind: 'publishInput', key, expectedVersion: accepted.acceptedVersion });
}
