// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { rawField, useRawDrafts } from './raw-drafts.js';
import type { Config } from '../suites/draft.js';
const config: Config = {
  requests: [
    { id: 'one', body: { kind: 'json', value: null }, assertions: [] },
    { id: 'two', body: { kind: 'json', value: null }, assertions: [] },
  ],
};
afterEach(cleanup);
it('bounds aggregate UTF-8 buffers and replaces the same field without double charging', () => {
  const view = renderHook(() => useRawDrafts(config));
  const one = { requestId: 'one' };
  const two = { requestId: 'two' };
  let accepted = false;
  act(() => {
    accepted = view.result.current.keep(one, 'x'.repeat(1_048_573), 'invalid_json');
  });
  expect(accepted).toBe(true);
  act(() => {
    accepted = view.result.current.keep(two, '😀', 'invalid_json');
  });
  expect(accepted).toBe(false);
  expect(view.result.current.get(two)).toBeUndefined();
  act(() => {
    accepted = view.result.current.keep(one, '{', 'invalid_json');
  });
  expect(accepted).toBe(true);
  act(() => {
    accepted = view.result.current.keep(two, '😀', 'invalid_json');
  });
  expect(accepted).toBe(true);
  expect(view.result.current.snapshot().map((entry) => entry.raw.length)).toEqual([1, 2]);
  act(() => view.result.current.discard());
  expect(view.result.current.dirty).toBe(false);
});
it('keeps field identity after a request moves and retires only explicitly removed request bodies', () => {
  const view = renderHook(({ value }) => useRawDrafts(value), { initialProps: { value: config } });
  act(() => {
    view.result.current.keep({ requestId: 'two' }, '{unfinished', 'invalid_json');
  });
  const requests = config.requests as Record<string, unknown>[];
  view.rerender({ value: { requests: [requests[1]!, requests[0]!] } });
  expect(view.result.current.problems[0]?.path).toBe('/requests/0/body/value');
  expect(view.result.current.get({ requestId: 'two' })?.raw).toBe('{unfinished');
  view.rerender({ value: { requests: [requests[0]!] } });
  expect(view.result.current.dirty).toBe(false);
});
it('refuses ambiguous structured identities while keeping raw edits through invalid complete JSON', () => {
  expect(rawField({ requests: [{ id: 'duplicate' }, { id: 'duplicate' }] }, 0)).toBeNull();
  expect(rawField({ requests: [{ id: 'bad id' }] }, 0)).toBeNull();
  const view = renderHook(({ value }) => useRawDrafts(value), { initialProps: { value: config as Config | null } });
  act(() => {
    view.result.current.keep({ requestId: 'one' }, '{', 'invalid_json');
  });
  view.rerender({ value: null });
  expect(view.result.current.dirty).toBe(true);
  view.rerender({ value: config });
  expect(view.result.current.get({ requestId: 'one' })?.raw).toBe('{');
});
