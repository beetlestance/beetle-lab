import {enterContainerIdentity} from '../../../../agent/src/bootstrap/index.js';
try{
 enterContainerIdentity();console.log(JSON.stringify({kind:'telemetry.bootstrap',version:1}));
 await import('./main.js');
}catch{
 console.error('Qualification telemetry bootstrap failed');process.exitCode=1;
}
