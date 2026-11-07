# Engine staged input

This entry currently owns the pure secret-reference bridge. File loading is pending.
`prepareSecretReferences(validatedConfig)` maps locator to opaque runner reference,
supports env/mounted providers, preserves leading underscores/declared versions,
and rejects unsafe aliases or portable filename collisions before staging.
`matchSecretReferences` requires the exact declared set without extras/duplicates;
order is immaterial and versions are never invented. Neither function resolves,
hashes or logs secret values. Provider/version verification belongs to staging.
The full staged loader must still verify files, digests, scope and deadlines before
calling the one suite compiler. No execution or completeness claim is made here.
