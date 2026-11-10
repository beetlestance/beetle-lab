import { encodeJson, RUNNER_MAXIMUM_OFFER_BYTES, validate } from '@beetle/contracts';
import type { ClientResult, ProtocolName, ProtocolTypes, RunnerTransport } from '@beetle/contracts';
import type { RunnerAttemptIdentity } from '../../../ports/runner.js';
import type { CallCredits } from './lifetime.js';
import { matchesIdentity, matchesReply, scopeHeaders } from './identity.js';
import { nativeCall } from './native.js';
import type { NativeIo, NativeResult } from './native.js';

type Call = Parameters<RunnerTransport['json']>[0];
export interface Connection {
  readonly origin: URL;
  readonly token: string;
  readonly installationId: string;
  readonly credits: CallCredits;
  readonly io: NativeIo;
}

function bodyFor(call: Call, identity?: RunnerAttemptIdentity): ClientResult<string | undefined> {
  if (!call.request) return { ok: true, value: undefined };
  try {
    const body = encodeJson(call.body, call.request === 'Offer' ? RUNNER_MAXIMUM_OFFER_BYTES : 65_536);
    const value: unknown = JSON.parse(body);
    const checked = validate(call.request, value);
    if (!checked.ok) return { ok: false, error: { kind: 'request', issues: checked.issues } };
    if (!identity || !matchesIdentity(checked.value, identity)) return { ok: false, error: { kind: 'request' } };
    if (call.request === 'Offer' && identity.generation !== 1) return { ok: false, error: { kind: 'request' } };
    return { ok: true, value: body };
  } catch { return { ok: false, error: { kind: 'request' } }; }
}

function expectedStatus(status: number, successStatus: number): boolean {
  return status === successStatus || (status >= 400 && status <= 599);
}

function reply<N extends ProtocolName>(call: Call & { response: N }, response: NativeResult, connection: Connection,
  identity?: RunnerAttemptIdentity): ClientResult<ProtocolTypes[N]> {
  if (!response.ok) return { ok: false, error: { kind: response.kind } };
  const status = response.status;
  // Redirects and unexpected success statuses can never become protocol replies.
  if (!expectedStatus(status, call.successStatus)) {
    return { ok: false, error: { kind: 'response', status } };
  }
  if (status !== call.successStatus) return protocolReply(response, identity);
  const checked = validate(call.response, response.value);
  if (!checked.ok) return { ok: false, error: { kind: 'response', status, issues: checked.issues } };
  if (identity && !matchesReply(checked.value, identity)) return { ok: false, error: { kind: 'response', status } };
  if (call.response === 'Capabilities') {
    const capabilities = checked.value as ProtocolTypes['Capabilities'];
    if (capabilities.observation.installationId !== connection.installationId) {
      return { ok: false, error: { kind: 'response', status } };
    }
  }
  return checked;
}

export function protocolReply(response: Extract<NativeResult, { ok: true }>,
  identity?: RunnerAttemptIdentity): ClientResult<never> {
  const checked = validate('ProtocolError', response.value);
  if (!checked.ok || !identity || !matchesReply(checked.value, identity)) {
    return { ok: false, error: { kind: 'response', status: response.status } };
  }
  return { ok: false, error: { kind: 'protocol', status: response.status, protocol: checked.value } };
}

export function createTransport(connection: Connection, identity?: RunnerAttemptIdentity): RunnerTransport {
  return {
    json: call => connection.credits.run(call.request === 'Offer' ? 'offer' : 'ordinary', call.signal, async original => {
      const body = bodyFor(call, identity);
      if (!body.ok) return body;
      const response = await nativeCall({ origin: connection.origin, method: call.method, path: call.path,
        headers: { authorization: `Bearer ${connection.token}`, ...scopeHeaders(identity) },
        body: body.value, signal: original.signal, responseBytes: 1_048_576 }, connection.io);
      return reply(call, response, connection, identity);
    }),
  };
}
