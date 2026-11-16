import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { RunMetricSamplesQuery, RunListQuery, PageQuery } from '@beetle/contracts/api';

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

/** Canonical HTTP-only numeric decoding; the JSON client still requires numbers. */
export function decodeMetricSamplesQuery(input: unknown):
  { readonly ok: true; readonly value: RunMetricSamplesQuery } | { readonly ok: false } {
  try {
    const query = JSON.parse(encodeJson(rawFields(input), 4096)) as Record<string, unknown>;
    for (const key of ['limit', 'seriesOrdinal', 'fromTimeMs', 'toTimeMs']) {
      if (query[key] === undefined) continue;
      if (typeof query[key] !== 'string' || !/^(0|[1-9][0-9]*)$/.test(query[key])) return { ok: false };
      query[key] = Number(query[key]);
    }
    const checked = validateApi('RunMetricSamplesQuery', query);
    return checked.ok ? checked : { ok: false };
  } catch { return { ok: false }; }
}

/** Run-only fields stay strict; only the HTTP limit string is decoded. */
export function decodeRunListQuery(input: unknown):
  { readonly ok: true; readonly value: RunListQuery } | { readonly ok: false } {
  try {
    const query = JSON.parse(encodeJson(rawFields(input), 4096)) as Record<string, unknown>;
    if (typeof query.limit !== 'string' || !/^(0|[1-9][0-9]*)$/.test(query.limit)) return { ok: false };
    query.limit = Number(query.limit);
    const checked = validateApi('RunListQuery', query);
    return checked.ok ? checked : { ok: false };
  } catch { return { ok: false }; }
}
