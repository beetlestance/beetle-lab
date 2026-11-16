import { purgeOrder022 } from './purge-order-022.js';
/** New funded no-task rows precede every original; historical022 SQL stays frozen. */
export const purgeOrder=['output_no_task_cleanup_receipts','rejected_cleanup_controls',...purgeOrder022] as const;
