import { expect, it, vi } from 'vitest';
import { AttemptFence } from '../../wrapper/lifecycle/fence.js';

it('fences cancellation when the attempt has no measured child to drain', () => {
  const hard = new AbortController();
  const soft = new AbortController();
  const request = vi.fn(() => false);
  const fence = new AttemptFence({ wall: Date.now, monotonic: () => performance.now() }, hard.signal, 10_000, {
    signal: soft.signal,
    request,
  });
  try {
    soft.abort();
    expect(request).toHaveBeenCalledOnce();
    expect(fence.reason).toBe('cancelled');
    expect(fence.controller.signal.aborted).toBe(true);
  } finally {
    fence.dispose();
  }
});

it('caps publication across phase changes and preserves the hard abort', () => {
  let mono = 10;
  const hard = new AbortController();
  const soft = new AbortController();
  const request = vi.fn(() => true);
  const fence = new AttemptFence({ wall: Date.now, monotonic: () => mono }, hard.signal, 10_000, {
    signal: soft.signal,
    request,
  });
  try {
    soft.abort();
    expect(request).toHaveBeenCalledOnce();
    expect(fence.lifetimeRemaining()).toBe(3500);
    mono += 1000;
    fence.phase(10_000);
    expect(fence.lifetimeRemaining()).toBe(2500);
    mono += 2500;
    expect(() => fence.check()).toThrow(expect.objectContaining({ reason: 'cancelled' }));
    expect(fence.controller.signal.aborted).toBe(true);
  } finally {
    fence.dispose();
  }
});

it('allows a second interrupt to hard-abort an accepted drain', () => {
  const hard = new AbortController();
  const soft = new AbortController();
  const fence = new AttemptFence({ wall: Date.now, monotonic: () => performance.now() }, hard.signal, 10_000, {
    signal: soft.signal,
    request: () => true,
  });
  try {
    soft.abort();
    expect(fence.controller.signal.aborted).toBe(false);
    hard.abort();
    expect(fence.controller.signal.aborted).toBe(true);
  } finally {
    fence.dispose();
  }
});
