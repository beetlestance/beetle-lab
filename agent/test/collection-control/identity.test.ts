import { describe, expect, it } from 'vitest';
import type { BigIntStats } from 'node:fs';
import { fixture, value, ack } from './fixture.js';
import { nodePorts } from '../../src/collection/control/ports.js';
import type { ReaderPorts } from '../../src/collection/control/ports.js';

describe('exact uint64 custody', () => {
  const f = fixture();
  it('distinguishes adjacent inode values above Number.MAX_SAFE_INTEGER', async () => {
    await f.write(`${JSON.stringify(f.event())}\n`); let ino = 9_007_199_254_740_992n;
    function patch(stat: BigIntStats): BigIntStats {
      if (stat.isFile()) { Object.defineProperty(stat, 'dev', { value: 18_446_744_073_709_551_615n });
        Object.defineProperty(stat, 'ino', { value: ino }); }
      return stat;
    }
    const ports: ReaderPorts = { ...nodePorts,
      lstat: new Proxy(nodePorts.lstat, { apply: async (target, receiver, args) => patch(await Reflect.apply(target, receiver, args)) }),
      open: async (...args) => {
        const handle = await nodePorts.open(...args);
        return new Proxy(handle, { get(target, property) {
          if (property === 'stat') return async (...statArgs: unknown[]) => patch(await Reflect.apply(target.stat, target, statArgs));
          const field: unknown = Reflect.get(target, property);
          return typeof field === 'function' ? field.bind(target) : field;
        } });
      } };
    const reader = f.reader(null, ports); const batch = await value(reader);
    if (batch.kind !== 'batch') throw new Error('expected batch');
    expect(batch.request.next).toMatchObject({ dev: '18446744073709551615', ino: '9007199254740992' });
    reader.accept(ack(batch.request)); ino++;
    expect(await reader.read({ deadline: performance.now() + 5000, stopped: false }).result)
      .toEqual({ ok: false, reason: 'custody' });
  });
});
