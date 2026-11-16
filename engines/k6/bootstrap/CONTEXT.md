# Trusted k6 image entrypoint
main owns one staged attempt, fixed roots/schema/version, signals and bounded
notification output. profile reads only the versioned baked image live marker;
absent disables advisory publication, exact1 enables, other values reject.
The agent installs the mailbox volume only from that same inspected image marker.
Suite/Offer/config fields cannot select it or mutate the runtime environment.
Dockerfile bakes marker only into the qualified new engine image.
Tests: engines/k6/test/bootstrap/profile.test.ts; native proof remains separate.
