/** Join every issued original before failure can trigger fixture teardown. */
export async function joinReads<T>(originals: readonly Promise<T>[]): Promise<T[]> {
  const outcomes = await Promise.allSettled(originals);
  return outcomes.map((outcome) => {
    if (outcome.status === 'rejected') throw outcome.reason;
    return outcome.value;
  });
}
