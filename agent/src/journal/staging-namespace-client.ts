import { encodeJson, encodeCanonicalJson } from '@beetle/contracts';
import {
  captureInstalledRoot,
  sameInstalledRoot,
  captureNamespaceIntent,
  captureNamespaceAnchor,
  captureNamespaceState,
  captureNamespaceMarker,
  captureTaskNamespaceIntent,
  captureTaskNamespaceAnchor,
  captureTaskNamespaceState,
  captureTaskNamespaceKey,
  captureTaskDirectories,
  captureTaskReconciliation,
  namespaceCaps,
} from '../staging-namespace/index.js';
import type {
  StagingNamespaceJournal,
  NamespaceIntent,
  NamespaceMarker,
  TaskNamespaceIntent,
  TaskDirectoryFacts,
  TaskNamespaceKey,
} from '../staging-namespace/index.js';
import type { NamespaceOperation } from './staging-namespace-protocol.js';
interface ClientOptions {
  send(operation: () => NamespaceOperation): Promise<unknown>;
  invalidReply(): never;
}
function same(left: unknown, right: unknown, cap: number): boolean {
  return encodeCanonicalJson(left, cap) === encodeCanonicalJson(right, cap);
}
function checked<T>(options: ClientOptions, pending: Promise<unknown>, capture: (input: unknown) => T): Promise<T> {
  return pending.then((value) => {
    try {
      return capture(value);
    } catch {
      return options.invalidReply();
    }
  });
}
/** Capture requests inside Journal's queue admission; validate replies against that captured intent. */
export function createStagingNamespaceClient(options: ClientOptions): StagingNamespaceJournal {
  return { ...installationClient(options), ...taskClient(options), ...reconciliationClient(options) };
}

function installationClient(options: ClientOptions): Pick<StagingNamespaceJournal, 'begin' | 'commit' | 'read'> {
  return {
    begin(input) {
      let expected: ReturnType<typeof captureInstalledRoot>;
      return checked(
        options,
        options.send(() => ({
          kind: 'namespaceBegin',
          json: encodeJson((expected = captureInstalledRoot(input)), namespaceCaps.root),
        })),
        (value) => {
          const intent = captureNamespaceIntent(value);
          if (!sameInstalledRoot(intent.root, expected)) throw new Error('Namespace reply mismatch');
          return intent;
        },
      );
    },
    commit(input) {
      let intent: NamespaceIntent;
      let marker: NamespaceMarker;
      return checked(
        options,
        options.send(() => {
          intent = captureNamespaceIntent(input.intent);
          marker = captureNamespaceMarker(input.marker, intent);
          return { kind: 'namespaceCommit', json: encodeJson({ intent, marker }, namespaceCaps.state) };
        }),
        (value) => {
          const result = captureNamespaceAnchor(value, intent);
          if (!same(result.marker, marker, namespaceCaps.marker)) throw new Error('Namespace marker reply mismatch');
          return result;
        },
      );
    },
    read() {
      return checked(
        options,
        options.send(() => ({ kind: 'namespaceRead' })),
        captureNamespaceState,
      );
    },
  };
}
function taskClient(options: ClientOptions): Pick<StagingNamespaceJournal, 'beginTask' | 'commitTask' | 'readTask'> {
  return {
    beginTask(input) {
      let intent: TaskNamespaceIntent;
      return checked(
        options,
        options.send(() => ({
          kind: 'taskNamespaceBegin',
          json: encodeJson((intent = captureTaskNamespaceIntent(input)), namespaceCaps.task),
        })),
        (value) => {
          const state = captureTaskNamespaceState(value);
          if (!state || !same(state.intent, intent, namespaceCaps.task))
            throw new Error('Task namespace reply mismatch');
          return state;
        },
      );
    },
    commitTask(input) {
      let intent: TaskNamespaceIntent;
      let directories: TaskDirectoryFacts;
      return checked(
        options,
        options.send(() => {
          intent = captureTaskNamespaceIntent(input.intent);
          directories = captureTaskDirectories(input.directories);
          return { kind: 'taskNamespaceCommit', json: encodeJson({ intent, directories }, namespaceCaps.task) };
        }),
        (value) => {
          const result = captureTaskNamespaceAnchor(value, intent);
          if (!same(result.directories, directories, namespaceCaps.task))
            throw new Error('Task directory reply mismatch');
          return result;
        },
      );
    },
    readTask(input) {
      let key: ReturnType<typeof captureTaskNamespaceKey>;
      return checked(
        options,
        options.send(() => ({ kind: 'taskNamespaceRead', key: (key = captureTaskNamespaceKey(input)) })),
        (value) => {
          const state = captureTaskNamespaceState(value);
          if (state)
            for (const field of ['attemptId', 'organizationId', 'workspaceId', 'generation'] as const) {
              if (state.intent.original[field] !== key[field]) throw new Error('Task namespace reply mismatch');
            }
          return state;
        },
      );
    },
  };
}

/** Replies are checked against the stored anchor, read in the same queue before and after the write. */
function reconciliationClient(
  options: ClientOptions,
): Pick<StagingNamespaceJournal, 'reconcileTask' | 'readTaskReconciliation'> {
  const read = (key: TaskNamespaceKey) => taskClient(options).readTask(key);
  return {
    async reconcileTask(input, reconciliation) {
      const key = captureTaskNamespaceKey(input);
      const task = await read(key);
      if (task?.state !== 'prepared') return options.invalidReply();
      const expected = captureTaskReconciliation(reconciliation, task.anchor);
      return checked(
        options,
        options.send(() => ({ kind: 'taskReconciliationCommit', key, json: encodeJson(expected, namespaceCaps.task) })),
        (value) => {
          const result = captureTaskReconciliation(value, task.anchor);
          if (!same(result, expected, namespaceCaps.task)) throw new Error('Task reconciliation reply mismatch');
          return result;
        },
      );
    },
    async readTaskReconciliation(input) {
      const key = captureTaskNamespaceKey(input);
      const task = await read(key);
      if (task?.state !== 'prepared') return null;
      return checked(
        options,
        options.send(() => ({ kind: 'taskReconciliationRead', key })),
        (value) => (value === null ? null : captureTaskReconciliation(value, task.anchor)),
      );
    },
  };
}
