# Durable output retirement storage
Public index.ts owns immutable bounded retirement intent/preflight/open observations.
One validator derives original, exact closure/ACK, namespace/task snapshot and control
version1; preflight grants no write/native permission and begin revalidates atomically.
3072-byte request/4096-byte wrapped intent; fixed row metadata stays within C1 reserve.
Read checks scope without materializing Offer/result bodies; stored records match
canonical payload/indexed keys. No native drain, cleanup, ACK, purge or refunds here.
Pure deterministic SQLite JSON validators supplement raw guards, never query/reenter DB.
Owner docs/design/lld/producer-retirement.md; agent Journal017 reserved.
