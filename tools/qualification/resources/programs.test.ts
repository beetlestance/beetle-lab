import {Script} from 'node:vm';
import {expect, it} from 'vitest';
import {programs} from './programs.js';
it('keeps each bounded native program syntactically valid without executing its faults in unit tests', () => {
  for (const [name, source] of Object.entries(programs)) {
    expect(Buffer.byteLength(source)).toBeLessThan(16384);
    expect(() => new Script(source, {filename: name + '.cjs'})).not.toThrow();
  }
});
