import type {ProvisionContext} from '../types.js';
import {ProvisionError} from '../types.js';
import {check} from '../src/capture.js';
import type {ComposeHome} from './home.js';
import type {ComposeGate} from './gate.js';
const retained=new Set<object>();
interface Owners {home:Pick<ComposeHome,'close'>|undefined;gate:Pick<ComposeGate,'close'>|undefined;success:boolean;operation:Pick<ProvisionContext,'signal'|'deadline'>}
function admitted(operation:Owners['operation'],success:boolean):boolean{
 if(!success)return false;
 try{check(operation);return true;}catch(error){process.stderr.write((error instanceof ProvisionError?error.code:'cancelled')+'\n');return false;}
}
/** The configuration gate outlives every home original, including cancelled ones. */
export async function settleSetup(owners:Owners):Promise<boolean>{
 try{await owners.home?.close();}catch{if(owners.gate)retained.add(owners.gate);process.stderr.write('cleanup\n');return false;}
 const success=admitted(owners.operation,owners.success);
 try{await owners.gate?.close(success);}catch{if(owners.gate)retained.add(owners.gate);process.stderr.write('cleanup\n');return false;}
 return admitted(owners.operation,success);
}
