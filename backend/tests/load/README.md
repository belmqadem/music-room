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

## Running the ramp-up

```
make db-up && make migrate
make loadtest-up          # the limited backend container (BACKEND_CPUS / BACKEND_MEMORY in .env)
make loadtest             # the ramp
make loadtest-down
```

What `ramp-up.ts` simulates: users sit in **rooms of 50**. Each room has one event (20 tracks) and one
playlist. Every user holds a Socket.io connection subscribed to both and, every 3 to 9 seconds
(average 6), does one of: vote or withdraw a vote (60%), read the queue (10%), read the playlist
(10%), add / move / remove a playlist entry (20%). Every user has its own `X-Forwarded-For` address,
so the rate limits stay on.

Per step it reports, for each operation, count and p50 / p95 / p99 / max in milliseconds, errors, and
**conflicts** (a 404 / 409 on a playlist move or add after someone else changed the list: a legitimate
answer, not a failure). It also measures how long a change takes to reach ANOTHER user's socket
(`broadcast-vote`, `broadcast-playlist`): in each room one probe user changes something only it
touches, and a different user's socket must show it.

**Correctness is checked at the end of every step** with all users paused: each track's vote count
must equal the number of users who voted for it, and every socket's latest snapshot must equal what
the server returns. A step fails on more than 5% errors, a vote p95 above 2 s, or any correctness
failure.

Settings (environment variables): `LOAD_STEPS` (default `50,100,200,400,600,800,1000`),
`LOAD_HOLD_SECONDS` (45), `LOAD_ROOM_SIZE` (50), `LOAD_THINK_MS` (6000), `LOAD_STOP_ON_LIMIT`
(`0` to keep going after a failed step), `LOAD_OUT` (a file for the raw results as JSON).
The harness reports its own event-loop delay and CPU: if those are high, the numbers measure the
laptop, not the server. Users it creates are named `loadtest-N` and are deleted at the end.
