import type { SettingsChange, SettingsCommand } from '../domain/settings/index.js';
export type { SettingsRequest, SettingsCommand, SettingsEvidence, SettingsChange } from '../domain/settings/index.js';

/**
 * One write transaction: check scoped requestId/digest receipt; matching intent
 * returns original result, different intent throws conflict. Load current scoped
 * UUID equality/uniqueness is case-insensitive; persist canonical lowercase UUIDs.
 * record and all ancestor settings versions inside that transaction, check target
 * identity/expectedVersion, invoke decideSettingsChange locally in the worker,
 * persist ONLY installation values or actual
 * scoped overrides, then receipt. Never persist effective copies as overrides.
 * Ancestor edits must serialize with descendant patches; preflight effective values
 * are not sufficient. Revalidate run acceptance later against current settings.
 * Wrong parent/owner -> not_found; decision errors roll back record and receipt.
 * No effects/retries under an unknown commit; replay the identical request intent.
 * Adapter owns bounded busy/cancellation deadlines, capability freshness and delivery
 * of the drain signal. PATCH never performs retention selection/deletion/admission.
 * Only serializable commands/results cross the worker boundary, never a callback.
 */
export interface SettingsStore {
  execute(command: SettingsCommand): Promise<SettingsChange>;
}
