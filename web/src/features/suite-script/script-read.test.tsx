// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExportJob } from '@beetle/contracts/api';
import { environment, exportJob, revision, testClient } from '../exports/fixtures.js';
import { useScriptText } from './script-read.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const owner = revision();
const otherId = '99999999-9999-4999-8999-999999999999';
function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    }),
  );
}
async function ready(text: string): Promise<ExportJob> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  const sha256 = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    ...exportJob(),
    state: 'ready',
    reason: null,
    artifact: { artifactId: owner.id, name: 'suite.js', mediaType: 'text/javascript', bytes: bytes.length, sha256 },
  };
}
function frame() {
  return environment(
    testClient(() => {
      throw new Error('Unexpected metadata read');
    }).client,
  ).Frame;
}
it('masks cached verified text and refuses byte reads for a foreign scope or revision digest', async () => {
  const job = await ready('export default function () {}');
  const fetcher = vi.fn(async () => response('export default function () {}'));
  vi.stubGlobal('fetch', fetcher);
  const view = renderHook(({ value }) => useScriptText(owner.scope, owner, value), {
    wrapper: frame(),
    initialProps: { value: job },
  });
  await waitFor(() => expect(view.result.current.data).toBe('export default function () {}'));
  view.rerender({ value: { ...job, scope: { ...job.scope, workspaceId: otherId } } });
  expect(view.result.current.data).toBeUndefined();
  expect(view.result.current.isError).toBe(true);
  await act(async () => {
    await view.result.current.refetch();
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  view.rerender({ value: { ...job, revisionDigest: 'f'.repeat(64) } });
  expect(view.result.current.data).toBeUndefined();
  expect(view.result.current.isError).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keys verified content by published hash and bytes, rather than reusing text on job ID alone', async () => {
  const first = await ready('// first');
  const second = await ready('// second source');
  let source = '// first';
  const fetcher = vi.fn(async () => response(source));
  vi.stubGlobal('fetch', fetcher);
  const view = renderHook(({ value }) => useScriptText(owner.scope, owner, value), {
    wrapper: frame(),
    initialProps: { value: first },
  });
  await waitFor(() => expect(view.result.current.data).toBe('// first'));
  source = '// second source';
  view.rerender({ value: second });
  expect(view.result.current.data).toBeUndefined();
  await waitFor(() => expect(view.result.current.data).toBe('// second source'));
  expect(fetcher).toHaveBeenCalledTimes(2);
});
