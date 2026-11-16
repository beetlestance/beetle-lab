import type { CompiledSuite, DeepReadonly } from '../plan/index.js';
import { utf8Bytes } from './bounds.js';
import { stop } from './failure.js';
import type { RuntimeInput, RuntimeLimits } from './types.js';

/** Resolver and returned values remain in the private request-rendering closure. */
export function secretResolver(suite: DeepReadonly<CompiledSuite>, input: RuntimeInput['resolveSecret'], limits: RuntimeLimits): (name: string) => string {
  const allowed = new Set(suite.identity.secrets.map(secret => secret.name));
  const values = new Map<string, string>();
  let total = 0;
  return name => {
    if (!allowed.has(name)) return stop('secret');
    const previous = values.get(name);
    if (previous !== undefined) return previous;
    let value: string;
    try { value = input(name); } catch { return stop('secret'); }
    if (typeof value !== 'string' || value.length > limits.secretBytes) return stop('secret');
    let bytes: number;
    try { bytes = utf8Bytes(value, limits.secretBytes); } catch { return stop('secret'); }
    if (total + bytes > limits.aggregateSecretBytes) return stop('secret');
    values.set(name, value); total += bytes;
    return value;
  };
}
