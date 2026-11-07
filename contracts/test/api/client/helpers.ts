import { vi } from 'vitest';
import { fixture } from '../fixtures.js';
import { validateApi } from '../../../src/api/index.js';
import type { ApiTypes } from '../../../src/api/index.js';

export const organizationId = '00000000-0000-4000-8000-000000000001';
export const workspaceId = '00000000-0000-4000-8000-000000000002';
export const otherId = '00000000-0000-4000-8000-000000000099';
export const params = { organizationId, workspaceId };
export const baseUrl = 'https://api.invalid/ignored/';
export async function load<N extends keyof ApiTypes>(name: string, schema: N): Promise<ApiTypes[N]> {
  const checked = validateApi(schema, await fixture(`valid/${name}.json`));
  if (!checked.ok) throw new Error(`Invalid shipped fixture ${name}`);
  return checked.value;
}
export function reply(data: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => Response.json(data, { status }));
}
