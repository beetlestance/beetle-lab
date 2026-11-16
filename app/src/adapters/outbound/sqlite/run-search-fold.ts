import type { DatabaseSync } from 'node:sqlite';
import { runSearchTerms } from '@beetle/contracts/api';
/** Registered before migrations: the sole search fold/tokenizer also owns trigger updates. */
export function registerSearchFold(db: DatabaseSync): void {
  db.function('history_search_terms', { deterministic: true }, value => {
    if (typeof value !== 'string') throw new Error('Invalid indexed name');
    // <=4094 distinct3-scalar strings; even JSON escapes stay below128KiB.
    return JSON.stringify(runSearchTerms(value));
  });
}
