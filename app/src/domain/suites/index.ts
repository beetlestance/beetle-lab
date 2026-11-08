import { encodeJson } from '@beetle/contracts';
import type { SuiteRevision } from '@beetle/contracts/api';
import { requireRule } from '../namespaces/index.js';

type Pin = SuiteRevision['inputManifest'][number];
/** Input is bounded and structurally validated by the shipped k6 schema first. */
export function inputManifest(config: Record<string, unknown>): Pin[] {
  const pins = new Map<string, Pin>();
  for (const dataset of config.datasets as { kind: string; input?: Pin }[]) {
    if (dataset.kind !== 'json' && dataset.kind !== 'csv') continue;
    const input = dataset.input!;
    const pin = { ...input, id: input.id.toLowerCase() };
    const previous = pins.get(pin.id);
    requireRule(!previous || (previous.sha256 === pin.sha256 && previous.bytes === pin.bytes));
    pins.set(pin.id, pin);
  }
  const result = [...pins.values()].sort((a, b) => a.id.localeCompare(b.id));
  encodeJson(result, 65536);
  return result;
}
