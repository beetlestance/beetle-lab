import {enterContainerIdentity} from './container-identity.js';
try{
 enterContainerIdentity();await import('./main.js');
}catch{
 process.stderr.write('Beetle Lab container identity setup failed.\n');process.exitCode=1;
}
