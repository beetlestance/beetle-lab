import { statfs } from 'node:fs/promises';
import { Boundary } from './bounds.js';
import { checkRoot, rootIdentity } from './root.js';
import { StagingError } from './types.js';
import type { Operation } from '../backends/docker/index.js';
import type { StagingResult, VerifiedRoot } from './types.js';

export interface RootSpace { readonly expectedDaemonId: string; readonly availableBytes: number }

/** Original filesystem calls settle before this read-only sample promise settles. */
export async function readRootSpace(root: VerifiedRoot, operation: Operation): Promise<StagingResult<RootSpace>> {
  let boundary: Boundary | undefined;
  try {
    const identity = rootIdentity(root); boundary = new Boundary(operation);
    await checkRoot(identity, boundary);
    const space = await boundary.wait(() => statfs(identity.configuration.stagingRoot, { bigint: true }));
    if (space.bavail < 0n || space.bsize <= 0n) throw new StagingError('io');
    const bytes = space.bavail * space.bsize;
    if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) throw new StagingError('io');
    await checkRoot(identity, boundary); boundary.check();
    return { ok: true, value: Object.freeze({ expectedDaemonId: identity.configuration.expectedDaemonId, availableBytes: Number(bytes) }) };
  } catch (error) { return { ok: false, reason: error instanceof StagingError ? error.reason : 'io' }; }
  finally { await boundary?.drain(); boundary?.dispose(); }
}
