// Installs the API replies behind the Suites, Suite and Script screens.
import { encodeSuiteListCursor } from '../../../../contracts/src/api/suite-list.js';
import type { Api, Call, Json, Reply } from '../../harness.js';
import { NOW } from '../../harness.js';
import { fixture, signedIn } from '../index.js';
import { entries, folderPage, recentRuns, revisionSummary, steadyRevisions } from './data.js';
import type { FolderOptions, Obj } from './data.js';
import { folderIds, hex, inputIds, scope, uuid } from './ids.js';

const messages: Record<string, string> = {
  not_found: 'Resource not found',
  conflict: 'Version or intent conflict',
  invalid_value: 'Invalid value',
};
/** An ApiError reply; the contract fixes the message for each code. */
export const safeError = (code: string, _text: string, status: number): Reply => ({
  status,
  body: { code, message: messages[code]!, retryable: false, requestId: uuid(9, 1), fields: [] },
});

const inputRecord = (id: string, name: string, bytes: number, state = 'published'): Obj => ({
  ...fixture('input'),
  id,
  scope,
  name,
  folderId: folderIds.root,
  sha256: hex('b'),
  bytes,
  offset: bytes,
  version: 3,
  state,
  reason: null,
});
export const inputs = (deleted: string[] = []): Obj[] =>
  [
    [inputIds.users, 'users.csv', 2_100_000],
    [inputIds.cart, 'cart-item.json', 1200],
    [inputIds.checkout, 'checkout.json', 2800],
  ].map(([id, name, bytes]) =>
    inputRecord(
      id as string,
      name as string,
      bytes as number,
      deleted.includes(name as string) ? 'deleted' : 'published',
    ),
  );

/** Workspace settings as the Start run board shows them: 2 CPUs, 4 GiB, 512 processes, 30-minute limit. */
export function runSettings(): Obj {
  const source = scope as unknown as Json;
  const leaf = (value: number, maximum: number) => ({ value, source, allowedRange: { minimum: 1, maximum } });
  const base = fixture<Obj>('workspace-settings') as { effective: { runDefaults: Obj } } & Obj;
  return {
    ...base,
    effective: {
      ...base.effective,
      runDefaults: {
        engineProfile: { value: 'k6-local', source, allowedValues: ['k6-local'] },
        budget: {
          cpuMillis: leaf(2000, 8000),
          memoryBytes: leaf(4 * 1024 ** 3, 8 * 1024 ** 3),
          pids: leaf(512, 4096),
          timeoutMs: leaf(1_800_000, 3_600_000),
          outputBytes: leaf(2 * 1024 ** 3, 10 * 1024 ** 3),
        },
      },
    },
  };
}

const runTime = (row: (typeof entries)[number]) =>
  ((row.summary.latestRun as Obj | null)?.requestedAt as string | undefined) ?? '';
function listFilter(q: URLSearchParams) {
  const pick = (name: string) => q.get(name) ?? undefined;
  return { group: pick('group'), name: pick('name'), folder: pick('folderId'), engine: pick('engineId') };
}
function matching(q: URLSearchParams) {
  const { group, name, folder, engine } = listFilter(q);
  return entries.filter(
    (row) =>
      (!folder || row.suite.folderId === folder) &&
      (!group || row.summary.group === group) &&
      (!engine || row.summary.engineId === engine) &&
      (!name || (row.suite.name as string).includes(name)),
  );
}
function cursorQuery(q: URLSearchParams, limit: number, order: string) {
  const defined = Object.entries(listFilter(q)).filter(([, value]) => value !== undefined);
  const names: Record<string, string> = { folder: 'folderId', engine: 'engineId' };
  return {
    limit,
    order,
    ...Object.fromEntries(defined.map(([key, value]) => [names[key] ?? key, value])),
  } as Parameters<typeof encodeSuiteListCursor>[0]['query'];
}
/** recent_run is strictly descending by (latest run time, id), runless suites last; the cursor is the real encoded one. */
export function suiteList(call: Call): Json {
  const q = call.query;
  const limit = Number(q.get('limit') ?? 100);
  const order = q.get('order') === 'name' ? 'name' : 'recent_run';
  const rows = matching(q).sort((a, b) =>
    order === 'name'
      ? (a.suite.name as string).localeCompare(b.suite.name as string)
      : runTime(b).localeCompare(runTime(a)) || (b.suite.id as string).localeCompare(a.suite.id as string),
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const query = cursorQuery(q, limit, order);
  const requestedAt = last && order !== 'name' ? runTime(last) || null : null;
  return {
    scope,
    items: page.map((row) => row.suite),
    summaries: page.map((row) => row.summary),
    nextCursor:
      rows.length > limit && last
        ? encodeSuiteListCursor({ scope, query, requestedAt, id: last.suite.id as string })
        : null,
  };
}

export interface SuitesOptions extends FolderOptions {
  /** Config overrides for revision 4 of steady-1.2k. */
  revision4?: Parameters<typeof steadyRevisions>[0];
  /** Names of input files that were deleted since the revision was saved. */
  deletedInputs?: string[];
}

/** Everything the Suites list, folder, suite page, editor and Start run dialog read. */
export function suitesWorld(api: Api, options: SuitesOptions = {}): Api {
  const revisions = steadyRevisions(options.revision4);
  const all = [...revisions, ...entries.slice(1).map((row) => row.revision)];
  const files = inputs(options.deletedInputs);
  signedIn(api)
    .on('getWorkspaceOverview', { ...fixture('workspace-overview'), generatedAt: NOW })
    .on('listFolders', folderPage(options))
    .on('listSuites', suiteList)
    .on(
      'getSuite',
      (call) =>
        (entries.find((row) => row.suite.id === call.params.suiteId)?.suite as Json) ??
        safeError('not_found', 'Not found', 404),
    )
    .on(
      'getSuiteRevision',
      (call) =>
        (all.find((row) => row.id === call.params.revisionId) as Json) ?? safeError('not_found', 'Not found', 404),
    )
    .on('listSuiteRevisions', (call) => ({
      scope,
      suiteId: call.params.suiteId!,
      items: revisions.map(revisionSummary).reverse(),
      nextCursor: null,
    }))
    .on('listRuns', {
      ...fixture('run-page'),
      scope,
      items: recentRuns,
      nextCursor: null,
      summaries: recentRuns.map((run) => ({
        ...(fixture<{ summaries: Obj[] }>('run-page').summaries[0] as Obj),
        runId: run.id as string,
        attemptId: run.activeAttemptId as string,
      })),
    })
    .on('getWorkspaceSettings', runSettings())
    .on('listInputs', { scope, items: files, nextCursor: null })
    .on(
      'getInput',
      (call) =>
        (files.find((row) => row.id === call.params.inputId) as Json) ?? safeError('not_found', 'Not found', 404),
    )
    .on('getInputColumns', (call) => {
      const record = files.find((row) => row.id === call.params.inputId)!;
      return {
        ...fixture('input-columns'),
        scope,
        inputId: record.id!,
        sha256: record.sha256!,
        bytes: record.bytes!,
        columns: ['cartId', 'currency', 'email', 'country'],
      };
    });
  return api;
}
