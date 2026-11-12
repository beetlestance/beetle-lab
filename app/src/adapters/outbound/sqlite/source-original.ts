import {encodeCanonicalJson,executionArtifacts} from '@beetle/contracts';
import type {Offer} from '@beetle/contracts';
import type {Owned,SourceEnvelope} from '@beetle/contracts/output-source';
import type {OutputBinding} from '../../../domain/output-owner/index.js';
import {StorageError} from './protocol.js';
/** Purpose-neutral physical scope/engine pins; caller selects its own result codec. */
export function requireSourceOriginal(value:Owned<SourceEnvelope>,binding:OutputBinding,offer:Pick<Offer,'engine'|'installedIdentity'>):void {
 const b=value.manifest.binding;const a=binding.key.attempt;
 const equal=b.organizationId===a.organizationId&&b.workspaceId===a.workspaceId&&b.attemptId===a.attemptId
  &&b.intentDigest===a.intentDigest&&b.generation===a.generation&&b.journalAuthority===binding.journalAuthority;
 if(!equal||encodeCanonicalJson(b.engine,4096)!==encodeCanonicalJson(offer.engine,4096)
  ||encodeCanonicalJson(b.installedIdentity,4096)!==encodeCanonicalJson(offer.installedIdentity,4096))throw new StorageError('conflict');
 const ids=executionArtifacts(value.manifest.result).map(artifact=>artifact.artifactId.toLowerCase());
 if(new Set(ids).size!==ids.length)throw new StorageError('conflict');
}
