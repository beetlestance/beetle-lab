export { InstallationError } from './types.js';
export type { InstallationOptions, OfferAcceptance, DriveProgress, InstallationAttempt,
  InstallationController, InstallationReason } from './types.js';
import { Manager } from './manager.js';
import type { InstallationOptions, InstallationController } from './types.js';
export function createInstallationController(options: InstallationOptions): InstallationController { return new Manager(options); }
