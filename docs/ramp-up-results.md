# Ramp-up (Load Test) Results

Run on 2026-10-15. The decisions behind the method are in ADR-021; how to run it is in `backend/tests/load/README.md`
(`make loadtest-up`, `make loadtest`).

## Method

- **Tool**: our own harness (`backend/tests/load/ramp-up.ts`, Node + `socket.io-client`). It can check things a generic
  tool cannot: that a change reaches **another user's socket**, and that the final result is **correct**.
- **Users and rooms**: users sit in rooms of 50. Each room has one event (20 tracks) and one playlist. Every user holds a
  Socket.io connection subscribed to both. Users are added in steps and stay connected; each step is held for 45 s.
- **What a user does**: every 3 to 9 s (average 6 s) one action: vote or withdraw a vote (60%), read the queue (10%),
  read the playlist (10%), add / move / remove a playlist entry (20%). This is a busy room: a real listener votes far
  less often than once every 6 s.
- **Rate limits stay on**: every user has its own `X-Forwarded-For` address (`TRUST_PROXY=1`). No request was refused by a
  limiter.
- **Correctness**, checked after every step with all users paused: each track's vote count equals the number of users who
  voted for it (the harness keeps its own ledger), and every socket's latest snapshot equals what the server returns
  (same version, same order, same counts). A socket the server closed counts as a failure.
- **Propagation delay** (`broadcast-vote`, `broadcast-playlist`): in each room one probe user changes something only it
  touches, and the time until a different user's socket shows it is measured (request sent to snapshot seen: it includes
  the request itself).
- A step **fails** on more than 5% errors, a vote p95 above 2 s, a dropped socket or any correctness failure.

## Environment

| Part         | Value                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Server       | the backend in a Docker container (compiled JavaScript, `NODE_ENV=test`, fake catalog), **1 CPU / 512 MB** (and 0.5 CPU / 256 MB below) |
| Postgres     | the project's Docker Postgres, default configuration, same Docker VM                                                                    |
| Redis        | the project's Docker Redis (rate-limit counters)                                                                                        |
| Docker VM    | 4 CPUs, 8 GB, shared by the container, Postgres and Redis                                                                               |
| Load machine | the developer's laptop; the harness runs on the same machine as Docker                                                                  |

## Results

Server CPU is `docker stats` as a percentage of one core, a single sample in the middle of the hold (the 0.5 CPU
container is capped at 50%). Times are milliseconds. "Errors" are failed requests; there were none except where noted.
Every step below also had **0 dropped sockets, 0 vote-count mismatches and 0 sockets out of sync**.

### 1 CPU / 512 MB

| Users | Requests/s | Vote p50 / p95 / p99 | Vote reaches another socket p50 / p95 / p99 | Server CPU | Server memory |
| ----: | ---------: | -------------------- | ------------------------------------------- | ---------: | ------------: |
|    50 |         10 | 9 / 17 / 34          | 10 / 14 / 14                                |       4.5% |        83 MiB |
|   100 |         19 | 7 / 16 / 20          | 9 / 15 / 25                                 |       6.5% |        84 MiB |
|   200 |         37 | 6 / 16 / 92          | 8 / 24 / 54                                 |       7.6% |        84 MiB |
|   400 |         75 | 5 / 14 / 26          | 8 / 22 / 259                                |      18.7% |        85 MiB |
|   600 |        113 | 5 / 16 / 55          | 7 / 52 / 105                                |        31% |        87 MiB |
|   800 |        151 | 5 / 30 / 99          | 8 / 54 / 96                                 |      33.5% |        90 MiB |
|  1000 |        186 | 7 / 77 / 173         | 12 / 136 / 229                              |      53.5% |        91 MiB |
|  1500 |        281 | 6 / 51 / 124         | 10 / 81 / 189                               |      82.3% |       104 MiB |
|  2000 |        367 | 73 / 200 / 268       | 94 / 239 / 362                              |       103% |       119 MiB |
|  3000 |        485 | 654 / 884 / 977      | 793 / 1102 / 1189                           |      97.1% |       155 MiB |

