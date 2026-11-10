import type { Scope } from '../admission/index.js';
import type { AttemptController } from '../controller/index.js';
import type { Preparation } from '../staging/index.js';
import type { RuntimePlan } from '../backends/docker/index.js';
import type { OutputWatch } from '../guard/index.js';
import type { TimeoutWatch } from '../timeout/index.js';
import { copyControlScope } from '../control-protocol/index.js';
import { InstallationError } from './types.js';
import type { DriveProgress } from './types.js';
import type { SourceReceipt, FinishedRelease } from '../output-source/index.js';
import type { OutputDeliveryClosure } from '../journal/index.js';
export interface EntryLease { readonly entry: Entry; readonly done: Promise<void>; finish(): void }
export interface Entry {
  readonly leases: Set<EntryLease>;
  retiring: boolean;
  sourceCheck: boolean;
  sourceReleased: boolean;
  sourceReceipt?: SourceReceipt;
  sourceRelease?: FinishedRelease;
  nativeRetirement?: Promise<void>;
  deliveryAttempt?: Promise<OutputDeliveryClosure>;
  retirementProgress?: DriveProgress;
  urgentStop?: boolean;
  readonly key: Readonly<Scope>;
  readonly abort: AbortController;
  active?: Promise<DriveProgress>;
  cancellation?: Promise<void>;
  preparation?: Preparation;
  controller?: AttemptController;
  plan?: RuntimePlan;
  watch?: OutputWatch;
  watchClosing?: Promise<void>;
  timeout?: TimeoutWatch;
  timeoutClosing?: Promise<void>;
  closing?: Promise<void>;
  users: number;
  version: number;
  cancelled: boolean;
  fresh: boolean;
  prepared: boolean;
  cleanupFailed: boolean;
}
export function scopeCopy(input: Scope): Readonly<Scope> {
  try { return copyControlScope(input); } catch { throw new InstallationError('invalid_input'); }
}
export function identity(key: Scope): string {
  return [key.organizationId, key.workspaceId, key.attemptId, key.generation].join('/').toLowerCase();
}
export function createEntry(key: Readonly<Scope>): Entry {
  return { key, abort: new AbortController(), leases: new Set(), retiring: false, sourceCheck: false, sourceReleased: false,
    users: 0, version: 0, cancelled: false, fresh: false, prepared: false, cleanupFailed: false };
}
