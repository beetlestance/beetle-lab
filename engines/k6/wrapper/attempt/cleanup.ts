import type { Quiet, State } from './state.js';
import type { ControlWriter } from '../control/index.js';
import type { StagedInput } from '../input/index.js';
import type { ExecutionOperation } from '../execution/index.js';
import type { ResultPublication } from '../publication/index.js';
import type { Artifacts } from '../artifact-custody/index.js';
import type { AttemptTarget } from './target.js';
import type { MetricArchive } from './archive/index.js';
import type { Notifications, Phases } from '../lifecycle/index.js';
interface CleanupOwners {
  input: StagedInput | undefined;
  execution: ExecutionOperation | undefined;
  publication: ResultPublication | undefined;
  archive: MetricArchive | undefined;
  target: AttemptTarget;
  notifications: Notifications;
  writer: ControlWriter | undefined;
  phases: Phases | undefined;
  artifacts: Artifacts | undefined;
  liveMetricMailbox: boolean | undefined;
  closeLive(): Promise<void>;
  closeCheckpoint(): Promise<void> | undefined;
  artifactQuiescence(): 'confirmed' | 'failed';
}
export async function cleanupAttempt(state: State, quiet: Quiet, owners: CleanupOwners): Promise<void> {
  const checkpoint = Promise.allSettled([owners.closeCheckpoint()]);
  const tasks: { key: keyof Quiet; work: () => Promise<unknown> }[] = [
    ...(owners.input ? [{ key: 'input' as const, work: () => owners.input!.close() }] : []),
    ...(owners.execution ? [{ key: 'execution' as const, work: () => owners.execution!.close() }] : []),
    ...(owners.publication ? [{ key: 'publication' as const, work: () => owners.publication!.close() }] : []),
    ...(owners.archive
      ? [{ key: 'artifacts' as const, work: () => checkpoint.then(() => owners.archive!.close()) }]
      : []),
    ...(owners.target.started
      ? [{ key: 'artifacts' as const, work: () => checkpoint.then(() => owners.target.close()) }]
      : []),
    ...(owners.liveMetricMailbox ? [{ key: 'artifacts' as const, work: () => owners.closeLive() }] : []),
    { key: 'notifications', work: () => owners.notifications.quiesce() },
    ...(owners.writer
      ? [
          {
            key: 'journal' as const,
            work: async () => {
              try {
                await owners.phases?.stop();
              } finally {
                await owners.writer!.close();
              }
            },
          },
        ]
      : []),
  ];
  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      await task.work();
      return task.key;
    }),
  );
  results.forEach((result, index) => {
    const key = tasks[index]!.key;
    if (result.status === 'rejected') {
      quiet[key] = 'failed';
      state.ok = false;
      state.reason ??= 'cleanup';
    } else if (quiet[key] !== 'failed') quiet[key] = 'confirmed';
  });
  if (owners.artifacts && quiet.artifacts !== 'not_started') {
    quiet.artifacts = owners.artifactQuiescence();
  }
}
