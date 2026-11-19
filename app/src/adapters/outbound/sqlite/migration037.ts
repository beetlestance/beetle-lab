/** Display-only server edit time. Existing notes remain explicitly unrecorded. */
export const migration037 = `
ALTER TABLE run_notes ADD COLUMN updated_at TEXT CHECK(updated_at IS NULL OR
 (typeof(updated_at)='text' AND length(updated_at) BETWEEN 20 AND 64));
PRAGMA user_version=37;
`;
