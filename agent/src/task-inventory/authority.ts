import { encodeCanonicalJson } from '@beetle/contracts';
import { runtimeAbsentFacts } from '../runtime-retirement/index.js';
import type { RuntimeAbsent } from '../runtime-retirement/index.js';
import { retirementRoot } from '../staging/index.js';
import type { VerifiedRoot } from '../staging/index.js';
import type { Journal } from '../journal/index.js';
import { captureTaskNamespaceState } from '../staging-namespace/index.js';
import { runtimeName } from '../backends/docker/index.js';
import { requireInventory } from './checks.js';
import type { OutputIO } from '../collection/output/index.js';
export interface InventoryAuthority { readonly journal: Journal; readonly root: VerifiedRoot }
export function inventoryScope(options: InventoryAuthority, token: RuntimeAbsent) {
  const facts = runtimeAbsentFacts(token, options.journal.retirements); const root = retirementRoot(options.root);
  const intent = facts.intent; requireInventory(intent.namespaceIdentity === root.namespaceIdentity && intent.task.state === 'prepared');
  const name = runtimeName({ ...intent.request, installationId: root.installationId });
  return Object.freeze({ facts, root, directory: `${root.directory}/${name}`, name });
}
export async function inventoryAnchor(options: InventoryAuthority, token: RuntimeAbsent, io: OutputIO) {
  const scope = inventoryScope(options, token); const { organizationId, workspaceId, attemptId, generation } = scope.facts.intent.request;
  const key = { organizationId, workspaceId, attemptId, generation };
  const stored = await io.io(() => options.journal.retirements.read(key));
  requireInventory(encodeCanonicalJson(stored, 4096) === encodeCanonicalJson(scope.facts.intent, 4096));
  const current = await io.io(() => options.journal.retirements.preflight(scope.facts.intent.request));
  requireInventory(encodeCanonicalJson(current, 4096) === encodeCanonicalJson(scope.facts.intent, 4096));
  const task = captureTaskNamespaceState(await io.io(() => options.journal.stagingNamespace.readTask(key)));
  requireInventory(task?.state === 'prepared' && scope.facts.intent.task.state === 'prepared');
  requireInventory(task.anchor.taskNamespaceIdentity === scope.facts.intent.task.taskNamespaceIdentity
    && task.intent.runtimeName === scope.name && task.intent.purpose === 'performance'
    && task.intent.namespaceIdentity === scope.root.namespaceIdentity);
  if (scope.facts.runtime.kind === 'absent') requireInventory(task.intent.specDigest === scope.facts.runtime.specDigest);
  return Object.freeze({ ...scope, anchor: task.anchor });
}
