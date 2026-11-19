import { createHash } from 'node:crypto';
import {
  captureOutputAbsence,
  captureStoppedHistoryClosure,
  captureStoppedDeliveryHistory,
  OUTPUT_ABSENCE_BYTES,
  STOPPED_HISTORY_ENVELOPE_BYTES,
} from '@beetle/contracts/output-source';
import type {
  AbsenceIdentity,
  Owned,
  OutputAbsence,
  StoppedDeliveryHistory,
  StoppedHistoryClosure,
} from '@beetle/contracts/output-source';
import type { ClientResult } from '@beetle/contracts';
import type { RunnerAttemptIdentity } from '../../../ports/runner.js';
import { scopeHeaders } from './identity.js';
import { nativeCall } from './native.js';
import { errorReply } from './source-replies.js';
import type { Connection } from './transport.js';

/** One read on the original installation connection; credits retain all native closes. */
export function absence(
  connection: Connection,
  identity: RunnerAttemptIdentity,
  signal?: AbortSignal,
): Promise<ClientResult<Owned<OutputAbsence>>> {
  return readClosure(connection, identity, signal, {
    suffix: '/absence',
    bytes: OUTPUT_ABSENCE_BYTES,
    capture: captureOutputAbsence,
  });
}

export function stoppedHistory(
  connection: Connection,
  identity: RunnerAttemptIdentity,
  signal?: AbortSignal,
): Promise<ClientResult<StoppedHistoryClosure>> {
  return readClosure(connection, identity, signal, {
    suffix: '/absence/history',
    bytes: STOPPED_HISTORY_ENVELOPE_BYTES,
    capture: (value, expected) =>
      captureStoppedHistoryClosure(value, expected, (text) => createHash('sha256').update(text).digest('hex')),
  });
}

export function stoppedDeliveryHistory(
  connection: Connection,
  identity: RunnerAttemptIdentity,
  signal?: AbortSignal,
): Promise<ClientResult<StoppedDeliveryHistory>> {
  return readClosure(connection, identity, signal, {
    suffix: '/history',
    bytes: STOPPED_HISTORY_ENVELOPE_BYTES,
    capture: (value, expected) =>
      captureStoppedDeliveryHistory(value, expected, (text) => createHash('sha256').update(text).digest('hex')),
  });
}

function readClosure<T>(
  connection: Connection,
  identity: RunnerAttemptIdentity,
  signal: AbortSignal | undefined,
  request: {
    suffix: '/absence' | '/absence/history' | '/history';
    bytes: number;
    capture: (value: unknown, expected: AbsenceIdentity) => T;
  },
): Promise<ClientResult<T>> {
  return connection.credits.run<T>('source', signal, async (original) => {
    if (identity.generation !== 1) return { ok: false, error: { kind: 'request' } };
    const response = await nativeCall(
      {
        origin: connection.origin,
        method: 'GET',
        path: `/runner/v1/attempts/${encodeURIComponent(identity.attemptId)}/source${request.suffix}`,
        headers: { authorization: `Bearer ${connection.token}`, ...scopeHeaders(identity) },
        body: undefined,
        signal: original.signal,
        responseBytes: request.bytes,
      },
      connection.io,
    );
    if (!response.ok) return { ok: false, error: { kind: response.kind } };
    if (response.status !== 200) return errorReply(response, identity);
    try {
      return { ok: true, value: request.capture(response.value, { ...identity, generation: 1 }) };
    } catch {
      return { ok: false, error: { kind: 'response', status: response.status } };
    }
  });
}
