import type {
  CreateSuiteRequest,
  PatchSuiteRequest,
  CreateSuiteRevisionRequest,
  Suite,
  SuiteRevision,
  SuitePage,
  SuiteRevisionPage,
  SuiteListQuery,
  WorkspaceScope,
} from '@beetle/contracts/api';

export type SuiteOperation =
  | { kind: 'createSuite'; id: string; request: CreateSuiteRequest }
  | { kind: 'patchSuite'; id: string; request: PatchSuiteRequest }
  | { kind: 'createSuiteRevision'; id: string; suiteId: string; request: CreateSuiteRevisionRequest };
export type SuiteCommand = SuiteOperation & { intentDigest: string };
export interface SuiteKey {
  scope: WorkspaceScope;
  id: string;
}
interface ScopedPage {
  scope: WorkspaceScope;
  limit: number;
  cursor?: string;
}
/** Folder-first listing; filters and order follow `SuiteListQuery` (docs/system/contracts/suite-listing.md). */
export type SuiteList = ScopedPage & Omit<SuiteListQuery, 'limit' | 'cursor'>;
export interface RevisionList extends ScopedPage {
  suiteId: string;
}

/** One worker transaction owns replay, scope/FK checks, optimistic version, immutable
 * revision insert and suite pointer/version update. Intent excludes allocation IDs
 * on CREATE, includes route suiteId for revisions and route id on PATCH. The full
 * validated request (including requestId/version) participates in the canonical hash.
 * Use the shared receipt namespace so cross-operation requestId reuse conflicts.
 * Input pins derive from the shared k6 config; exact published scope/hash/size must
 * match inside the same transaction. Metadata declarations are not published bytes.
 */
export interface SuiteStore {
  execute(command: SuiteCommand): Promise<Suite | SuiteRevision>;
}
export interface SuiteReader {
  getSuite(key: SuiteKey): Promise<Suite>;
  listSuites(query: SuiteList): Promise<SuitePage>;
  getRevision(key: SuiteKey): Promise<SuiteRevision>;
  listRevisions(query: RevisionList): Promise<SuiteRevisionPage>;
}
