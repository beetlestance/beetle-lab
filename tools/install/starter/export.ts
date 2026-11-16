import type {ProvisionRequest} from '../types.js';
/** Fixed offline template; image and schema authority still come from inspection/catalogue. */
export function starterExport(engine:ProvisionRequest['engine'],image:string):NonNullable<ProvisionRequest['exportEngine']>{
 const manifest=structuredClone(engine.manifest);
 manifest.schemas.result='https://beetle-lab.dev/contracts/runner/v1/export-result';
 manifest.capabilities=['standalone-export-v1'];manifest.network={required:false,profile:'none'};
 manifest.entrypoint={executable:'node',arguments:['/beetle/bootstrap/export-main.js']};
 return {...engine,image,sourceProfileId:engine.profileId,manifestId:'k6-export-v1',profileId:'k6-export-local',manifest};
}
