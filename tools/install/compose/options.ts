import { isIP } from 'node:net';
import { join } from 'node:path';
import { loopbackOrigin, originAccess } from '../../../app/src/bootstrap/configuration.js';
import type { StarterOptions } from '../starter.js';
import { ProvisionError } from '../types.js';
const names = [
  'BEETLE_COMPOSE_HOME',
  'BEETLE_COMPOSE_INSTANCE',
  'BEETLE_COMPOSE_PORT',
  'BEETLE_COMPOSE_AGENT_IMAGE',
  'BEETLE_COMPOSE_ENGINE_IMAGE',
  'BEETLE_COMPOSE_EXPORT_IMAGE',
  'BEETLE_COMPOSE_ORIGIN',
  'BEETLE_COMPOSE_BIND',
  'BEETLE_COMPOSE_ACCESS',
] as const;
type Values = Readonly<Record<(typeof names)[number], string | undefined>>;
/**
 * Decision 032. The browser origin defaults to the loopback port; any origin or bind address on
 * another host needs `BEETLE_ACCESS=network`, an HTTPS origin and an IPv4 bind literal. The bind
 * address is Compose-only (port publishing) and never enters the installation request.
 */
export function composeAccess(values: Values, port: string) {
  const loopbackDefault = `http://127.0.0.1:${port}`;
  const access = values.BEETLE_COMPOSE_ACCESS || 'local';
  const bind = values.BEETLE_COMPOSE_BIND || '127.0.0.1';
  const origin = values.BEETLE_COMPOSE_ORIGIN || loopbackDefault;
  if (isIP(bind) !== 4) throw new ProvisionError('invalid_input');
  requireNetwork(access, loopbackOrigin(origin), bind.startsWith('127.'));
  try {
    if (new URL(origin).origin !== origin) throw new Error('Noncanonical origin');
    originAccess(access, origin);
  } catch (cause) {
    throw new ProvisionError('invalid_input', { cause });
  }
  return { externalOrigin: origin, loopbackDefault };
}
function requireNetwork(access: string, localOrigin: boolean, localBind: boolean): void {
  if (access !== 'local' && access !== 'network') throw new ProvisionError('invalid_input');
  if (localOrigin && localBind) return;
  if (access !== 'network') throw new ProvisionError('network_access_required');
  // A non-loopback bind serves browsers on another host, whose Host must match the origin.
  if (!localBind && localOrigin) throw new ProvisionError('invalid_input');
}
/** Only explicit Compose packaging values are captured; credentials are generated later. */
export function composeOptions(environment: Readonly<Record<string, string | undefined>>) {
  const values = Object.fromEntries(names.map((name) => [name, environment[name]])) as Values;
  const home = values.BEETLE_COMPOSE_HOME;
  const instance = values.BEETLE_COMPOSE_INSTANCE;
  const port = values.BEETLE_COMPOSE_PORT;
  if (
    typeof home !== 'string' ||
    typeof instance !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,47}$/.test(instance) ||
    typeof port !== 'string' ||
    !/^[1-9][0-9]{0,4}$/.test(port) ||
    Number(port) > 65535
  )
    throw new ProvisionError('invalid_input');
  const agentImage = values.BEETLE_COMPOSE_AGENT_IMAGE;
  const engineImage = values.BEETLE_COMPOSE_ENGINE_IMAGE;
  const exportEngineImage = values.BEETLE_COMPOSE_EXPORT_IMAGE;
  if (!agentImage || !engineImage || !exportEngineImage) throw new ProvisionError('invalid_input');
  const { externalOrigin, loopbackDefault } = composeAccess(values, port);
  const options: StarterOptions = {
    root: join(home, 'data'),
    uid: 1000,
    gid: 1000,
    externalOrigin,
    agentOrigin: 'http://agent:4312',
    dockerSocket: '/var/run/docker.sock',
    agentContainer: `beetle-${instance}-agent`,
    agentImage,
    agentIdentity: 'socket-group-drop-v1',
    engineImage,
    exportEngineImage,
    targetNetwork: `beetle-${instance}-targets`,
  };
  return { home, options, loopbackDefault };
}
