# Workspace overview

getOverview validates a fixed scoped trusted-clock query and a <=32 KiB response.
checkedOverviewQuery/checkedOverview are shared metadata-worker transfer guards.
No configuration, dispatch, mutation, engine or artifact effects. Counts represent
metadata state, not physical liveness. Hour buckets partition requested runs by their
current outcomes; category sums and known headers must agree. Integer milliseconds
keep boundary placement exact, including unrounded server clocks. See docs/system/contracts/web-ui.md.
