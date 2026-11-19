import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { encodeK6HistoryCheckpoint, K6_HISTORY_CHECKPOINT_NAMES } from '@beetle/contracts/k6-live';
import type { K6LiveApproval } from '@beetle/contracts/k6-live';
import type { LiveMetricArchivePrefix } from '@beetle/contracts/api';
import { configuration, observation } from '../admission/fixtures.js';
import { frame } from '../live-metrics/fixtures.js';
import { fixture, operation, scope } from './fixtures.js';
import { allocation, recover } from '../../src/installation/recovery.js';
import { JournalError } from '../../src/journal/index.js';
import { createEntry } from '../../src/installation/entry.js';
import { reconcileAbsence } from '../../src/installation/absence.js';
import { initialize } from '../../src/journal/schema.js';
import { recoverStoppedObservation } from '../../src/installation/stopped-history.js';

const environments = fixture();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const uid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

async function exited(publish = false) {
  const env = await environments.setup(65_536, true);
  const config = configuration();
  config.maxTimeoutMs = 10_000;
  config.pool.outputBytes = 65_536;
  config.perRun.outputBytes = 65_536;
  await env.owner.admission({ kind: 'configure', configuration: config });
  const measured = observation(env.time.wall());
  measured.capacity.outputBytes = 65_536;
  await env.owner.admission({ kind: 'observe', observation: measured });
  const key = scope(env.offer);
  const approval: K6LiveApproval = {
    scope: key,
    producerEpoch: uid(10),
    subset: frame().subset,
    targetIntervalMs: null,
  };
  const manager = env.create(publish ? { stoppedHistoryApproval: () => approval } : {});
  await env.accepted(manager);
  if (publish) {
    for (let turn = 0; turn < 12; turn++) {
      env.time.advance(1);
      const result = await manager.drive(key, operation());
      if (result.kind === 'released') break;
      if (env.backend.observation.state === 'running') {
        const admitted = (await allocation(env.owner, key))!;
        const runtime = recover(env.catalog, env.offer, admitted);
        await writeCheckpoint(output(runtime), approval);
        env.backend.observation = env.backend.known('exited').value;
      }
    }
  } else await env.finish(manager);
  const reservation = (await allocation(env.owner, key))!;
  const snapshot = await env.owner.get(key);
  const plan = recover(env.catalog, env.offer, reservation);
  const launch = { key, plan };
  const path = output(plan);
  const options = {
    snapshot,
    reservation,
    launch,
    offer: env.offer,
    namespaceIdentity: env.options.gate.namespaceIdentity,
    approval: () => approval,
    tasks: env.owner.stagingNamespace,
    operation: { deadline: performance.now() + 10000 },
  };
  return { path, options, approval, installation: env.options, journal: env.owner, journalPath: env.journalPath, key };
}

function output(plan: ReturnType<typeof recover>): string {
  return plan.spec.HostConfig.Mounts.find((mount) => mount.Target === '/beetle/output')!.Source;
}

async function writeCheckpoint(path: string, approval: K6LiveApproval): Promise<void> {
  const scope = approval.scope;
  const dataId = uid(12);
  const header = (format: string) => JSON.stringify({ format, version: 1, scope, dataArtifactId: dataId }) + '\n';
  const dataHeader = header('beetle-k6-metric-windows');
  const window = { startTimeMs: 0, endTimeMs: 1000, series: [] };
  const row = JSON.stringify({ kind: 'window', sequence: 1, window }) + '\n';
  const data = dataHeader + row;
  const index =
    header('beetle-k6-metric-index') +
    JSON.stringify({
      sequence: 1,
      startTimeMs: 0,
      endTimeMs: 1000,
      offset: Buffer.byteLength(dataHeader),
      length: Buffer.byteLength(row),
    }) +
    '\n';
  const prefix: LiveMetricArchivePrefix = {
    scope,
    windows: 1,
    endTimeMs: 1000,
    data: {
      artifactId: dataId,
      relativePath: 'metric-windows.ndjson',
      bytes: Buffer.byteLength(data),
      sha256: hash(data),
    },
    index: {
      artifactId: uid(13),
      relativePath: 'metric-index.ndjson',
      bytes: Buffer.byteLength(index),
      sha256: hash(index),
    },
  };
  await writeFile(join(path, prefix.data.relativePath), data, { mode: 0o600 });
  await writeFile(join(path, prefix.index.relativePath), index, { mode: 0o600 });
  await writeFile(join(path, K6_HISTORY_CHECKPOINT_NAMES[0]), encodeK6HistoryCheckpoint(prefix, approval, hash), {
    mode: 0o600,
  });
}

