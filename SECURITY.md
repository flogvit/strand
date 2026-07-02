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
them verbatim).

The HTTP sync transport supports shared-secret peer auth: set
`STRAND_SYNC_TOKEN` (or pass `--token` to `strand-swarm serve`/`work`, or the
`token` option to `servePeer`/`gossipOnce`) and every request must carry
`Authorization: Bearer <token>`; anything else is rejected with 401. Without a
token the transport is open — acceptable on localhost and trusted LANs only.
Beyond that, always set a token, and front the port with TLS (a reverse proxy)
if the network is genuinely hostile; per-peer identities are out of scope.
Note the CRDT already makes malicious *state* survivable — junk still has to
pass the green-gate to matter — so the token primarily guards against
namespace exfiltration and junk-observation flooding.
