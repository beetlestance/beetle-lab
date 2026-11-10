export type OutputTransferCode = 'invalid_input' | 'pending' | 'unavailable' | 'conflict' | 'busy' | 'interrupted';
export class OutputTransferError extends Error {
  constructor(readonly code: OutputTransferCode) { super(`Output transfer ${code}`); }
}
