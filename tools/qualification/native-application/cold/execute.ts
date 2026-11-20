import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Fixture } from '../compose/fixture.js';
import { cleanup } from '../compose/evidence.js';
import { cleanupLiveVolumes } from '../live-volumes.js';
import { seed } from './seed.js';
import { coldHistory } from './history.js';
import type { LegacyReader } from './legacy.js';
import type { ViewerCheck } from './viewer.js';
interface ColdOptions {
  f: Fixture;
  output: string;
  legacy?: LegacyReader;
  inspectViewer?: ViewerCheck;
}
export async function executeCold({ f, output, legacy, inspectViewer }: ColdOptions) {
  await mkdir(output, { mode: 0o700 });
  const owner = randomUUID();
  await writeFile(
    join(output, 'owner.json'),
    JSON.stringify({ root: f.root, project: f.project, revision: f.revision, owner }),
    { flag: 'wx', mode: 0o600 },
  );
  let installation: string | undefined;
  let phase = 'seed';
  let status = 'failed';
  const results: Record<string, unknown> = {};
  try {
    const seeded = await seed(
      f,
      async (id) => {
        installation = id;
        await writeFile(
          join(output, 'installation-owner.json'),
          JSON.stringify({ project: f.project, installationId: id }),
          { flag: 'wx', mode: 0o600 },
        );
      },
      inspectViewer !== undefined,
    );
    results.seed = seeded;
    phase = 'cold-stop';
    f.compose('stop');
    for (const id of f.ids())
      assert.equal(f.docker.json<{ State: { Running: boolean } }[]>(['inspect', id])[0]!.State.Running, false);
    await coldHistory({
      f,
      owner,
      seeded,
      legacy,
      inspectViewer,
      results,
      progress: (next) => {
        phase = next;
      },
    });
    status = 'passed';
  } catch (error) {
    process.exitCode = 1;
    await writeFile(
      join(output, 'failure-private.txt'),
      String(error instanceof Error ? error.stack : error).slice(0, 16384),
      { flag: 'wx', mode: 0o600 },
    );
  } finally {
    const failures = await cleanupCold(f, owner, installation);
    const cleanupVerified = failures.length === 0;
    if (!cleanupVerified) {
      status = 'failed';
      process.exitCode = 1;
    }
    results.cleanupFailures = failures;
    await writeFile(
      join(output, 'outcome-private.json'),
      JSON.stringify(
        {
          status,
          phase,
          cleanupVerified,
          revision: f.revision,
          architecture: f.architecture,
          imageIds: f.imageIds,
          user: '1000:1000',
          results,
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
    console.log(JSON.stringify({ status, phase, cleanupVerified }));
  }
}

async function cleanupCold(f: Fixture, owner: string, installation: string | undefined) {
  const failures: string[] = [];
  try {
    f.docker.cleanup(owner);
  } catch {
    failures.push('maintenance-viewer');
  }
  try {
    await cleanup(f, installation);
  } catch {
    failures.push('source');
  }
  if (!failures.includes('source') && installation) {
    try {
      cleanupLiveVolumes({ id: installation, user: '1000:1000', docker: f.docker });
    } catch {
      failures.push('live-volumes');
    }
  }

  return failures;
}
