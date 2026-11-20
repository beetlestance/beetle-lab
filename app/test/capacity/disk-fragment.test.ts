import { expect, it } from 'vitest';
import { fragmentSize } from '../../src/adapters/outbound/capacity/disk.js';

it('counts blocks in fragment units, not the larger preferred block size FUSE mounts report', () => {
  // Docker Desktop's virtiofs reported bsize 1 MiB with 4 KiB fragments: 494 GB read as about 117,871 GiB.
  expect(fragmentSize({ bsize: 1_048_576n, frsize: 4096n })).toBe(4096n);
  expect(fragmentSize({ bsize: 4096n, frsize: 4096n })).toBe(4096n);
  expect(fragmentSize({ bsize: 4096n, frsize: 0n })).toBe(4096n);
});
