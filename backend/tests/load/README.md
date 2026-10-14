# Load tests

Ramp-up scripts and their results, required by the subject to justify the server specs.
The decisions behind them are in ADR-021 (`docs/architecture-decisions.md`); the written
analysis goes in `docs/ramp-up-results.md`.

- The server under test runs **in a container with stated resources**:
  `make loadtest-up` (spec from `BACKEND_CPUS` / `BACKEND_MEMORY` in `.env`),
  `make loadtest-down` to stop it. It uses a fake catalog, so Deezer is never called.
- The harness (ours, TypeScript, run with `tsx`) simulates growing numbers of users voting,
  editing playlists and holding live sockets, and records latency, errors and correctness.
- These are NOT run by `make test`: they need the container and are slow.
