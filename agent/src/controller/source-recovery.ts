import { encodeCanonicalJson } from '@beetle/contracts';
import type { ReleaseEvidence, Reservation } from '../admission/index.js';
import type { OutputRootIdentity } from '../collection/output/index.js';
import type { WrapperCheckpoint } from '../control-protocol/index.js';
import type { CollectionIntent } from '../output-source/index.js';
import type { LaunchState } from '../supervisor/index.js';
import type { CollectionAuthority } from './authority.js';
import { stoppedReservation } from './release.js';
import { ControllerError } from './types.js';
import type { ControllerPorts } from './types.js';

export function sameSourceFact(left: unknown, right: unknown): boolean {
  return encodeCanonicalJson(left, 131_072) === encodeCanonicalJson(right, 131_072);
}
export function outputLocation(options: ControllerPorts): { directory: string; uid: number } {
  const mount = options.input.plan.spec.HostConfig.Mounts.find(value => value.Target === '/beetle/output');
  if (!mount || mount.ReadOnly) throw new ControllerError('invalid_input');
  return { directory: mount.Source, uid: Number(options.input.plan.spec.User.split(':')[0]) };
}
export function checkRoot(options: ControllerPorts, root: Readonly<OutputRootIdentity>): void {
  const expected = outputLocation(options);
  if (root.directory !== expected.directory || root.uid !== expected.uid) throw new ControllerError('journal');
}
export function checkReleased(current: Reservation, evidence: ReleaseEvidence): void {
  const key = { organizationId: current.organizationId, workspaceId: current.workspaceId,
    attemptId: current.attemptId, generation: current.generation };
  if (current.status !== 'released' || !sameSourceFact(key, evidence.key)
    || !sameSourceFact(current.releaseEvidence, evidence)) throw new ControllerError('journal');
}
/** Compare owned observations only; all native checks remain with the file owners. */
export function checkRecovered(input: { options: ControllerPorts; intent: CollectionIntent; authority: CollectionAuthority;
  current: Reservation; state: LaunchState; root: Readonly<OutputRootIdentity>; checkpoint: Readonly<WrapperCheckpoint> }): void {
  const { intent, current } = input;
  checkRoot(input.options, input.root);
  if (!sameSourceFact(intent.binding, input.authority.binding) || !sameSourceFact(intent.root, input.root)
    || !sameSourceFact(intent.checkpoint, input.checkpoint) || !sameSourceFact(intent.launch, current.launchSettlement)
    || !stoppedReservation(current, input.state)) throw new ControllerError('journal');
}
