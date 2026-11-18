import { configurationNames } from '@beetle/contracts/installation-generation';
import { ProvisionError } from '../types.js';
import { capture, canonical, digest } from './capture.js';
import type { Captured } from './capture.js';
import { configurations, generationRequest, paths } from './configuration.js';
import type { Facts } from './inspection.js';
import type { PrivateFiles } from './files.js';
import { jsonBytes, parse } from './receipt.js';
import type { Receipt } from './receipt.js';

/** Image identities an offline upgrade may move; nothing else in a configuration may differ. */
export interface ImagePins {
  readonly agent: string;
  readonly engines: readonly { readonly profileId: string; readonly imageDigest: string }[];
}
export interface Selection {
  /** Policy-preserving request: the committed generation when present, else the baseline request. */
  readonly active: Captured;
  /** The configurations currently selected by the receipt. */
  readonly selected: Readonly<Record<string, unknown>>;
}
const decode = (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value);
export async function selection(c: Captured, files: PrivateFiles, receipt: Receipt): Promise<Selection> {
  const p = paths(c.request.root);
  const selected: Record<string, unknown> = {};
  if (receipt.generation) Object.assign(selected, receipt.generation.configurations);
  else
    for (const [name, path] of [
      ['installation.json', p.installation],
      ['backend-agent.json', p.backendAgent],
      ['agent.json', p.agent],
    ] as const)
      selected[name] = parse(await files.read(path));
  const active = receipt.generation
    ? capture(
        generationRequest(c, receipt, {
          agent: decode(await files.read(p.agent)),
          installation: decode(await files.read(p.installation)),
        }),
        c.context,
      )
    : c;
  return { active, selected };
}
export function matchesReceipt(receipt: Receipt, expected: Record<string, unknown>): boolean {
  return configurationNames.every((name) =>
    receipt.generation
      ? canonical(expected[name]) === canonical(receipt.generation.configurations[name])
      : digest(Buffer.from(jsonBytes(expected[name])).toString('utf8')) === receipt.configDigests[name],
  );
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new ProvisionError('recovery_required');
  return value as Record<string, unknown>;
}
function image(value: unknown): { id: string; environment: string[] } {
  const profile = record(record(value).profile);
  const effective = record(profile.effectiveImage);
  if (typeof profile.imageDigest !== 'string' || !Array.isArray(effective.environment))
    throw new ProvisionError('recovery_required');
  return { id: profile.imageDigest, environment: effective.environment as string[] };
}
/** Fresh daemon facts with the image identities the selected agent configuration pins. */
export function pinnedFacts(fresh: Facts, agentConfiguration: unknown): Facts {
  const agent = record(agentConfiguration);
  const installation = record(agent.installation);
  const engines = agent.engines;
  if (
    !Array.isArray(engines) ||
    engines.length < 1 ||
    engines.length > 2 ||
    typeof installation.agentImageId !== 'string'
  )
    throw new ProvisionError('recovery_required');
  const normal = image(engines[0]);
  const offline = engines[1] === undefined ? undefined : image(engines[1]);
  return {
    ...fresh,
    agentId: installation.agentImageId,
    engineId: normal.id,
    environment: normal.environment,
    ...(offline ? { export: offline } : {}),
  };
}
export function imagePins(agentConfiguration: unknown): ImagePins {
  const agent = record(agentConfiguration);
  const engines = agent.engines as unknown[];
  return {
    agent: String(record(agent.installation).agentImageId),
    engines: engines.map((engine) => {
      const value = record(engine);
      return { profileId: String(value.profileId), imageDigest: image(value).id };
    }),
  };
}
export interface Evaluation {
  readonly selection: Selection;
  readonly expected: Record<string, unknown>;
  /** Selected configuration equals the configuration derived from fresh facts. */
  readonly current: boolean;
  /** Selected configuration equals fresh facts with only image identities replaced. */
  readonly imagesMoved: boolean;
}
/** Derives the expected configuration; any derivation failure is recovery, never upgrade. */
export async function evaluate(c: Captured, files: PrivateFiles, receipt: Receipt, facts: Facts): Promise<Evaluation> {
  try {
    const chosen = await selection(c, files, receipt);
    const expected = configurations(chosen.active, receipt.installationId, facts);
    const current = matchesReceipt(receipt, expected);
    const imagesMoved =
      !current &&
      matchesReceipt(
        receipt,
        configurations(chosen.active, receipt.installationId, pinnedFacts(facts, chosen.selected['agent.json'])),
      );
    return { selection: chosen, expected, current, imagesMoved };
  } catch (cause) {
    if (cause instanceof ProvisionError && cause.code === 'cleanup') throw cause;
    throw new ProvisionError('recovery_required', { cause });
  }
}
