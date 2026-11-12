import { validId } from '../../../app/routes.js';
/** URLs retain only the bounded ordered run selection; the first is baseline. */
export function comparisonRunIds(search: string): string[] | undefined {
  if (search.length > 512) return;
  const query = new URLSearchParams(search);
  if ([...query.keys()].length !== 1 || !query.has('runs')) return;
  const ids = query.get('runs')!.split(',').map(id => id.toLowerCase());
  if (ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length || !ids.every(validId)) return;
  return ids;
}
