import { encodeJson, encodeCanonicalJson } from '@beetle/contracts';
import { captureOutputRetirementRequest, OUTPUT_RETIREMENT_REQUEST_BYTES } from '@beetle/contracts/output-retirement';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import type { Scope } from '../admission/index.js';
import { captureRetirementIntent } from '../retirement-values/index.js';
import type { RetirementIntent,JournalRetirements } from '../retirement-values/index.js';
import { cleanupControl } from '../cleanup-control/index.js';
import { sourceScope } from './output-source-input.js';
import type { RetirementOperation } from './retirement-protocol.js';
interface Options {
  send(operation: () => RetirementOperation): Promise<unknown>;
  invalidReply(): never;
  settleCarrier(): Promise<void>;
}
function checked<T>(options: Options, pending: Promise<unknown>, capture: (value: unknown) => T): Promise<T> {
  return pending.then(value => { try { return capture(value); } catch { return options.invalidReply(); } });
}
function record(value: unknown, fields: string[]): Record<string, unknown> {
  const copy = JSON.parse(encodeJson(value, cleanupControl.intentBytes + 512)) as unknown;
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) throw new Error(); const row = copy as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || !fields.every(key => Object.hasOwn(row, key))) throw new Error(); return row;
}
function sameScope(value: unknown, expected: Scope): void {
  const actual = sourceScope(value);
  if (encodeCanonicalJson(actual, 512) !== encodeCanonicalJson(expected, 512)) throw new Error('Retirement scope reply mismatch');
}
export interface JournalRejectedFunding {
 preflightRejected(input:unknown):Promise<RetirementIntent>;
 fundRejected(input:unknown):Promise<RetirementIntent>;
}
export function createRetirementClient(options: Options): JournalRetirements & JournalRejectedFunding {
  function request(kind: 'retirementPreflight' | 'retirementBegin' | 'rejectedCleanupPreflight' | 'rejectedCleanupFund', input: unknown) {
    let expected: RetirementRequest;
    return checked(options, options.send(() => ({ kind, json: encodeJson(expected = captureOutputRetirementRequest(input), OUTPUT_RETIREMENT_REQUEST_BYTES) })),
      value => captureRetirementIntent(value, expected));
  }
  return Object.freeze({
    isOpen(input: Scope) {
      let expected: Scope;
      return checked(options, options.send(() => ({ kind: 'retirementOpen', key: expected = sourceScope(input) })), value => {
        const row = record(value, ['key', 'open']); sameScope(row.key, expected);
        if (typeof row.open !== 'boolean') throw new Error(); return row.open;
      });
    },
    preflightRejected:(input:unknown)=>request('rejectedCleanupPreflight',input),
    fundRejected:(input:unknown)=>request('rejectedCleanupFund',input),
    preflight: (input: unknown) => request('retirementPreflight', input), begin: (input: unknown) => request('retirementBegin', input),
    read(input: Scope) {
      let expected: Scope;
      return checked(options, options.send(() => ({ kind: 'retirementRead', key: expected = sourceScope(input) })), value => {
        const row = record(value, ['key', 'intent']); sameScope(row.key, expected); if (row.intent === null) return null;
        const intent = captureRetirementIntent(row.intent); sameScope({ organizationId: intent.request.organizationId,
          workspaceId: intent.request.workspaceId, attemptId: intent.request.attemptId, generation: intent.request.generation }, expected); return intent;
      });
    },
    settleCarrier: () => options.settleCarrier(),
  });
}
