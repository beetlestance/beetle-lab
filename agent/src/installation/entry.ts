import type { Scope } from '../admission/index.js';
import type { AttemptController } from '../controller/index.js';
import type { Preparation } from '../staging/index.js';
import type { RuntimePlan } from '../backends/docker/index.js';
import type { OutputWatch } from '../guard/index.js';
import { copyControlScope } from '../control-protocol/index.js';
import { InstallationError } from './types.js';
import type { DriveProgress } from './types.js';
export interface Entry {
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
  return { key, abort: new AbortController(), users: 0, version: 0, cancelled: false, fresh: false, prepared: false, cleanupFailed: false };
}
