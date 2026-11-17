import { validateApi } from '@beetle/contracts/api';
import { requireRule } from '../../domain/namespaces/index.js';
import { INPUT_DEPENDENCY_PREVIEW, InputDependencyError } from '../../ports/inputs.js';
import type { InputKey, InputStore, InputUsagePage, InputUsageQuery } from '../../ports/inputs.js';
import { snapshot } from './validation.js';

function protectedRefusal(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = Object.getOwnPropertyDescriptor(error, 'code');
  return code !== undefined && 'value' in code && code.value === 'protected_dependency';
}
export function checkedUsagePage(value: InputUsagePage, query: InputUsageQuery): InputUsagePage {
  const page = snapshot(value);
  requireRule(Object.keys(page).every((key) => ['total', 'items', 'nextCursor'].includes(key)));
  requireRule(Number.isSafeInteger(page.total) && page.total >= 0 && Array.isArray(page.items));
  requireRule(page.items.length <= query.limit && page.items.length <= page.total);
  requireRule(page.nextCursor === null || (typeof page.nextCursor === 'string' && page.nextCursor.length <= 512));
  page.items.forEach((item) => requireRule(validateApi('RevisionDependency', item).ok));
  return page;
}
/** A refusal names its first blockers; the store's refusal stays authoritative if the lookup fails. */
export async function namedRefusal(store: InputStore, key: InputKey, error: unknown): Promise<never> {
  if (!protectedRefusal(error)) throw error;
  let page: InputUsagePage;
  try {
    const query = { key, limit: INPUT_DEPENDENCY_PREVIEW };
    page = checkedUsagePage(await store.usage(query), query);
  } catch {
    throw error;
  }
  if (page.total < 1 || page.items.length < 1) throw error;
  throw new InputDependencyError({ total: page.total, items: page.items });
}
