import { expect, it } from 'vitest';
import { setupAction } from '../compose/index.js';

it('parses only ordinary setup or the explicit upgrade command', () => {
  expect(setupAction([])).toBeUndefined();
  expect(setupAction(['upgrade'])).toBe('prepare');
  for (const action of ['prepare', 'status', 'activate', 'rollback'] as const)
    expect(setupAction(['upgrade', action])).toBe(action);
  for (const args of [['repin'], ['upgrade', 'force'], ['upgrade', 'status', 'extra'], ['status']])
    expect(() => setupAction(args)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
});
