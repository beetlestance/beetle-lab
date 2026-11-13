import type {Scope} from '../admission/index.js';
import type {RuntimeAssociation} from '../runtime-association/index.js';
export type RuntimeAssociationOperation={readonly kind:'runtimeAssociationRead';readonly key:Scope}|{readonly kind:'runtimeAssociationCommit';readonly json:string};
export type RuntimeAssociationValue={readonly key:Scope;readonly association:RuntimeAssociation|null};
export function runtimeAssociationOperation(input:{readonly kind:string}):input is RuntimeAssociationOperation{
 return input.kind==='runtimeAssociationRead'||input.kind==='runtimeAssociationCommit';
}
