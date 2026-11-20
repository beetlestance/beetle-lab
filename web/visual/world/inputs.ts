// Inputs and exports fixtures: the inventory, the upload byte route, and export jobs.
import type { Route } from '@playwright/test';
import type { Api, Json } from '../harness.js';
import { fixture, ids, signedIn } from './index.js';

type Obj = Record<string, Json>;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { kind: 'workspace', organizationId: ids.organization, workspaceId: ids.workspace } as const;
export const base = `/organizations/${ids.organization}/workspaces/${ids.workspace}`;
const apiBase = `/api/v2${base}`;
export const folders = { datasets: uuid(101), bodies: uuid(102) } as const;
const hash = (c: string) => (c + '9f2c41e07a8d3b5f6e1c0a47').repeat(4).slice(0, 64);

/** One input record shaped like the board rows. */
export function input(over: Obj): Obj {
  return { ...fixture('input'), scope, folderId: folders.datasets, ...over };
}

const published = (n: number, name: string, folderId: string, bytes: number, extra: Obj = {}) =>
  input({
    id: uuid(200 + n),
    name,
    folderId,
    bytes,
    offset: bytes,
    sha256: hash('9f2c41e07a'.charAt(n)),
    version: 3,
    state: 'published',
    createdAt: `2026-11-0${n}T10:20:00.000Z`,
    publishedAt: `2026-11-0${n}T10:21:00.000Z`,
    ...extra,
  });

export const usersCsv = published(1, 'users.csv', folders.datasets, 2_100_000, {
  usedByCount: 3,
  rowCount: 48210,
  columnCount: 4,
});
export const records: Obj[] = [
  usersCsv,
  published(2, 'search-terms.csv', folders.datasets, 380_000, { usedByCount: 1, rowCount: 12004, columnCount: 1 }),
  published(3, 'cart-item.json', folders.bodies, 1200, { usedByCount: 3 }),
  published(4, 'checkout.json', folders.bodies, 2800, { usedByCount: 3 }),
  input({
    id: uuid(205),
    name: 'skus.json',
    bytes: 6_500_000,
    offset: 3_965_000,
    sha256: hash('b'),
    version: 5,
    state: 'staging',
    createdAt: '2026-11-07T10:57:00.000Z',
    usedByCount: 0,
  }),
];

export const scopeBody = { ...scope };
export function page(items: Json[]): Obj {
  return { scope, items, nextCursor: null };
}
const folderRow = (id: string, name: string) => ({
  ...fixture('folder'),
  id,
  name,
  parentFolderId: ids.rootFolder,
  displayPath: [name],
});
/** The two folders the inventory names,. */
export function folderPage(): Obj {
  const items = [folderRow(folders.datasets, 'datasets'), folderRow(folders.bodies, 'bodies')];
  return page(items);
}

export function usage(total: number): Obj {
  const row = (n: number, suiteName: string, ordinal: number, current: boolean) => ({
    suiteId: uuid(300 + n),
    suiteName,
    revisionId: uuid(310 + n),
    ordinal,
    current,
  });
  return {
    ...fixture('input-usage-page'),
    inputId: usersCsv.id!,
    total,
    items: [row(1, 'steady-1.2k', 4, true), row(2, 'ramp-until-break', 2, true), row(3, 'soak-27m', 1, false)],
    nextCursor: null,
  };
}

/** Signed in, with the inventory and its folder names answered. */
export function inventory(api: Api, items: Json[] = records): Api {
  return signedIn(api).on('listInputs', page(items)).on('listFolders', folderPage());
}

/** The detail panel's reads for one record. */
export function detail(api: Api, record: Obj): Api {
  return api.on('getInput', record).on('listInputUsage', usage(Number(record.usedByCount ?? 0)));
}

export function protectedDependency(): { status: number; body: Json } {
  const dep = (n: number, suiteName: string, ordinal: number) => ({
    suiteId: uuid(300 + n),
    suiteName,
    revisionId: uuid(320 + n * 3 + ordinal),
    ordinal,
    current: false,
  });
  return {
    status: 409,
    body: {
      ...fixture('safe-error'),
      code: 'protected_dependency',
      message: 'Protected dependency',
      fields: [],
      dependencies: { total: 3, items: [dep(1, 'steady-1.2k', 4), dep(1, 'steady-1.2k', 5), dep(4, 'soak-30m', 2)] },
    },
  };
}

