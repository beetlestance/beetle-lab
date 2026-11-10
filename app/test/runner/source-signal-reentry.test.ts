import { expect, it } from 'vitest';
import type { ClientResult } from '@beetle/contracts';
import { setup } from './source-fixtures.js';
import { turns } from './fixtures.js';

it('owns source admission before caller signal registration can reenter gateway shutdown', async () => {
  const { gateway, client, native } = setup(true); const signal = new AbortController().signal;
  const add = signal.addEventListener.bind(signal); let closing: Promise<void> | undefined;
  Object.defineProperty(signal, 'addEventListener', { value: (...args: Parameters<typeof add>) => {
    closing = gateway.close(); add(...args);
  } });
  const pending = client.source(signal);
  try {
    await turns(); expect(closing).toBeDefined();
    expect(native.lookups).toHaveLength(0);
    expect(await pending).toEqual({ ok: false, error: { kind: 'cancelled' } });
    await closing; expect(gateway.close()).toBe(closing);
  } finally {
    native.releaseDns(); await turns(); for (const original of native.originals) original.close();
    await Promise.all([pending, closing]);
  }
});

it('counts reentrant source signal registrations inside the same two-source limit', async () => {
  const { gateway, client, native } = setup(true); const signal = new AbortController().signal;
  const add = signal.addEventListener.bind(signal); const originals: Promise<ClientResult<unknown>>[] = [];
  let registrations = 0;
  Object.defineProperty(signal, 'addEventListener', { value: (...args: Parameters<typeof add>) => {
    if (++registrations < 3) originals.push(client.source(signal));
    add(...args);
  } });
  originals.push(client.source(signal));
  try { expect(registrations).toBe(2); expect(native.lookups).toHaveLength(2); }
  finally { const closing = gateway.close(); native.releaseDns(); await Promise.all([...originals, closing]); }
});

it('settles original custody when caller registration throws after adding its listener', async () => {
  const { gateway, client, native } = setup(true); const signal = new AbortController().signal;
  const add = signal.addEventListener.bind(signal);
  Object.defineProperty(signal, 'addEventListener', { value: (...args: Parameters<typeof add>) => {
    add(...args); throw new Error('synthetic registration failure');
  } });
  expect(await client.source(signal)).toEqual({ ok: false, error: { kind: 'transport' } });
  expect(native.lookups).toHaveLength(0);
  await gateway.close();
});
