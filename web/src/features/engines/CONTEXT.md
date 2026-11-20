# Engines

Route `routes.engines` (`/engines`), Penpot "Engines" and "Engines / Unavailable".
Installed engines are `InstallationSettings.values.supportedProfiles`; k6 profiles
share one "k6 load tests" card and the default is `runDefaults.engineProfile`.
`getInstallationStatus` (035) adds image digest and verification per profile and
the agent state. `unreachable`, `unavailable` and `stale` mark the card Unavailable
and show the notice (minutes since `lastSeenAt` for stale) with a link to
installation status; `disabled` shows the notice without the Unavailable mark.
`status.ts` owns the status read (one read per mount, no polling) and is reused by
installation settings. `listEngines` says which engines are planned; `planned.tsx` holds
the board copy per id, whose bars are captioned as samples, not data. Per-engine run counts and the
board illustration are not built: no API reports the counts.
Check: vitest run web/src/features/engines.
