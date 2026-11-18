import { expect, it } from 'vitest';
import { responseBody } from './response-body.js';
it('keeps the artifact ceiling while permitting the explicit bounded history profile', async () => {
  const bytes = new Uint8Array(1048577);
  const refused = new Response(bytes);
  await expect(responseBody(refused, { maximum: 2097152 }, new AbortController().signal)).rejects.toThrow();
  await refused.body?.cancel();
  expect(
    (
      await responseBody(
        new Response(bytes),
        { maximum: 2097152, profile: 'api-history' },
        new AbortController().signal,
      )
    ).length,
  ).toBe(bytes.length);
});
