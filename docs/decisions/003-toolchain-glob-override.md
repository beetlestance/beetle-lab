# Temporary toolchain glob dependency override

Accepted: 2026-11-07. Owner: rewrite coordinator. Review at dependency upgrades.

The clean rewrite lockfile exposed minimatch's glob-amplification advisory
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
The affected ESLint/config-array/typescript-estree versions depend on minimatch 10;
the upstream fix is 11.0.1. Downgrading the entire toolchain to satisfy audit would
change unrelated behavior and does not reliably resolve all transitive consumers.

Pin 11.0.1 under the three exact consumer versions in root package overrides.
This crosses a major version: upstream 11 removes APIs and changes glob semantics.
Read-only inspection found these installed consumers use retained `Minimatch`
construction/`match` and named `minimatch()` calls. Node 24 satisfies its runtime
requirement. This inspection is a reason to test compatibility, not proof of it.

Verify discovered lint files, ignored/nested TS/TSX selection and the complete fast
gate after installation; retain negative architecture fixtures and the legacy API
regression. Record audit results separately from compatibility test results.

Removal condition: upgrade consumers to versions that directly accept a patched
minimatch range, remove overrides and rerun selection/gates. Do not broaden these
overrides globally or carry the exception invisibly into later dependency upgrades.

Sources: [advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249),
[upstream changelog](https://github.com/isaacs/minimatch/blob/v11.0.1/changelog.md).
