/** Full 1 MiB config plus scoped revision/receipt envelope; runner bounds stay separate. */
export const API_MAXIMUM_JSON_BYTES = 2_097_152;
export const SUITE_MAXIMUM_CONFIG_BYTES = 1_048_576;

/** Complete run-event JSON page, including metadata and cursors. */
export const RUN_EVENT_PAGE_BYTES = 262_144;

/** Public artifact metadata page; native file records retain their 4 KiB bound. */
export const RUN_ARTIFACT_PAGE_BYTES = 73_728;

/** Complete retained-metric catalogue/sample JSON page. */
export const RUN_METRIC_PAGE_BYTES = 262_144;
