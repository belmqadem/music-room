# Load tests

This folder will hold the **ramp-up scripts and their results**, required by the
subject to justify the server specs we choose.

- Scripts: simulate growing numbers of simultaneous users (voting, editing
  playlists, socket connections) and record latency / error rate.
- Results: raw outputs go here; the written analysis goes in
  `docs/ramp-up-results.md`.
- These are NOT run by `make test` (they need a running server and are slow).

TODO: choose a tool (e.g. k6 or autocannon) and record the decision in
`docs/architecture-decisions.md`. Third-party tools must be installed by the
Makefile, never committed.
