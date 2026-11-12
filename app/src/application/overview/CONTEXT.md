# Workspace overview

getOverview validates a fixed scoped trusted-clock query and a <=32KiB response.
checkedOverviewQuery/checkedOverview are shared metadata-worker transfer guards.
No configuration, dispatch, mutation, engine or artifact effects. Counts represent
metadata state, not physical liveness. See docs/design/lld/workspace-overview.md.
