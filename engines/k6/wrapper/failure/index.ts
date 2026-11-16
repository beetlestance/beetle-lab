export type AttemptReason = 'profile' | 'input' | 'output_limit' | 'journal' | 'compile'
  | 'execution' | 'artifact' | 'mapping' | 'seal' | 'publication' | 'cleanup'
  | 'cancelled' | 'deadline' | 'clock' | 'notification';
export class AttemptError extends Error {
  constructor(readonly reason: AttemptReason) { super(reason); this.name = 'AttemptError'; }
}
