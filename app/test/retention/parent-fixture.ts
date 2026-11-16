import type { history } from './selection-fixture.js';
import { uuid } from './selection-fixture.js';
import type { ParentRetentionScope } from '../../src/domain/retention/index.js';
export function parentCommand(f:ReturnType<typeof history>,sequence=0,cursor?:string,owner:ParentRetentionScope={kind:'installation'}){
 const chain=f.settings.chain(owner);const pin=owner.kind==='installation'?chain.installation:chain.organization!;
 return{id:uuid(40000+sequence),capturedAt:'2026-11-14T12:00:00.000Z',request:{scope:owner,requestId:uuid(41000+sequence),settingsId:pin.id,expectedVersion:pin.version,page:{limit:2,...(cursor?{cursor}:{})}}};
}
