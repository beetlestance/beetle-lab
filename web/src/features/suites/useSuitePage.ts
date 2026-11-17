import { useSearchParams } from 'react-router-dom';
import { readSuitePage, suitePageSearch } from '../../app/routes.js';
import type { SuitePage } from '../../app/routes.js';

/**
 * The suite page's tab, editor view, open request and Start run flag, read from
 * and written to the URL (routes.suitePage). Tab and dialog changes replace the
 * entry; editor view changes push one, so back and forward move between views.
 */
export function useSuitePage() {
  const [search, setSearch] = useSearchParams();
  const update = (changes: SuitePage, options: { push?: boolean } = {}) =>
    setSearch((current) => suitePageSearch(changes, current), { replace: !options.push });
  return { page: readSuitePage(search), update };
}
