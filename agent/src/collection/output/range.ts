import { startRange } from './range-operation.js';
import type { OutputRange, OutputRangeOptions } from './range-types.js';

export function readOutputRange(options: OutputRangeOptions): OutputRange { return startRange(options); }
