import { encodeJson } from '@beetle/contracts';
import { captureEventBinding, captureEventKey } from '../../../../domain/events/index.js';
import { EVENT_CURSOR_BYTES, EVENT_PAGE_BYTES, EVENT_SCAN_LIMIT } from '../../../../ports/events.js';
import type { EventCandidate, EventCustodyStore, EventPage } from '../../../../ports/events.js';

function requireValue(valid: boolean): asserts valid {
  if (!valid) throw new Error('Invalid event discovery');
}
/** Inspect the original carrier before encoding can discard own fields. */
function fields(input: unknown, names: readonly string[]): Record<string, unknown> {
  requireValue(input !== null && typeof input === 'object'
    && [Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null));
  const keys = Reflect.ownKeys(input);
  requireValue(keys.length === names.length && keys.every(key => typeof key === 'string' && names.includes(key)));
  const output: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    requireValue(!!descriptor?.enumerable && 'value' in descriptor);
    output[name] = descriptor.value as unknown;
  }
  return output;
}
function cursor(input: unknown): asserts input is string {
  requireValue(typeof input === 'string' && input.length > 0 && Buffer.byteLength(input) <= EVENT_CURSOR_BYTES);
}
function candidate(input: unknown): EventCandidate {
  requireValue(input !== null && typeof input === 'object');
  const kind = Object.getOwnPropertyDescriptor(input, 'kind');
  requireValue(!!kind && 'value' in kind && ['ready', 'unbound'].includes(kind.value as string));
  const value = fields(input, ['kind', 'order', 'after', kind.value === 'ready' ? 'binding' : 'key']);
  requireValue(Number.isSafeInteger(value.order) && (value.order as number) >= 0); cursor(value.after);
  const common = { order: value.order as number, after: value.after };
  return value.kind === 'ready' ? { ...common, kind: 'ready', binding: captureEventBinding(value.binding) }
    : { ...common, kind: 'unbound', key: captureEventKey(value.key) };
}
function page(input: EventPage): EventPage {
  const value = fields(input, ['items', 'nextCursor']);
  requireValue(Array.isArray(value.items) && value.items.length <= EVENT_SCAN_LIMIT);
  const original = value.items;
  requireValue(Object.getPrototypeOf(original) === Array.prototype && Reflect.ownKeys(original).length === original.length + 1);
  const items: EventCandidate[] = [];
  for (let index = 0; index < original.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(original, String(index));
    requireValue(!!descriptor?.enumerable && 'value' in descriptor);
    items.push(candidate(descriptor.value));
  }
  if (value.nextCursor !== null) {
    cursor(value.nextCursor);
    requireValue(items.length > 0 && value.nextCursor === items.at(-1)?.after);
  }
  // Retain only a bounded owned page; the original candidate identities were checked first.
  return JSON.parse(encodeJson({ items, nextCursor: value.nextCursor }, EVENT_PAGE_BYTES)) as EventPage;
}

/** One finite captured pass; unbound diagnostics advance without inventing authority. */
export function eventDiscovery(scan: EventCustodyStore['scan']) {
  let after: string | undefined;
  return async (): Promise<Extract<EventCandidate, { kind: 'ready' }> | undefined> => {
    const value = page(await scan({ limit: EVENT_SCAN_LIMIT, ...(after === undefined ? {} : { cursor: after }) }));
    const selected = value.items.find(item => item.kind === 'ready');
    after = selected?.after ?? value.nextCursor ?? undefined;
    return selected;
  };
}
