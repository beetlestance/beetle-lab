function column(name: string, alias: string): string {
  if (!/^[a-z_][a-z0-9_]{0,63}$/.test(name) || !/^(?:[a-z_][a-z0-9_]{0,31}\.)?$/.test(alias))
    throw Error('Invalid SQLite projection');
  return alias + name;
}
/** Bound/type-check stored cells inside SQLite before crossing the native boundary. */
export function sqlTextColumn(name: string, maximum: number, nullable = false, alias = ''): string {
  const source = column(name, alias);
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw Error('Invalid SQLite projection bound');
  return `CASE ${nullable ? `WHEN ${source} IS NULL THEN NULL` : ''}
    WHEN typeof(${source})='text' AND length(CAST(${source} AS BLOB))<=${maximum} THEN ${source}
    ELSE ${nullable ? "''" : 'NULL'} END AS ${name}`;
}
/** Invalid nullable integers use -1, preserving the distinction from genuine NULL. */
export function sqlIntegerColumn(name: string, nullable = false, alias = ''): string {
  const source = column(name, alias);
  return `CASE ${nullable ? `WHEN ${source} IS NULL THEN NULL` : ''}
    WHEN typeof(${source})='integer' AND ${source} BETWEEN 0 AND 9007199254740991 THEN ${source}
    ELSE ${nullable ? '-1' : 'NULL'} END AS ${name}`;
}
