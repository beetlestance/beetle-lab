// Identifiers and shared constants for the suites family fixtures.
import { ids as shared } from '../index.js';

export const uuid = (group: number, n: number) =>
  `00000000-0000-4000-8000-${String(group * 1000 + n).padStart(12, '0')}`;
export const scope = { kind: 'workspace', organizationId: shared.organization, workspaceId: shared.workspace } as const;
export const base = `/organizations/${shared.organization}/workspaces/${shared.workspace}`;
export const apiBase = `/api/v2${base}`;

export const folderIds = {
  root: shared.rootFolder,
  capacity: uuid(1, 1),
  smoke: uuid(1, 2),
  regression: uuid(1, 3),
  endurance: uuid(1, 4),
  regressionCheckout: uuid(1, 5),
  regressionCatalog: uuid(1, 6),
  datasets: uuid(1, 7),
} as const;

/** The suite the boards show: steady-1.2k in the capacity folder, four saved revisions. */
export const steady = { id: uuid(2, 1), revisions: [uuid(3, 1), uuid(3, 2), uuid(3, 3), uuid(3, 4)] } as const;

export const inputIds = { users: uuid(4, 1), cart: uuid(4, 2), checkout: uuid(4, 3) } as const;

export const runIds = {
  running: uuid(5, 1),
  passed: uuid(5, 2),
  failed: uuid(5, 3),
  cancelled: uuid(5, 4),
  passedOld: uuid(5, 5),
  /** Starts with "a7f2" like the board's "Run a7f2" breadcrumb. */
  origin: 'a7f20000-0000-4000-8000-000000000001',
} as const;

export const hex = (c: string) => c.repeat(64);
