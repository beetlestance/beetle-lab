import {encodeJson} from '@beetle/contracts';
import type {ExportConfiguration} from '../../../ports/exports.js';
import type {RunConfiguration} from '../../../ports/runs.js';
import {immutableSnapshot,requireRule} from '../../../domain/namespaces/index.js';
import {checkedRunConfiguration} from './configuration.js';

export function checkedExportConfiguration(input:ExportConfiguration, runs:RunConfiguration):ExportConfiguration {
 const copy=JSON.parse(encodeJson(input,65536)) as ExportConfiguration;
 requireRule(copy!==null&&Object.keys(copy).sort().join(',')==='pendingLimit,profiles');
 requireRule(Array.isArray(copy.profiles)&&copy.profiles.length<=32);
 const sourceIds=new Set<string>();
 for(const entry of copy.profiles){
  requireRule(entry!==null&&Object.keys(entry).sort().join(',')==='profile,sourceProfileId');
  requireRule(typeof entry.sourceProfileId==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(entry.sourceProfileId));
  requireRule(!sourceIds.has(entry.sourceProfileId));sourceIds.add(entry.sourceProfileId);
  requireRule(runs.profiles.some(pin=>pin.engine.profileId===entry.sourceProfileId));
  requireRule(entry.profile.requiredCapabilities.includes('standalone-export-v1'));
 }
 checkedRunConfiguration({profiles:copy.profiles.map(entry=>entry.profile),pendingLimit:copy.pendingLimit});
 return immutableSnapshot(copy);
}
