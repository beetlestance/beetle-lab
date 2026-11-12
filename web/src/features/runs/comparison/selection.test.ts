import { expect, it } from 'vitest';
import { comparisonRunIds } from './selection.js';
const a = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'; const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
it('accepts two through four distinct canonical UUIDs in baseline order', () => {
  expect(comparisonRunIds(`?runs=${a},${b}`)).toEqual([a.toLowerCase(), b]);
  const c = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; const d = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  expect(comparisonRunIds(`?runs=${a},${b},${c},${d}`)).toHaveLength(4);
  expect(comparisonRunIds(`?runs=${a},${b},${c},${d},eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee`)).toBeUndefined();
});
it.each(['', '?runs=bad,missing', `?runs=${a}`, `?runs=${a},${a.toLowerCase()}`, `?runs=${a},${b}&extra=x`, `?runs=${a},${b}&runs=${a},${b}`, '?runs=' + 'a'.repeat(513)])('rejects malformed selection %s', search => {
  expect(comparisonRunIds(search)).toBeUndefined();
});
