import { encodeCanonicalJson } from '@beetle/contracts';
import type { RetentionSnapshot } from '../../../../domain/retention/index.js';
import type { retentionBasis } from '../retention-accounting/index.js';
import { requireFact } from '../retention-accounting/facts.js';
export function requireSnapshotBasis(previous:RetentionSnapshot,basis:ReturnType<typeof retentionBasis>):void{
 requireFact(previous.epoch===basis.epoch&&encodeCanonicalJson([previous.settings,previous.policy,previous.policySource],4096)===encodeCanonicalJson([basis.settings,basis.policy,basis.policySource],4096));
}
