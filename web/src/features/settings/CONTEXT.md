# Settings

Penpot "Settings", "Settings / Installation", "Settings / Installation / Capacity",
"Settings / Workspace" and "Settings / Loading". Inputs: validated installation,
organization or workspace scope and the required ApiClient.
Rows (`model.ts`) show each value in a display unit (`units.ts`: min, GB, CPUs; exact
BigInt conversion, never truncated) with where it comes from: "Set here",
"Inherited from …". Scoped levels offer Inherit instead (explicit null) for values set
there; the installation has no inheritance and adds the administrator name (031),
shared pool and per-run ceilings, with host facts from `getInstallationStatus` (035).
Unsaved changes (`useSave.ts`) live in the query client under `settings-draft`, so a
level keeps its draft when left; the level tab shows the count. `patch.ts` turns the
draft into one PATCH: changed leaves for scoped levels, complete groups for the
installation. Out-of-range and malformed values block Save before transport.
Save sends one request ID; only an unknown outcome offers "Retry identical request";
editing starts a new save. A 409 opens "Changed elsewhere": refresh keeps the draft
and the next save uses the new version. Parent saves invalidate descendant settings.
Names come only from namespace data already cached; no read just for a label.
Not shown: Beetle version and upgrade check (no API field). Workspace retention
controls are in ../retention; Retire workspace is in ../namespace-deletion.
Check: vitest run web/src/app/settings*.test.tsx web/src/features/settings.
