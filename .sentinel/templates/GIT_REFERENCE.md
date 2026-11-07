# Contribution workflow

Create feature branches from `develop` and open pull requests into `develop`.
The required checks are `ci/checks` and `ci/container`. Resolve review threads
before merging. No approval is required for this single-maintainer setup.

Squash feature PRs into `develop`. Promote `develop` to `main` through a PR
using rebase merge. Both branches prohibit deletion and force pushes.

Successful pushes publish images through GitHub Actions. `main` owns `latest`;
`develop` owns the development tag. Create `vX.Y.Z` release tags from tested
commits on `main` to publish versioned image tags.

See README.md for local validation and the git-sentinel policy workflow.
