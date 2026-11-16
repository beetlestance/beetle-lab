# Release approval

Publication stays manual on `rewrite/integration`. This does not authorise merging
to `develop` or `main`, promoting default image tags, or deleting older images.

Before publication is enabled, a maintainer must configure `beetle-release` with
at least one required reviewer and a selected deployment branch rule for exactly
`rewrite/integration` (branch, not tag). The read-only delivery authority job
refuses missing or broader policy before a publishing job can create an implicit
unprotected environment. Both source/image publication and final installer
publication reference that environment and need GitHub's approval gate.

For a sole maintainer, approving a manually dispatched run is allowed. The coding
agent must never approve its own deployment or bypass a review. Repository admins
retain GitHub's administrative capabilities; this is not a two-person guarantee.

Repository workflow defaults should be read-only, with Actions unable to approve
pull requests. Only the two publishing jobs request content/package writes as
needed; qualification jobs remain read-only. These repository settings need a
separate authorised change and are not created by pushing workflow files.

Environment approval does not replace exact-source qualification, vulnerability
and licence checks, source notices, digest preservation, or anonymous native
installation on both architectures. Existing authenticated local release handling
remains available; this change does not require creating another release token.

See [GitHub environment documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