it('binds recoverable observations to the exited launch and prepared output directory', async () => {
  const f = await exited();
  expect(f.options.snapshot.state).toBe('exited');
  await writeCheckpoint(f.path, f.approval);
  const result = await recoverStoppedObservation(f.options);
  expect(result).toBeDefined();
  expect(result?.bytes).toBe(Buffer.byteLength(result!.json));
  expect(result?.digest).toBe(hash(result!.json));
  expect(JSON.parse(result!.json)).toMatchObject({
    scope: f.options.launch.key,
    samples: [{ sequence: 1, startTimeMs: 0, endTimeMs: 1000 }],
  });
});

it('reads no task when physical exit or settled start authority is absent', async () => {
  const f = await exited();
  const { exitEvidence: _, ...snapshot } = f.options.snapshot;
  const readTask = vi.fn(f.options.tasks.readTask);
  expect(await recoverStoppedObservation({ ...f.options, snapshot, tasks: { readTask } })).toBeUndefined();
  expect(readTask).not.toHaveBeenCalled();
  expect(
    await recoverStoppedObservation({
      ...f.options,
      reservation: { ...f.options.reservation, startToken: 'another-launch' },
      tasks: { readTask },
    }),
  ).toBeUndefined();
  expect(readTask).not.toHaveBeenCalled();
});

it('refuses a different staging namespace even with a valid checkpoint', async () => {
  const f = await exited();
  await writeCheckpoint(f.path, f.approval);
  expect(await recoverStoppedObservation({ ...f.options, namespaceIdentity: 'f'.repeat(64) })).toBeUndefined();
});

it('commits verified observations with the absence and replays the original bytes', async () => {
  const f = await exited(true);
  const proof = await f.journal.readOutputAbsence(f.key);
  expect(proof?.admission).toEqual({ state: 'released', disposition: 'settled' });
  const record = await f.journal.readStoppedHistoryClosure(f.key);
  expect(record?.absence).toEqual(proof);
  const recovered = record?.observation;
  expect(recovered?.digest).toBe(hash(recovered!.json));
  expect(JSON.parse(recovered!.json)).toMatchObject({ scope: f.key, samples: [{ sequence: 1 }] });
  expect(await f.journal.closeOutputAbsence(f.key)).toEqual(proof);
  expect(await f.journal.readStoppedHistoryClosure(f.key)).toEqual(record);
  await environments.close(f.journal);
  const restarted = await environments.open(f.journalPath);
  expect(await restarted.readStoppedHistoryClosure(f.key)).toEqual(record);
});

it('keeps the no-history decision immutable after the original absence commits', async () => {
  const f = await exited();
  const record = await f.journal.readStoppedHistoryClosure(f.key);
  expect(record).toMatchObject({ absence: { finalAgentSeq: f.options.snapshot.lastSeq }, observation: null });
  await writeCheckpoint(f.path, f.approval);
  const later = (await recoverStoppedObservation(f.options))!;
  expect(later).toBeDefined();
  expect(await f.journal.closeOutputAbsence(f.key, later.json)).toEqual(record!.absence);
  expect(await f.journal.readStoppedHistoryClosure(f.key)).toEqual(record);
  await environments.close(f.journal);
  const db = initialize(f.journalPath);
  try {
    expect(() =>
      db
        .prepare(
          'INSERT INTO stopped_history_observations(attempt_id,history_json,history_digest,charged_bytes) VALUES(?,?,?,?)',
        )
        .run(f.key.attemptId, later.json, later.digest, later.bytes + 256),
    ).toThrow(/requires settled absence/);
  } finally {
    db.close();
  }
});

it('defers transient task lookup pressure instead of dropping eligible history', async () => {
  const f = await exited();
  const readTask = vi.fn(async () => {
    throw new JournalError('queue_full');
  });
  await expect(recoverStoppedObservation({ ...f.options, tasks: { readTask } })).rejects.toMatchObject({
    code: 'queue_full',
  });
});

it('refuses absence retry after native history cleanup failed', async () => {
  const f = await exited();
  const entry = createEntry(f.key);
  entry.cleanupFailed = true;
  const retire = vi.fn(async () => {});
  await expect(reconcileAbsence(f.installation, entry, retire)).rejects.toMatchObject({ reason: 'cleanup' });
  expect(retire).not.toHaveBeenCalled();
});
