import { tmpdir } from 'node:os';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { targetMetricNames } from '@beetle/contracts/target-runtime';
import type { TargetRuntimeSample } from '@beetle/contracts/target-runtime';
import { TargetArchive } from './index.js';
import { AttemptError } from '../failure/index.js';

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
export function sample(index = 0): TargetRuntimeSample {
  const values = Object.fromEntries(targetMetricNames.map((name) => [name, name === 'rss' ? index + 1 : null]));
  return {
    observedAt: new Date(100000 + index * 1000).toISOString(),
    phase: index === 0 ? 'before' : 'during',
    status: 'ready',
    reason: null,
    values,
  } as TargetRuntimeSample;
}
export async function fixture(allowance = 1048576) {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'beetle-target-archive-'));
  let cancelled = false;
  const options = {
    directory: root,
    uid: process.getuid!(),
    allowance,
    intervalMs: 1000,
    scope: {
      organizationId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      attemptId: '00000000-0000-4000-8000-000000000003',
      generation: 1,
    },
    check: () => {
      if (cancelled) throw new AttemptError('cancelled');
    },
  };
  const archive = await TargetArchive.create(options);
  return {
    root,
    options,
    archive,
    cancel: () => {
      cancelled = true;
    },
    dispose: async () => {
      try {
        await archive.close();
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  };
}
