import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { RecoveryEntry } from '@beetle/contracts/recovery';
import type { RecoveryIO } from './io.js';
import type { HistoryClaim } from './claim.js';
import { checkClaimDirectories, rootIdentity } from './claim.js';
import { child, directory, hashFile, stable } from './files.js';
import { RecoveryError } from './types.js';
/** Domain-separated history custody, never a live publication identity or receipt. */
export async function attest(io: RecoveryIO, claim: HistoryClaim, entries: readonly RecoveryEntry[]) {
  if (claim.rootIdentity !== rootIdentity(await directory(io, claim.destination))) throw new RecoveryError('integrity');
  if (claim.workIdentity !== rootIdentity(await directory(io, join(claim.destination, 'work')))) throw new RecoveryError('integrity');
  const hash = createHash('sha256'); hash.update('beetle-historical-custody/v1\n'); hash.update(encodeCanonicalJson(claim, 8191) + '\n');
  const root = child(claim.destination, 'data'); const data = await directory(io, root);
  hash.update(encodeCanonicalJson({path: 'data', native: rootIdentity(data)}, 8191) + '\n');
  const files = new Map<string, string>(); const directories = new Map<string, string>([['', rootIdentity(data)]]);
  for (const entry of entries) {
    const path = child(root, entry.path);
    if (entry.kind === 'directory') {
      const native = rootIdentity(await directory(io, path)); directories.set(entry.path, native);
      hash.update(encodeCanonicalJson({path: entry.path, native}, 8191) + '\n');
    }
    else {
      const facts = await hashFile(io, path, entry.bytes);
      if (facts.bytes !== entry.bytes || facts.sha256 !== entry.sha256) throw new RecoveryError('integrity');
      const native = stable(facts.native); files.set(entry.path, native);
      hash.update(encodeCanonicalJson({path: entry.path, bytes: entry.bytes, sha256: facts.sha256, native}, 8191) + '\n');
    }
  }
  checkClaimDirectories(claim);
  return Object.freeze({digest: hash.digest('hex'), files, directories});
}
