import assert from 'node:assert/strict';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Fixture } from '../compose/fixture.js';
import type { seed } from './seed.js';
import { maintenance } from './maintenance.js';
import { historicalViewer } from './viewer.js';
import type { LegacyReader } from './legacy.js';
export async function coldHistory({
  f,
  owner,
  seeded,
  legacy,
  progress,
  results,
}: {
  f: Fixture;
  owner: string;
  seeded: Awaited<ReturnType<typeof seed>>;
  legacy: LegacyReader | undefined;
  progress: (phase: string) => void;
  results: Record<string, unknown>;
}) {
  const tool = maintenance(f, owner);
  const archive = join(tool.work, 'archive');
  const history = join(tool.work, 'history');
  const limits = { maximumBytes: 134217728, maximumEntries: 2000 };
  const common = { version: 1 as const, limits, timeoutMs: 45000 };
  const sourcePaths = ['data/backend/metadata.sqlite', 'data/agent/journal/journal.sqlite'].map((path) =>
    join(f.home, path),
  );
  const sourceHashes = sourcePaths.map((path) => tool.digest(path));
  progress('backup');
  results.backup = tool.cli({ ...common, command: 'backup', source: join(f.home, 'data'), destination: archive });
  assert.deepEqual(
    sourcePaths.map((path) => tool.digest(path)),
    sourceHashes,
  );
  results.sourceMainFilesUnchanged = true;
  const restore = { ...common, command: 'restore' as const, archive, destination: history, operationId: randomUUID() };
  progress('restore');
  const restored = tool.cli(restore);
  results.restore = restored;
  const metadata = join(history, 'data/metadata.sqlite');
  const before = tool.digest(metadata);
  if (legacy) {
    progress('foreign-resume');
    results.foreignResume = tool.refuse({ ...restore, operationId: randomUUID(), resume: true });
    assert.equal(tool.digest(metadata), before);
  }
  progress('historical-viewer');
  results.viewer = await historicalViewer(f, owner, history, seeded.run, seeded.artifacts);
  if (legacy) {
    progress('legacy-history-reader');
    f.docker.cleanup(owner);
    const older = { ...f, images: { ...f.images, installer: legacy.installer, frontend: legacy.frontend } };
    results.legacyViewer = {
      revision: legacy.revision,
      imageIds: legacy.imageIds,
      ...(await historicalViewer(older, owner, history, seeded.run, seeded.artifacts)),
    };
  }
  progress('completed-resume');
  assert.deepEqual(tool.cli({ ...restore, resume: true }), restored);
  assert.equal(tool.digest(metadata), before);
  results.metadataUnchanged = true;
  results.completedResumeUnchanged = true;
  assert.deepEqual(
    sourcePaths.map((path) => tool.digest(path)),
    sourceHashes,
  );
  return results;
}
