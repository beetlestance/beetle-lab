import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { PageQuery } from '@beetle/contracts/api';

export type PageQueryDecodeResult = { readonly ok: true; readonly value: PageQuery } | { readonly ok: false };

function rawFields(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('query');
  // Fastify's query parser uses its own null-ancestor prototype. Copy only data fields.
  const fields = Object.create(null) as Record<string, unknown>;
  let count = 0;
  for (const key in input) {
    if (!Object.hasOwn(input, key)) continue;
    if (++count > 16) throw new Error('query');
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!field || !('value' in field)) throw new Error('query');
    fields[key] = field.value;
  }
  return fields;
}

/** Raw HTTP query adapter only. JSON bodies retain strict numeric validation. */
export function decodePageQuery(input: unknown): PageQueryDecodeResult {
  try {
    const snapshot = JSON.parse(encodeJson(rawFields(input), 4096)) as unknown;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { ok: false };
    const query = snapshot as Record<string, unknown>;
    if (typeof query.limit !== 'string' || !/^(0|[1-9][0-9]*)$/.test(query.limit)) return { ok: false };
    query.limit = Number(query.limit);
    const checked = validateApi('PageQuery', query);
    return checked.ok ? checked : { ok: false };
  } catch { return { ok: false }; }
}