The first seven rows are one run (50 to 1000); 1500 to 3000 are a second run on the same container. The playlist
broadcast is slightly slower than the vote broadcast (at 1000 users: p95 164 ms, p99 280 ms). At 3000 users there was 1
error out of 21,844 requests (a playlist change not seen by the observer within 10 s).

### 0.5 CPU / 256 MB

| Users | Requests/s | Vote p50 / p95 / p99 | Vote reaches another socket p50 / p95 / p99 | Server CPU (cap 50%) | Server memory |
| ----: | ---------: | -------------------- | ------------------------------------------- | -------------------: | ------------: |
|   250 |         47 | 6 / 13 / 44          | 8 / 64 / 77                                 |                14.4% |        58 MiB |
|   500 |         93 | 5 / 27 / 88          | 7 / 44 / 102                                |                22.8% |        65 MiB |
|   750 |        140 | 5 / 76 / 136         | 9 / 113 / 186                               |                  43% |        78 MiB |
|  1000 |        183 | 47 / 220 / 372       | 65 / 210 / 293                              |                49.9% |        91 MiB |
|  1500 |        248 | 520 / 781 / 852      | 633 / 899 / 1014                            |                49.7% |       109 MiB |

### Harness limits

The harness used 53% of a core at 1000 users, 88% at 2000 and 91% at 3000. Its event-loop delay stayed under 20 ms, but
at 3000 users the load generator is close to its own limit, so the 3000-user row is indicative only.

## Conclusion and justified server specs

- **Design target: 1000 simultaneous users** (ADR-021). On **1 CPU / 512 MB** the server carries 1000 users with no
  error, correct results, vote p95 of 77 ms, and a vote visible on another user's phone in about 136 ms (p95). CPU is
  about half used, so there is room for bursts.
- **CPU is the limit, not memory.** Memory never passed 155 MiB even at 3000 users, so **512 MB is generous** and 256 MB is
  enough for this load. The Node process is single-threaded: the server saturates its one core at about **2000 users**
  (CPU 103%, latency climbing), and at 3000 users it is degraded (vote p50 above 600 ms) though still correct.
- **Why not smaller**: with 0.5 CPU the server is comfortable up to 750 users but is saturated at 1000 (vote p50 47 ms,
  p95 220 ms) and clearly overloaded at 1500 (p50 above 500 ms). It would meet the target with no margin.
- **Recommended specification: 1 CPU and 512 MB for 1000 users**, which leaves about 2x headroom before saturation. Beyond
  about 2000 users, add server processes behind a load balancer rather than a bigger machine: rate-limit counters already
  live in Redis, but real-time broadcasts would then need the Socket.io Redis adapter, which is not set up yet.
- **Correctness held at every load, including overload**: no lost or double-counted votes and no socket left behind, in
  every step of every run. Overload showed up as latency, not as wrong results.

## Limits of these measurements

- One run per configuration; the CPU figure is one sample per step, not an average. Treat differences of a few
  percent as noise.
- Laptop, Docker VM shared with Postgres and Redis, load generator on the same machine: a dedicated server would perform
  differently.
- The catalog is fake, so Deezer latency is not included. Passwords are not hashed during the test (users and tokens are
  created directly), so login and registration cost is not measured here (bcrypt is a deliberate cost, ADR-006).
- Rooms hold 50 users each. A single very large room (one event with all 1000 users, each vote broadcast to all) is a
  different and heavier case, not measured here.
- A first full run was discarded: on the 600-user step the harness lost its connections (the laptop's wake or sleep
  state is the likely cause, the server did not restart) and the check then skipped the dead sockets. The check now counts
  a closed socket as a failure, and the runs above were made with sleep prevented.
