import { encodeJson } from '@beetle/contracts';
import type { SuiteRevision } from '@beetle/contracts/api';
import { requireRule } from '../namespaces/index.js';

type Pin = SuiteRevision['inputManifest'][number];
function references(config: Record<string, unknown>): Pin[] {
  const datasets = config.datasets as { kind: string; input?: Pin }[];
  const requests = (config.requests ?? []) as { body?: { kind: string; input?: Pin } }[];
  return [...datasets.filter(dataset => dataset.kind === 'json' || dataset.kind === 'csv').map(dataset => dataset.input!),
    ...requests.flatMap(request => request.body?.kind === 'input' ? [request.body.input!] : [])];
}
/** Input is bounded and structurally validated by the shipped k6 schema first. */
export function inputManifest(config: Record<string, unknown>): Pin[] {
  const pins = new Map<string, Pin>();
  for (const input of references(config)) {
    const pin = { ...input, id: input.id.toLowerCase() };
    const previous = pins.get(pin.id);
    requireRule(!previous || (previous.sha256 === pin.sha256 && previous.bytes === pin.bytes));
    pins.set(pin.id, pin); requireRule(pins.size <= 64);
  }
  const result = [...pins.values()].sort((a, b) => a.id.localeCompare(b.id));
  encodeJson(result, 65536);
  return result;
}
