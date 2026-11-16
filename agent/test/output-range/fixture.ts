import { afterEach } from 'vitest';
import { lstat } from 'node:fs/promises';
import type { Artifact } from '@beetle/contracts';
import { fixture } from '../output-collection/fixture.js';
import { snapshotRootIdentity } from '../../src/collection/root/index.js';
import { readOutputRange } from '../../src/collection/output/index.js';
import type { OutputRange, OutputRangeOptions } from '../../src/collection/output/index.js';
import { startRange } from '../../src/collection/output/range-operation.js';
import type { OutputPorts } from '../../src/collection/output/ports.js';
export { tracking, deferred } from '../output-collection/fixture.js';

export function rangeFixture() {
  const operations: OutputRange[] = [];
  afterEach(async () => {
    await Promise.allSettled(operations.map(operation => operation.close()));
    await Promise.all(operations.splice(0).map(operation => operation.quiesced));
  });
  const f = fixture();
  return { ...f,
    async rangeOptions(artifact: Artifact, overrides: Partial<OutputRangeOptions> = {}): Promise<OutputRangeOptions> {
      const stat = await lstat(f.directory(), { bigint: true });
      return { root: snapshotRootIdentity(f.directory(), process.getuid!(), stat), artifact,
        offset: 0, length: 65_536, deadline: performance.now() + 5000, ...overrides };
    },
    range(options: OutputRangeOptions, ports?: OutputPorts): OutputRange {
      const operation = ports ? startRange(options, ports) : readOutputRange(options);
      operations.push(operation); return operation;
    },
  };
}
