# Offline image upgrade

`index.ts` is the explicit host entry (`setup upgrade [prepare|status|activate|rollback]`).
One operation per process; services must be stopped. Normal replay never re-pins:
`src/selection.ts` reports `upgrade_required` when only image identities moved.

`apply.ts` prepares: both startup leases (`quiescence.ts`), named offline blockers
(Docker containers, metadata and Journal cold inspection for predecessor schemas; a pending
origin change, `origin_change`, read from `originDirectory`),
receipt `backing_up`, sealed copy (`backup.ts`), then recorded steps in `steps.ts`:
one atomic selector commit of new pins plus `upgradeFence`, Journal profile
approval, metadata migration, `awaiting_activation`. Until the selector commit the
root is untouched, so a resume retakes the backup.

`receipt.ts` owns the closed host receipt in the private `upgrade/` directory beside
the root; terminal receipts are archived under their operation directory.
`files.ts` owns private no-follow files, fsynced renames and the `upgradeNative`
fault seam used by tests. Activation clears the fence; rollback (before activation
only) restores the sealed copy beside the root and swaps it in with two renames.

The backend reads the fence through `app/src/bootstrap/upgrade-fence.ts`.
Contract: docs/system/contracts/upgrade.md.
Focused checks: `tools/install/test/upgrade-operation.test.ts`,
`app/test/bootstrap/upgrade-fence.test.ts`, `app/test/storage/upgrade-schema029.test.ts`.
