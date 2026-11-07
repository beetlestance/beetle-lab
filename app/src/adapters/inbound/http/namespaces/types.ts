import type { onRequestAsyncHookHandler } from 'fastify';
import type { NamespaceStore } from '../../../../ports/namespaces.js';
import type { NamespaceReader } from '../../../../ports/namespace-reader.js';
import type { IntentDigest } from '../../../../application/namespaces/index.js';

export interface NamespaceRouteOptions {
  readonly store: NamespaceStore;
  readonly reader: NamespaceReader;
  readonly newId: () => string;
  readonly digest: IntentDigest;
  /** Required session/origin/CSRF guard supplied by composition, before parsing. */
  readonly authorize: onRequestAsyncHookHandler;
}
