# Installation status routes

registerInstallationStatusRoutes binds getInstallationStatus and getRunQueue behind the
composition-owned workspace visibility guard. The agent view is a synchronous in-memory
snapshot (null without an agent runtime); routes never issue agent I/O.
Focused checks: npx vitest run app/test/bootstrap/installation-status.test.ts
