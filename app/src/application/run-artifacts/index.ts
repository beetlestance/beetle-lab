import { runArtifactPageMatches, validateApi } from '@beetle/contracts/api';
import type { RunArtifactPage } from '@beetle/contracts/api';
import type { RunArtifactListQuery, RunArtifactsReader } from '../../ports/run-artifacts.js';
/** Metadata read only; validate the bounded publication page before transport serialization. */
export async function listArtifacts(query: RunArtifactListQuery, reader: RunArtifactsReader): Promise<RunArtifactPage> {
  const checked = validateApi('RunArtifactPage', await reader.listRunArtifacts(query));
  if (!checked.ok || !runArtifactPageMatches(checked.value, query)) throw new Error('Invalid artifact page');
  return checked.value;
}
