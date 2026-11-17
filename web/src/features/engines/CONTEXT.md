# Engines

Route `routes.engines` (`/engines`), Penpot "Engines" and "Engines / Unavailable".
Installed engines are `InstallationSettings.values.supportedProfiles`; the default
is `runDefaults.engineProfile`. `getInstallationStatus` (035) adds image digest and
verification per profile and the agent state. `unreachable`, `unavailable` and
`stale` show the Unavailable banner with a link to installation status; `disabled`
shows a neutral note. `status.ts` owns the status read (one read per mount, no
polling) and is reused by installation settings. Planned-engine cards and per-engine
run counts are not built: no API reports them, and nothing is fabricated.
Check: vitest run web/src/features/engines.
