import { encodeJson } from '@beetle/contracts';
import type { Captured } from './capture.js';
import { check } from './capture.js';
import { ProvisionError } from '../types.js';

function requireFact(condition: unknown): asserts condition { if (!condition) throw new Error('Invalid inspection'); }
function record(value: unknown): Record<string, unknown> {
  requireFact(value !== null && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>;
}
function architecture(value: unknown): string {
  if (value === 'x86_64' || value === 'amd64') return 'amd64';
  if (value === 'aarch64' || value === 'arm64') return 'arm64';
  throw new Error('Unsupported architecture');
}
function image(value: Record<string, unknown>, arch: string): { id: string; environment: string[] } {
  const id = value.Id;
  requireFact(typeof id === 'string' && /^sha256:[a-f0-9]{64}$/u.test(id));
  requireFact(value.Os === 'linux' && architecture(value.Architecture) === arch);
  const config = record(value.Config); const environment: unknown = config.Env ?? [];
  requireFact(Array.isArray(environment) && environment.length <= 64);
  requireFact(config.Volumes == null || Object.keys(record(config.Volumes)).length === 0);
  // Catalogue validates the effective environment's names, duplicate keys and byte bounds.
  return { id, environment: environment as string[] };
}
export interface Facts { daemonId: string; agentId: string; engineId: string; environment: string[]; defaultRuntime: string }
export async function inspect(captured: Captured): Promise<Facts> {
  const { request: r, context } = captured;
  const get = async (path: string) => {
    check(context);
    const reply = await context.docker.request({ method: 'GET', path, deadline: context.deadline, signal: context.signal });
    check(context); requireFact(reply.ok && reply.status === 200);
    return record(JSON.parse(encodeJson(reply.body, 1_048_576)) as unknown);
  };
  try {
    const info = await get('/v1.47/info'); requireFact(info.OSType === 'linux');
    const arch = architecture(info.Architecture);
    const daemonId = info.ID; const defaultRuntime = info.DefaultRuntime;
    requireFact(typeof daemonId === 'string' && /^[A-Za-z0-9:._-]{1,128}$/u.test(daemonId));
    requireFact(typeof defaultRuntime === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/u.test(defaultRuntime));
    const agent = image(await get(`/v1.47/images/${encodeURIComponent(r.agentImage)}/json`), arch);
    const engine = image(await get(`/v1.47/images/${encodeURIComponent(r.engineImage)}/json`), arch);
    const network = await get(`/v1.47/networks/${encodeURIComponent(r.targetNetwork)}`);
    requireFact(network.Name === r.targetNetwork);
    return { daemonId, defaultRuntime, agentId: agent.id, engineId: engine.id, environment: engine.environment };
  } catch (cause) {
    check(context); throw new ProvisionError('inspection', { cause });
  }
}
