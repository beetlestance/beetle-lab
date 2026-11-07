import { immutableSnapshot, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type { SettingsChange, SettingsCommand, SettingsRequest,
  SettingsStore } from '../../ports/settings.js';
import { digestMutationIntent } from '../namespaces/index.js';
import type { IntentDigest } from '../namespaces/index.js';

export function prepareSettingsCommand(input: {
  id: string; request: SettingsRequest; digest: IntentDigest;
}): SettingsCommand {
  const intent = immutableSnapshot({ kind: 'patchSettings' as const, id: input.id, request: input.request });
  return immutableSnapshot({ ...intent, intentDigest: digestMutationIntent(intent, input.digest) });
}

export async function patchSettings(input: {
  id: string; request: SettingsRequest; digest: IntentDigest; store: SettingsStore;
}): Promise<SettingsChange> {
  const command = prepareSettingsCommand(input);
  const result = await input.store.execute(command);
  requireRule(sameUuid(result.settings.id, command.id) && sameScope(result.settings.scope, command.request.scope), 'not_found');
  return immutableSnapshot(result);
}
