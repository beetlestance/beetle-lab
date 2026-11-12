import { encodeJson, encodeCanonicalJson } from '@beetle/contracts';
import { captureInstalledRoot, installedRootDigest, captureNamespaceIntent, captureNamespaceAnchor,
  captureNamespaceState, captureNamespaceMarker, captureTaskNamespaceIntent, captureTaskNamespaceAnchor,
  captureTaskNamespaceState, captureTaskNamespaceKey, captureTaskDirectories, namespaceCaps } from '../staging-namespace/index.js';
import type { StagingNamespaceJournal, NamespaceIntent, NamespaceMarker, TaskNamespaceIntent, TaskDirectoryFacts } from '../staging-namespace/index.js';
import type { NamespaceOperation } from './staging-namespace-protocol.js';
interface ClientOptions {
  send(operation: () => NamespaceOperation): Promise<unknown>;
  invalidReply(): never;
}
function same(left: unknown, right: unknown, cap: number): boolean { return encodeCanonicalJson(left, cap) === encodeCanonicalJson(right, cap); }
function checked<T>(options: ClientOptions, pending: Promise<unknown>, capture: (input: unknown) => T): Promise<T> {
  return pending.then(value => { try { return capture(value); } catch { return options.invalidReply(); } });
}
/** Capture requests inside Journal's queue admission; validate replies against that captured intent. */
export function createStagingNamespaceClient(options: ClientOptions): StagingNamespaceJournal {
  return {
    begin(input) {
      let expected: ReturnType<typeof captureInstalledRoot>;
      return checked(options, options.send(() => ({ kind: 'namespaceBegin', json: encodeJson(expected = captureInstalledRoot(input), namespaceCaps.root) })), value => {
        const intent = captureNamespaceIntent(value);
        if (intent.rootDigest !== installedRootDigest(expected)) throw new Error('Namespace reply mismatch'); return intent;
      });
    },
    commit(input) {
      let intent: NamespaceIntent; let marker: NamespaceMarker;
      return checked(options, options.send(() => {
        intent = captureNamespaceIntent(input.intent); marker = captureNamespaceMarker(input.marker, intent);
        return { kind: 'namespaceCommit', json: encodeJson({ intent, marker }, namespaceCaps.state) };
      }), value => {
        const result = captureNamespaceAnchor(value, intent);
        if (!same(result.marker, marker, namespaceCaps.marker)) throw new Error('Namespace marker reply mismatch'); return result;
      });
    },
    read() { return checked(options, options.send(() => ({ kind: 'namespaceRead' })), captureNamespaceState); },
    beginTask(input) {
      let intent: TaskNamespaceIntent;
      return checked(options, options.send(() => ({ kind: 'taskNamespaceBegin', json: encodeJson(intent = captureTaskNamespaceIntent(input), namespaceCaps.task) })), value => {
        const state = captureTaskNamespaceState(value);
        if (!state || !same(state.intent, intent, namespaceCaps.task)) throw new Error('Task namespace reply mismatch'); return state;
      });
    },
    commitTask(input) {
      let intent: TaskNamespaceIntent; let directories: TaskDirectoryFacts;
      return checked(options, options.send(() => {
        intent = captureTaskNamespaceIntent(input.intent); directories = captureTaskDirectories(input.directories);
        return { kind: 'taskNamespaceCommit', json: encodeJson({ intent, directories }, namespaceCaps.task) };
      }), value => {
        const result = captureTaskNamespaceAnchor(value, intent);
        if (!same(result.directories, directories, namespaceCaps.task)) throw new Error('Task directory reply mismatch'); return result;
      });
    },
    readTask(input) {
      let key: ReturnType<typeof captureTaskNamespaceKey>;
      return checked(options, options.send(() => ({ kind: 'taskNamespaceRead', key: key = captureTaskNamespaceKey(input) })), value => {
        const state = captureTaskNamespaceState(value);
        if (state) for (const field of ['attemptId', 'organizationId', 'workspaceId', 'generation'] as const) {
          if (state.intent.original[field] !== key[field]) throw new Error('Task namespace reply mismatch');
        }
        return state;
      });
    },
  };
}
