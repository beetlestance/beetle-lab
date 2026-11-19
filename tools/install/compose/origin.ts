import { join } from 'node:path';
import { validatePrimitive } from '@beetle/contracts';
import { ProvisionError } from '../types.js';
import type { ProvisionContext, ProvisionRequest } from '../types.js';
import { validOrigin } from '../src/origin-selector.js';
import { changeInstallationOrigin } from '../origin/index.js';
import type { ComposeGate } from './gate.js';

export interface OriginArguments {
  readonly from: string;
  readonly operationId: string;
}
/** `['origin', '--from', <origin>, '--operation-id', <uuid>]`; anything else is not this command. */
export function originArguments(args: readonly string[]): OriginArguments | undefined {
  if (args[0] !== 'origin') return undefined;
  if (args.length !== 5 || args[1] !== '--from' || args[3] !== '--operation-id')
    throw new ProvisionError('invalid_input');
  const from = args[2]!;
  const operationId = args[4]!;
  if (!validOrigin(from) || !validatePrimitive('uuid', operationId).ok) throw new ProvisionError('invalid_input');
  return { from, operationId };
}
export async function changeOrigin(input: {
  home: string;
  gate: ComposeGate;
  request: ProvisionRequest;
  context: ProvisionContext;
  origin: OriginArguments;
  to: string;
}) {
  const result = await changeInstallationOrigin(
    {
      request: input.request,
      from: input.origin.from,
      to: input.to,
      operationId: input.origin.operationId,
      originDirectory: join(input.home, 'origin'),
      upgradeDirectory: join(input.home, 'upgrade'),
    },
    input.context,
  );
  input.gate.matchInstallation(result.installationId);
  return result;
}
