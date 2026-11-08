import { createPublication } from './operation.js';
import { nodeIo } from './ports.js';
import type { PublicationOptions, ResultPublication } from './types.js';
export type { PublicationOptions, PublicationCode, PublicationResult, ResultPublication } from './types.js';

/** Publish one verified content seal; no artifact custody or outcome authority. */
export function publishK6Result(input: PublicationOptions): ResultPublication { return createPublication(input, nodeIo); }
