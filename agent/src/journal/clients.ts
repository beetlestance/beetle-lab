import { createNoTaskReceiptClient } from './no-task-receipt-client.js';
import type { JournalNoTaskReceipts } from './no-task-receipt-client.js';
import { createSettlementClient } from './settlement-client.js';
import type { JournalSettlements } from './settlement-client.js';
import { createRuntimeAssociationClient } from './runtime-association-client.js';
import type { JournalRuntimeAssociations } from '../runtime-association/index.js';
import { createCleanupReceiptClient } from './cleanup-receipt-client.js';
import type { JournalCleanupReceipts } from '../cleanup-control/index.js';
import { createCleanupProgressClient } from './cleanup-progress-client.js';
import type { JournalCleanupProgress } from '../cleanup-control/index.js';
import { createCleanupPlanClient } from './cleanup-plan-client.js';
import type { JournalCleanupPlans } from '../cleanup-control/index.js';
import type { JournalRejectedFunding } from './retirement-client.js';
import { createRetirementClient } from './retirement-client.js';
import type { JournalRetirements } from '../retirement-values/index.js';
import { createStagingNamespaceClient } from './staging-namespace-client.js';
import type { StagingNamespaceJournal } from '../staging-namespace/index.js';

import type { Value } from './protocol.js';
import { JournalError } from './options.js';

import type { Operation } from './protocol.js';
interface ClientOptions {
  send(operation: () => Operation, large?: boolean): Promise<Value>;
  fail(): void;
  settleCarrier(): Promise<void>;
}
export interface JournalClients {
  readonly runtimeAssociations: JournalRuntimeAssociations;
  readonly retirements: JournalRetirements & JournalRejectedFunding;
  readonly cleanupPlans: JournalCleanupPlans;
  readonly cleanupProgress: JournalCleanupProgress;
  readonly cleanupReceipts: JournalCleanupReceipts;
  readonly stagingNamespace: StagingNamespaceJournal;
  readonly settlements: JournalSettlements;
  readonly noTaskReceipts: JournalNoTaskReceipts;
}
export function createJournalClients(options: ClientOptions): JournalClients {
  const noTaskReceipts = createNoTaskReceiptClient({
    send: (operation) => options.send(operation),
    invalidReply: () => {
      options.fail();
      throw new JournalError('unavailable');
    },
    settleCarrier: () => retirements.settleCarrier(),
    owner: () => retirements,
  });
  const settlements = createSettlementClient({
    send: (operation) => options.send(operation, true),
    invalidReply: () => {
      options.fail();
      throw new JournalError('unavailable');
    },
    settleCarrier: () => retirements.settleCarrier(),
    owner: () => retirements,
  });
  const runtimeAssociations = createRuntimeAssociationClient({
    send: (operation) => options.send(operation),
    invalidReply: () => {
      options.fail();
      throw new JournalError('unavailable');
    },
    settleCarrier: () => retirements.settleCarrier(),
  });
  const cleanupReceipts = createCleanupReceiptClient({
    send: (operation) => options.send(operation, true),
    invalidReply: () => {
      options.fail();
      throw new JournalError('unavailable');
    },
    settleCarrier: () => retirements.settleCarrier(),
  });
  const cleanupProgress = createCleanupProgressClient({
    send: (operation) => options.send(operation, true),
    invalidReply: () => {
      options.fail();
      throw new JournalError('unavailable');
    },
    settleCarrier: () => retirements.settleCarrier(),
  });
  const cleanupPlans = createCleanupPlanClient({
    send: (operation) => options.send(operation, true),
    invalidReply: () => {
      options.fail();
      throw new JournalError('unavailable');
    },
    settleCarrier: () => retirements.settleCarrier(),
  });
  const retirements = createRetirementClient({
    send: (operation) => options.send(operation),
    invalidReply: () => {
      throw new JournalError('unavailable');
    },
    settleCarrier: () => options.settleCarrier(),
  });
  const stagingNamespace = createStagingNamespaceClient({
    send: (operation) => options.send(operation),
    invalidReply: () => {
      options.fail();
      throw new JournalError('unavailable');
    },
  });
  return {
    noTaskReceipts,
    settlements,
    runtimeAssociations,
    cleanupReceipts,
    cleanupProgress,
    cleanupPlans,
    retirements,
    stagingNamespace,
  };
}
