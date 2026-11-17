# Automatic administrator browser access

Status: accepted and locally implemented.

One installation has one trusted administrator. Requiring that user to find
startup logs, paste a token and restart the backend after expiry adds setup friction.
Use an automatic same-origin browser exchange when the frontend publishes only on
loopback. Keep the current exact Host/Origin, custom-header JSON exchange, CSRF,
HttpOnly/SameSite cookie and no-CORS boundaries. A GET never mints a credential.

Persist one private, versioned session through the existing metadata owner. Reopen
preserves only its remaining8h absolute lifetime; expiry can renew without token
handling. Logout durably revokes the old cookie before acknowledgement and stays
signed out until explicit reconnect/reload. Unknown credential writes reconcile
through their original CAS/value, without repeating user resource mutations.

Retain an explicit paired profile for developer/CI clients. Normal executable and
rewrite Compose configuration select automatic mode and print no bootstrap token.
One installation administrator can run this on a workstation or VPS using SSH
forwarding. Multi-user accounts and organisation roles require a separate IAM
design; they are not prerequisites for hosting an installation. The contract and remaining packaged
qualification are in [administrator sessions](../system/contracts/storage.md#administrator-session).
