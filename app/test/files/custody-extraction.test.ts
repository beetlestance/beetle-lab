import { expect, it } from 'vitest';
import { FileCustodyError, FILE_CHUNK_BYTES, nativePort } from '../../src/adapters/outbound/files/custody/index.js';
import { nativePort as inputNativePort } from '../../src/adapters/outbound/files/inputs/native.js';
import { safeError } from '../../src/adapters/outbound/files/inputs/job.js';
import { InputByteError } from '../../src/ports/input-bytes.js';

it.each(['custody_missing', 'invalid_input', 'cancelled', 'integrity', 'io', 'cleanup', 'capacity_unavailable'] as const)(
  'maps physical %s failures to the existing input error ABI', code => {
    const physical = new FileCustodyError(code);
    const error = safeError(physical);
    expect(error).toBeInstanceOf(InputByteError);
    expect(error).toMatchObject({ code, name: 'InputByteError', message: 'Input byte operation failed' });
    expect(error).not.toBe(physical);
  });

it('retains one native fault seam and the physical 64KiB read bound', () => {
  expect(inputNativePort).toBe(nativePort);
  expect(FILE_CHUNK_BYTES).toBe(65_536);
});
