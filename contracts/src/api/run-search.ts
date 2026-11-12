/** Literal current-name search; never a regex, query language or SQL fragment. */
export function normalizeRunSearchName(value: string): string {
  if (typeof value !== 'string' || value.length > 256 || /[\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid search name');
  const name = foldRunSearchName(value);
  if ([...name].length < 3 || new TextEncoder().encode(name).length > 64
    || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('Invalid search name');
  return name;
}
export function normalizeRunIdPrefix(value: string): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 36) throw new Error('Invalid run ID prefix');
  const prefix = value.toLowerCase();
  const layout = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
  if (![...prefix].every((char, i) => layout[i] === '-' ? char === '-' : /^[0-9a-f]$/.test(char))) {
    throw new Error('Invalid run ID prefix');
  }
  return prefix;
}
/** Unicode scalar trigrams agree with SQLite substr over persisted folded names. */
export function runSearchTerms(name: string): string[] {
  const chars = [...foldRunSearchName(name)];
  if (chars.length > 4096) throw new Error('Search index name limit');
  return [...new Set(chars.slice(0, -2).map((_, i) => chars.slice(i, i + 3).join('')))];
}

/** Search-only canonical spelling; namespace sibling keys retain their own identity. */
export function foldRunSearchName(value: string): string {
  if (typeof value !== 'string' || value.length > 16384) throw new Error('Search index name limit');
  return value.trim().normalize('NFKC').toLowerCase().normalize('NFKC');
}
