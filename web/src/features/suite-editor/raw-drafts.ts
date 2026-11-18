import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { SUITE_MAXIMUM_CONFIG_BYTES } from '@beetle/contracts/api';
import type { Config } from '../suites/draft.js';
import { identifierPattern, isObj, objects } from './model.js';
import type { Problem } from './model.js';

export type RawField = { requestId: string; assertionId?: string };
export type RawReason = 'invalid_json' | 'invalid_scalar' | 'configuration_limit';
type RawEntry = RawField & { raw: string; bytes: number; reason: RawReason };
const fieldKey = (field: RawField) => JSON.stringify([field.requestId, field.assertionId ?? null]);
const MAX_FIELDS = 4160;
const validField = (field: RawField) =>
  typeof field.requestId === 'string' &&
  identifierPattern.test(field.requestId) &&
  (field.assertionId === undefined || identifierPattern.test(field.assertionId));
function fieldProblem(config: Config | null, entry: RawEntry): Problem {
  const requests = objects(config?.requests);
  const matches = requests
    .map((request, index) => ({ request, index }))
    .filter(({ request }) => request.id === entry.requestId);
  if (matches.length !== 1)
    return {
      path: '',
      message: 'Unfinished JSON edits are kept. Give requests unique IDs in the complete configuration first.',
    };
  const { request, index } = matches[0]!;
  const prefix = `/requests/${index}`;
  const assertions = objects(request.assertions);
  const at = assertions.findIndex((check) => check.id === entry.assertionId);
  const path = entry.assertionId === undefined ? `${prefix}/body/value` : `${prefix}/assertions/${at}/value`;
  const field = entry.assertionId === undefined ? 'JSON body' : `check ${at + 1} JSON value`;
  const message =
    entry.reason === 'configuration_limit'
      ? 'could not fit in the configuration'
      : entry.reason === 'invalid_scalar'
        ? 'is not a valid JSON scalar'
        : 'is not valid JSON';
  return { path, message: `Request ${index + 1} ${field} ${message}. Fix it before saving.` };
}
function remains(config: Config, entry: RawEntry): boolean {
  const matches = objects(config.requests).filter((request) => request.id === entry.requestId);
  if (matches.length !== 1) return matches.length > 0;
  const request = matches[0]!;
  if (entry.assertionId === undefined) return isObj(request.body) && request.body.kind === 'json';
  if (!Array.isArray(request.assertions)) return true;
  return objects(request.assertions).some((check) => check.id === entry.assertionId && check.kind === 'jsonEquals');
}
/** The raw buffer belongs to the editor, not a routed input. Invalid text never becomes a valid config value. */
export function useRawDrafts(config: Config | null) {
  const current = useRef(new Map<string, RawEntry>());
  const [entries, setEntries] = useState<ReadonlyMap<string, RawEntry>>(current.current);
  const commit = (next: Map<string, RawEntry>) => {
    current.current = next;
    setEntries(next);
  };
  useEffect(() => {
    if (!config || !Array.isArray(config.requests) || !current.current.size) return;
    const next = new Map([...current.current].filter(([, entry]) => remains(config, entry)));
    if (next.size !== current.current.size) commit(next);
  }, [config]);
  const keep = (field: RawField, raw: string, reason: RawReason): boolean => {
    if (!validField(field) || typeof raw !== 'string' || raw.length > SUITE_MAXIMUM_CONFIG_BYTES) return false;
    const bytes = new TextEncoder().encode(raw).byteLength;
    const key = fieldKey(field);
    const total =
      [...current.current.values()].reduce((sum, entry) => sum + entry.bytes, 0) -
      (current.current.get(key)?.bytes ?? 0) +
      bytes;
    if (total > SUITE_MAXIMUM_CONFIG_BYTES || (!current.current.has(key) && current.current.size >= MAX_FIELDS))
      return false;
    const next = new Map(current.current);
    next.set(key, {
      requestId: field.requestId,
      ...(field.assertionId === undefined ? {} : { assertionId: field.assertionId }),
      raw,
      bytes,
      reason,
    });
    commit(next);
    return true;
  };
  return {
    dirty: entries.size > 0,
    problems: [...entries.values()].slice(0, 64).map((entry) => fieldProblem(config, entry)),
    get: (field: RawField) => entries.get(fieldKey(field)),
    keep,
    clear: (field: RawField) => {
      const next = new Map(current.current);
      if (next.delete(fieldKey(field))) commit(next);
    },
    discard: () => commit(new Map()),
    snapshot: () =>
      [...current.current.values()].map((entry) => ({
        requestId: entry.requestId,
        ...(entry.assertionId === undefined ? {} : { assertionId: entry.assertionId }),
        raw: entry.raw,
        reason: entry.reason,
      })),
  };
}
export type RawDrafts = ReturnType<typeof useRawDrafts>;
export const RawDraftContext = createContext<RawDrafts | null>(null);
export function useRawDraftOwner(): RawDrafts {
  const owner = useContext(RawDraftContext);
  if (!owner) throw Error('Raw JSON draft owner required');
  return owner;
}
/** Structured raw edits need stable, unique identifiers. Invalid imported IDs remain editable in complete JSON. */
export function rawField(config: Config, index: number, assertionIndex?: number): RawField | null {
  const requests = objects(config.requests);
  const requestId = uniqueIdentity(requests, index);
  if (requestId === undefined) return null;
  if (assertionIndex === undefined) return { requestId };
  const assertionId = uniqueIdentity(objects(requests[index]!.assertions), assertionIndex);
  return assertionId === undefined ? null : { requestId, assertionId };
}
function uniqueIdentity(items: readonly Record<string, unknown>[], index: number): string | undefined {
  const id = items[index]?.id;
  return typeof id === 'string' && identifierPattern.test(id) && items.filter((item) => item.id === id).length === 1
    ? id
    : undefined;
}
