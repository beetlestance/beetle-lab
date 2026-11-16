import { encodeJson } from '@beetle/contracts';
import type { EngineManifest, Offer } from '@beetle/contracts';
import type { ExportBinding, InstallationProfile } from './types.js';
const purposeKey='BEETLE_JOB_PURPOSE'; const digestKey='BEETLE_ASSIGNMENT_DIGEST';
/** Installed policy plus durable assignment, never arbitrary job environment. */
export function exportEnvironment(input: unknown, offer: Offer, manifest: EngineManifest, profile: InstallationProfile): readonly string[] {
  const base=profile.effectiveImage.environment;
  if (base.some(entry=>[purposeKey,digestKey].includes(entry.split('=')[0]!))) throw new Error('reserved_environment');
  if (input === undefined) {
    if (manifest.schemas.result.endsWith('/export-result')) throw new Error('missing_export_binding');
    return base;
  }
  const binding=requireBinding(input);
  if (!exportProfile(offer,manifest,profile)) throw new Error('export_profile');
  return [...base,`${purposeKey}=standalone_export`,`${digestKey}=${binding.assignmentDigest}`];
}

function requireBinding(input:unknown):ExportBinding {
  const binding=JSON.parse(encodeJson(input,1024)) as ExportBinding;
  if (Object.keys(binding).sort().join(',') !== 'assignmentDigest,purpose' || binding.purpose !== 'standalone_export'
    || !(typeof binding.assignmentDigest === 'string' && /^[a-f0-9]{64}$/.test(binding.assignmentDigest))) throw new Error('export_binding');
  return Object.freeze(binding);
}
function exportProfile(offer:Offer,manifest:EngineManifest,profile:InstallationProfile):boolean {
  return manifest.schemas.result === 'https://beetle-lab.dev/contracts/runner/v1/export-result'
    && manifest.capabilities.includes('standalone-export-v1') && offer.requiredCapabilities.includes('standalone-export-v1')
    && manifest.entrypoint.executable === 'node' && JSON.stringify(manifest.entrypoint.arguments) === JSON.stringify(['/beetle/bootstrap/export-main.js'])
    && profile.network.profile === 'none' && !manifest.network.required && !profile.liveMetricMailbox;
}
