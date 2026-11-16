import type { RetirementIntent } from '../retirement-values/index.js';
import type { Journal } from '../journal/index.js';
import type { VerifiedRoot } from '../staging/index.js';
import type { Catalog } from '../catalog/index.js';
import type { DockerBackend, DockerTransport } from '../backends/docker/index.js';
declare const absence: unique symbol;
/** Removed writer authority only; neither native file absence nor socket quiescence. */
export interface RuntimeAbsent { readonly [absence]: true }
export interface RuntimeAbsentFacts {
  readonly intent: RetirementIntent; readonly daemonId: string;
  readonly runtime: { readonly kind: 'never_started' } | { readonly kind: 'absent'; readonly runtimeId: string; readonly specDigest: string };
}
export interface RuntimeRetirementOptions {
  readonly journal: Journal; readonly root: VerifiedRoot; readonly catalog: Catalog;
  readonly transport: DockerTransport;
  backend(): Pick<DockerBackend, 'removeRetired'>;
}
export type RuntimeRetirementReason = 'invalid_input' | 'capacity' | 'conflict' | 'closed' | 'deadline' | 'unresolved';
export class RuntimeRetirementError extends Error {
  constructor(readonly reason: RuntimeRetirementReason) { super(`Runtime retirement ${reason}`); }
}
