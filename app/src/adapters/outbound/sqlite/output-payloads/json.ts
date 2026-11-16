const inputs = {
  outputClosure: ['NEW.closure_json', '2048'],
  outputSlot: ['NEW.slot_json', '256'],
  carrier: ['NEW.canonical_json', "CASE NEW.kind WHEN 'result' THEN 65536 WHEN 'manifest' THEN 73728 ELSE 0 END"],
  header: ['NEW.snapshot_json', '2048'],
  snapshot: ['e.snapshot_json', '73728'],
} as const;
/** Fixed trusted SQL only. CASE is lazy: json_tree never sees oversized, nontext or invalid JSON. */
export function boundedUniqueJson(input: keyof typeof inputs): string {
  const [value, maximum] = inputs[input];
  return `(CASE WHEN typeof(${value})!='text' THEN 0
    WHEN length(CAST(${value} AS BLOB)) NOT BETWEEN 1 AND (${maximum}) THEN 0
    WHEN json_valid(${value})!=1 THEN 0
    ELSE NOT EXISTS(SELECT 1 FROM json_tree(${value}) WHERE key IS NOT NULL
      GROUP BY parent,key HAVING count(*)>1) END)`;
}
