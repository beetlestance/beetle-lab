export type Close = () => Promise<unknown>;
export async function drain(operations: Close[]): Promise<boolean> {
  const originals = operations.map((operation) => {
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error);
    }
  });
  const results = await Promise.allSettled(originals);
  return results.every((result) => result.status === 'fulfilled');
}
