/** Selected source IDs only; expand colliding prefixes without inventing a run ordinal. */
export function comparisonRunLabels(ids: readonly string[]): ReadonlyMap<string, string> {
  const canonical = ids.map((id) => id.toLowerCase());
  const pair = (id: string) => `${id.slice(0, 4)}…${id.slice(-4)}`;
  return new Map(
    canonical.map((id) => {
      if (canonical.filter((peer) => peer.startsWith(id.slice(0, 4))).length === 1) return [id, id.slice(0, 4)];
      return [id, canonical.filter((peer) => pair(peer) === pair(id)).length === 1 ? pair(id) : id];
    }),
  );
}
