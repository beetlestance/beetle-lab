import { expect, it, vi } from 'vitest';
import { Docker } from '../../../agent/test/container/docker.js';

// Invalid cleanup policy must fail before even inspecting a context. Prevent any
// actual subprocess if this boundary regresses; this establishes no Docker facts.
const subprocess = vi.hoisted(() => vi.fn(() => { throw new Error('Subprocess forbidden in boundary test'); }));
vi.mock('node:child_process', () => ({ execFileSync: subprocess }));

it('rejects nonfinite, broad and malformed network bounds before a Docker subprocess', () => {
  for (const limit of [0, -1, 3, 1.5, Infinity, NaN, '2', null]) {
    expect(() => new Docker('default', limit as 1)).toThrow('Invalid qualification network limit');
  }
  expect(subprocess).not.toHaveBeenCalled();
});
