# Upgrade

Settings › Installation › Upgrade (`index.tsx`, opened at `/settings?view=upgrade`) reads
`getUpgradeStatus` once per visit: release name or "development build", metadata schema,
open or fenced, the next-release-only rule, unfinished work and the backup's lower bound
against free space the agent reported (unknown free space never claims it fits).
"Check for upgrade…" explains that Beetle never looks online and names the host command.
`watch.tsx` wraps the ApiClient in App and flags the first `upgrade_pending` refusal;
`UpgradeBanner.tsx` in the shell then explains the pause and links here. Refused actions
show the upgrade message from `app/errors.ts`, which never treats it as an unknown outcome.
Host steps stay on the host: `docker compose run --rm setup upgrade prepare|status|activate|rollback`.
Check: vitest run web/src/features/upgrade.