/** What the fake backend does at each upload step. `hold` leaves that chunk request unanswered. */
export interface UploadScript {
  /** 1-based chunk number whose PUT is never answered. */
  holdChunk?: number;
  /** Record returned by getInput after the seal. */
  sealed?: Obj;
  /** createInput is left pending. */
  holdCreate?: boolean;
}

/** A stateful fake of createInput, chunk PUTs, getInput and sealInput for one dialog session. */
export function uploadBackend(api: Api, script: UploadScript = {}): void {
  inventory(api, []);
  let record: Obj | undefined;
  api.on('createInput', (call) => {
    if (script.holdCreate) return 'pending';
    const body = call.body as Obj;
    record = input({
      id: uuid(400),
      name: body.name!,
      folderId: body.folderId ?? ids.rootFolder,
      sha256: body.sha256!,
      bytes: body.bytes!,
      offset: 0,
      version: 1,
      state: 'staging',
      createdAt: '2026-11-07T23:39:00.000Z',
    });
    return { status: 201, body: record };
  });
  api.on('getInput', () => record!);
  api.on('sealInput', (call) => {
    record = { ...record!, ...(script.sealed ?? { state: 'publishing' }), offset: record!.bytes! };
    const body = call.body as Obj;
    return {
      status: 202,
      body: {
        ...fixture('input-receipt'),
        id: record.id!,
        requestId: body.requestId!,
        acceptedVersion: Number(body.expectedVersion) + 1,
      },
    };
  });
  api.route(/\/inputs\/[^/]+\/chunks\?offset=\d+$/, (route: Route) => chunk(route, script));
  let chunks = 0;
  async function chunk(route: Route, current: UploadScript) {
    chunks += 1;
    if (current.holdChunk === chunks) return;
    const length = route.request().postDataBuffer()?.length ?? 0;
    record = { ...record!, offset: Number(record!.offset) + length, version: Number(record!.version) + 1 };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(record) });
  }
}

export const uploadPath = `${base}/inputs`;
export { apiBase };

const requested = [
  '2026-11-07T10:42:00.000Z',
  '2026-11-07T11:05:00.000Z',
  '2026-11-07T11:06:00.000Z',
  '2026-11-06T16:20:00.000Z',
  '2026-11-06T09:12:00.000Z',
  '2026-11-05T18:30:00.000Z',
];
const job = (n: number, state: string, suite: number, revision: number, over: Obj = {}): Obj => ({
  ...fixture('export-job'),
  id: uuid(500 + n),
  scope,
  suiteId: uuid(600 + suite),
  revisionId: uuid(700 + revision),
  requestedAt: requested[n - 1]!,
  state,
  ...over,
});
const artifact = {
  artifactId: uuid(800),
  bytes: 18_400,
  sha256: hash('c'),
  name: 'suite.js',
  mediaType: 'text/javascript',
};
export const exportJobs: Obj[] = [
  job(1, 'ready', 1, 1, { artifact }),
  job(2, 'generating', 2, 2),
  job(3, 'queued', 3, 3),
  job(4, 'failed', 4, 4, { reason: 'unsupported_secrets' }),
  job(5, 'unknown', 5, 5, { reason: 'ownership_unknown' }),
  job(6, 'cancelled', 6, 6, { reason: 'cancelled', cancellationRequested: true }),
];
const suiteNames = ['Smoke', 'Checkout spike', 'Soak 27m', 'Login flow', 'Ramp until break', 'Orders'];
const ordinals = [14, 7, 3, 2, 9, 5];

/** Exports tab: the job list plus the suite names and revision ordinals its rows read. */
export function exportsPage(api: Api, items: Json[] = exportJobs): Api {
  signedIn(api).on('listExports', page(items));
  api.on('listSuites', {
    ...page(
      suiteNames.map((name, i) => ({ ...fixture('suite'), id: uuid(601 + i), scope, name, folderId: ids.rootFolder })),
    ),
  });
  return api.on('getSuiteRevision', (call) => {
    const i = Number(call.params.revisionId!.slice(-3)) - 701;
    return {
      ...fixture('suite-revision'),
      id: call.params.revisionId!,
      suiteId: uuid(601 + i),
      ordinal: ordinals[i] ?? 1,
    };
  });
}
