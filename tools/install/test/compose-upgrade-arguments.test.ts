import { expect, it } from 'vitest';
import { setupAction } from '../compose/index.js';
import { originArguments } from '../compose/origin.js';

it('parses only ordinary setup or the explicit upgrade command', () => {
  expect(setupAction([])).toBeUndefined();
  expect(setupAction(['upgrade'])).toBe('prepare');
  for (const action of ['prepare', 'status', 'activate', 'rollback'] as const)
    expect(setupAction(['upgrade', action])).toBe(action);
  for (const args of [['repin'], ['upgrade', 'force'], ['upgrade', 'status', 'extra'], ['status']])
    expect(() => setupAction(args)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
});

it('parses the origin command exactly, leaving the target to BEETLE_ORIGIN', () => {
  const id = '00000000-0000-4000-8000-0000000000b1';
  const args = ['origin', '--from', 'http://127.0.0.1:8080', '--operation-id', id];
  expect(setupAction(args)).toBeUndefined();
  expect(originArguments(args)).toEqual({ from: 'http://127.0.0.1:8080', operationId: id });
  expect(originArguments([])).toBeUndefined();
  expect(originArguments(['upgrade'])).toBeUndefined();
  for (const bad of [
    ['origin'],
    ['origin', '--from', 'https://lab.example.internal'],
    ['origin', '--operation-id', id, '--from', 'https://lab.example.internal'],
    ['origin', '--from', 'https://lab.example.internal/', '--operation-id', id],
    ['origin', '--from', 'http://lab.example.internal', '--operation-id', id],
    ['origin', '--from', 'https://lab.example.internal', '--operation-id', 'not-a-uuid'],
    [...args, 'extra'],
  ])
    expect(() => originArguments(bad)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
});
