# Security

Strand is research software; still, if you find a security issue — e.g. in the
sync transport (`src/distributed/transport.ts`), the `foreign` escape hatch, or
the GhQueue/GitHub integration — please report it privately rather than opening
a public issue.

**Report to:** vhanssen@menneske.no

Include what you found, how to reproduce it, and what you believe the impact
is. You will get a response as soon as possible, and credit in the fix unless
you prefer otherwise.

Known, documented trust boundaries (not vulnerabilities): `foreign` bindings
are trusted by design (the checker takes them on faith and the backend emits
them verbatim), and the HTTP sync transport is unauthenticated — run it on
networks you trust.
