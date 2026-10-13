# Architecture Decisions

Each decision must be defensible in detail at the defense. Copy the template for new ones.

## Template

```
### ADR-NNN: <title>
- Status: proposed | accepted | superseded by ADR-NNN
- Date: YYYY-MM-DD
- Deciders: <names>
- Context: what problem, what constraints?
- Options considered: A (pros/cons), B (pros/cons)
- Decision: what we chose
- Consequences: what gets easier, what gets harder, what we revisit
```

## Decisions

### ADR-001: REST for the request/response API

- Status: accepted (contract review by kaouthar pending)
- Date: 2026-10-09
- Deciders: belmqadem
- Context: the mobile app needs CRUD-style operations (accounts, rooms, suggestions, playlists). Real-time updates go over Socket.io regardless of this choice.
- Options considered:
  - REST: resource URLs + HTTP verbs and status codes. Documented with the OpenAPI/Swagger setup we already have; easy to test with curl/supertest. Cost: several round-trips for composite screens, some over/under-fetching.
  - GraphQL: one endpoint, client picks fields. Fewer round-trips, but a new server layer, per-field authorization that is easy to get wrong (graded), and it replaces our OpenAPI setup.
  - gRPC / tRPC: strong typing, but gRPC does not run well in React Native without a proxy, and tRPC bypasses the shared contract + OpenAPI document.
- Decision: REST under `/api/v1`, Socket.io for live events.
- Consequences: every route must be added to `config/swagger.ts`; composite screens may need purpose-built endpoints rather than client-side joins.

### ADR-002: JSON as the wire format

- Status: accepted
- Date: 2026-10-09
- Deciders: belmqadem
- Context: one format for every REST body and Socket.io payload.
- Options considered:
  - JSON: human-readable, native in TS on both sides, works with Swagger/curl/devtools. Larger payloads, no built-in schema (we validate with zod and the shared types).
  - MessagePack / Protobuf: smaller and faster, but binary (harder to debug), extra libraries on both sides, no Swagger support. Not justified before load tests show a need.
  - XML: verbose, nothing we need.
- Decision: JSON, UTF-8, camelCase keys.
- Consequences: revisit only if load tests show payload size or parsing is a bottleneck.

### ADR-003: Short-lived JWT access token + rotating refresh token

- Status: accepted
- Date: 2026-10-09
- Deciders: belmqadem
- Context: the app needs to authenticate REST calls and the Socket.io handshake, and we need revocation (logout, stolen token).
- Options considered:
  - Short access JWT + refresh token: stateless checks on most requests, revocable via the refresh token. More moving parts (expiry, rotation, reuse detection).
  - Opaque session tokens in Redis: instantly revocable and simple, but every request and handshake hits Redis, which becomes critical for auth.
  - Single long-lived JWT: easiest, but a stolen token works until expiry and cannot be revoked without a deny-list.
- Decision: access JWT (about 15 minutes) sent as `Authorization: Bearer`; refresh token is a random opaque value, stored only as a hash in Postgres, rotated on every use, with reuse detection (a reused refresh token revokes that whole token family).
- Consequences: security-critical code (token issue/verify/rotate, password hashing) needs the most tests, including denied cases. Concrete parameters are in ADR-006.

### ADR-004: Room access model: two flags + per-member roles

- Status: **superseded by ADR-005** (the subject defines licenses per feature, not roles per member)
- Date: 2026-10-09
- Deciders: belmqadem
- Context: the subject requires public/private visibility and open/restricted permissions; the README promises control over who votes, who edits, and who controls playback. One engine must serve both Track Vote and Playlist Editor.
- Options considered:
  - Two flags + per-member roles: `visibility` and `permission` on the room, members hold a role (owner, editor, voter, listener) that maps to a license (canVote, canEdit, canControlPlayback). More tables and rules to test.
  - Two flags + invite list only: smallest model, but cannot express "can vote but not edit" or delegating playback.
  - Full ACL per room and action: most flexible, but a large permission matrix that is easy to leave a hole in and hard to defend.
- Decision: two flags + per-member roles. The exact rules are in `docs/api-contract.md` ("Access rules").
- Consequences: all authorization goes through one function (room + user -> license), tested exhaustively.

### ADR-005: Two resources (Event, Playlist) with visibility, an invitation list and a per-feature license

- Status: accepted (supersedes ADR-004)
- Date: 2026-10-09
- Deciders: belmqadem
- Context: the subject defines Track Vote ("event") and Playlist Editor ("playlist") as separate services. Each is public by default; private means only invited users can find it. Track Vote's license is `everyone` (default), `invited_only`, or `location_time` (people at a place within a time window). Playlist Editor's license is `everyone` (default) or `invited_only`. Roles (owner/editor/voter/listener) are not in the subject.
- Options considered:
  - One generic "room" holding both features, with per-member roles (ADR-004): one table, but cannot express location+time, and the two features' defaults and licenses differ, so it would need special cases anyway.
  - Two resources sharing one access engine: `visibility` + one invitation list per resource + a license object per feature. Matches the subject one to one; each feature can be built and defended on its own.
  - A fully generic ACL: more flexibility than the subject asks for and a bigger surface to get wrong.
- Decision: Event and Playlist are separate resources. Each has `visibility` (public/private, default public), an owner, an invitation list, and a license (`voteLicense` for events, `editLicense` for playlists; default `everyone`). The owner always has full rights. The shared engine ("can this user see / act on this resource?") is one backend module used by both features. Invitations take effect immediately (no accept step).
- Consequences: the scaffold's `rooms` module becomes this shared access engine (renamed to `modules/access`: pure rules in `rules.ts`, loaders in `repository.ts`, HTTP errors in `guards.ts`). The location+time license adds a trust problem: coordinates come from the client and can be faked (see `docs/security.md`). A user's own `canVote`/`canEdit` shown in the app is a UI hint; the backend re-checks on every request.

### ADR-006: Token lifetimes and password hashing

- Status: accepted
- Date: 2026-10-09
- Deciders: belmqadem
- Context: concrete parameters for ADR-003.
- Decision:
  - Access token: JWT, **15 minutes**, signed **HS256** with a secret from `.env` (at least 32 characters, validated at startup), using the `jose` library. Verification pins the algorithm to HS256 (prevents algorithm-confusion attacks). Claims: `sub`, `iat`, `exp`. Asymmetric signing (RS256/EdDSA) is only needed if other services must verify tokens; here the backend is the only verifier.
  - Refresh token: **7 days**, 32 random bytes from `crypto.randomBytes`, stored only as a **SHA-256 hash** in Postgres (fast hash is fine for high-entropy random values). Rotated on every use (each rotation issues a new 7-day token, so 7 days of inactivity logs the user out). Reusing an already-rotated token revokes the whole family.
  - Mobile storage: refresh token in `expo-secure-store` (Keychain/Keystore); access token in memory only.
  - Passwords: **bcrypt, cost 12**, via a maintained library. bcrypt silently ignores bytes past 72, so passwords longer than 72 bytes are **rejected**, not truncated. Minimum length 8. The login response is identical for unknown email and wrong password, and login is rate limited.
- Alternatives: argon2id is OWASP's first choice and resists GPU cracking better; bcrypt (cost 10 or more) is still acceptable and is what the team chose. Revisit if time allows.
- Consequences: a native bcrypt build may need install-script approval in npm; the pure-JS alternative is slower. Decide when implementing.

### ADR-007: OAuth with Google and Facebook, plus account linking

- Status: accepted
- Date: 2026-10-09
- Deciders: belmqadem
- Context: the subject requires registration by email/password **or** Facebook/Google, and the ability to **link** a social account to an existing account afterwards.
- Options considered:
  - A. The app obtains a credential from the provider (Google ID token / Facebook access token) and sends it to the backend, which verifies it with the provider (signature and audience for Google; Graph API token inspection for Facebook). Light on the backend; no provider secret on the phone.
  - B. The app sends an authorization code + PKCE verifier and the backend exchanges it with the provider using a client secret. Keeps provider tokens server-side, but needs redirect handling and secrets for both providers.
- Decision: A. The backend never trusts a client's claim of identity; it only trusts what the provider confirms. **No automatic linking by email**: if an OAuth login's email matches an existing account, the backend refuses (`EMAIL_TAKEN`) and the user must log in and link from settings, because an unverified provider email could otherwise take over someone's account. A user must always keep at least one login method (unlinking the last one is refused).
- Consequences: provider app ids/secrets go in `.env` (never the repo). Facebook may not return an email, so `User.email` is nullable.

### ADR-008: Concurrency for votes

- Status: accepted (to be validated by concurrent-vote tests and the load test)
- Date: 2026-10-09
- Deciders: belmqadem
- Context: many users vote at the same time, for the same track or for different tracks, and two people may suggest the same track at once.
- Options considered:
  - Read count, add one, write back in application code: loses votes under concurrency (lost update).
  - Postgres as the source of truth: a `votes` table with primary key `(track, user)`, so a duplicate vote is a no-op; the counter is incremented in the same transaction only if the insert actually happened, using an atomic `UPDATE ... SET count = count + 1`. Ranking is **derived at read time** (`ORDER BY votes DESC, suggested_at ASC, id`), never stored as positions.
  - Redis sorted set (`ZINCRBY`) as the ranking: very fast, but two stores to keep consistent.
- Decision: the Postgres approach. Voting is idempotent (`PUT` the vote; repeating it changes nothing). Votes on different tracks touch different rows and do not interact; votes on the same track serialize on that row's lock for a few milliseconds. Because no positions are stored, there is no "reordering" race. The tie-break (older suggestion first) makes the order deterministic. Suggesting a track already in the queue hits a unique index `(event, provider track)` while queued: one request wins, the other gets `409 TRACK_ALREADY_QUEUED` containing the existing track, so the app can vote for it instead. A vote on a track that just started playing or was removed gets `409 TRACK_NOT_VOTABLE`.
- Live updates: after commit, the server broadcasts the full ordered queue with absolute counts (not deltas). Applying the same update twice, or out of order, converges.
- Consequences: simple enough to defend and to test. If load tests show contention on very hot tracks, Redis counters can be added behind the same API.

### ADR-009: Concurrency for playlist edits

- Status: accepted (to be validated by concurrent-edit tests and the load test)
- Date: 2026-10-09
- Deciders: belmqadem
- Context: several users add, remove and move tracks in the same playlist at once, including moving the same track.
- Options considered:
  - Absolute integer indexes sent by the client ("move to position 3"): wrong as soon as another edit shifts the list.
  - Optimistic locking with a client-sent base version (reject stale edits with 409): always correct, but frequent conflicts for a real-time editor.
  - Operational transform / CRDT: handles everything, but very complex to build and to defend.
  - Operations expressed by **intent** ("move track X after track Y"), applied on the server inside a transaction that locks the playlist row (`SELECT ... FOR UPDATE`), with a server-assigned `version`.
- Decision: the last option. Edits to one playlist are serialized by the row lock, so each is applied to the latest state; anchoring to track ids (not indexes) keeps edits meaningful after other edits. Moving **different** tracks: both succeed, in arrival order. Moving the **same** track: both succeed in arrival order, the last one wins, and everyone converges because the new state is broadcast. If a referenced track is gone (removed meanwhile), the edit gets `409 ANCHOR_NOT_FOUND` and the app refreshes. Removing an already-removed track is a no-op. The same song may appear twice; each entry has its own id. Each applied edit increments `version`; the response and the broadcast carry it, and a client ignores any update with a version at or below the one it has, and refetches if it sees a gap.
- Live updates: after commit, the server broadcasts the full ordered track list with the new version.
- Consequences: positions are rewritten on each move (fine for lists of a few hundred tracks; load tests must confirm). Only one edit per playlist runs at a time.

### ADR-010: Strict reuse detection for refresh tokens

- Status: accepted
- Date: 2026-10-10
- Deciders: belmqadem
- Context: refresh tokens rotate (ADR-003, ADR-006). A token that is presented after it was already exchanged is either a thief replaying a stolen token or the real client retrying after a lost response.
- Options considered:
  - Strict: any reuse revokes the whole session (family). Simplest and safest; a retried refresh logs the user out.
  - Short grace window: a second use within a few seconds returns the same result and does not revoke. Friendlier on flaky mobile networks, but more code and state, and a thief acting inside the window goes undetected.
- Decision: strict. Consuming a token is a single atomic SQL statement (`UPDATE ... WHERE used_at IS NULL ...`), so of several simultaneous requests with the same token exactly one succeeds; the others are treated as reuse. The revoke is committed before the error is returned (an error thrown inside the transaction would roll the revoke back). Every failure returns the same `INVALID_REFRESH_TOKEN`; reuse is logged as a warning with user and session ids, never the token.
- Consequences: the mobile app must never retry a refresh with the same token; on failure it logs in again. If this proves painful in practice, the grace-window option can replace it (document the change here).

#

### ADR-011: How the backend verifies Google and Facebook credentials

- Status: accepted
- Date: 2026-10-11
- Deciders: belmqadem
- Context: ADR-007 says the backend verifies the provider credential itself. This ADR picks how.
- Options considered:
  - Google: (a) verify the ID token with `jose` against Google's public keys (JWKS), checking signature, issuer, audience and expiry; (b) the official `google-auth-library`; (c) call Google's `tokeninfo` endpoint on every login.
  - Facebook: (a) Graph API `debug_token` with the app access token (`appId|appSecret`), then `/me`; (b) Limited Login JWT, verified like Google's, which exists only on iOS.
- Decision: Google (a): no new dependency, one JWKS fetch cached in memory, and every step can be explained. The accepted audiences are a list in `GOOGLE_CLIENT_IDS` (iOS, Android and Web client ids differ). Facebook (a): `debug_token` must say `is_valid`, with our `app_id`, then `/me?fields=id,name` gives the user id and name. Both verifiers sit behind a small `ProviderVerifier` interface, so tests use a fake and CI never calls Google or Facebook.
- Consequences: Facebook costs two network calls per login and needs `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` in `.env` (never the repo; the secret never goes to the phone). A provider outage is `502 PROVIDER_UNAVAILABLE`, not a login failure the user caused. The Facebook email is not used, so Facebook accounts are stored without email, which avoids trusting an unverified address.

### ADR-012: Web client: CORS allow-list and refresh-token storage

- Status: accepted
- Date: 2026-10-11
- Deciders: belmqadem
- Context: the app also runs in a browser (Expo web). Browsers enforce CORS and have no secure storage like the phone keychain, so two questions arise: which sites may call the API, and where the web client keeps its refresh token.
- Options considered:
  - CORS: an explicit allow-list of origins (`ALLOWED_ORIGINS`), reflecting any origin, or `*`. Reflecting any origin or `*` lets any website call the API from a visitor's browser, so it is rejected.
  - Refresh token on web: (A) browser storage, sent in the request body like on mobile; (B) an httpOnly cookie, which needs CSRF protection, credentialed CORS and a second code path; (C) memory only, which logs the user out on every reload.
- Decision: an exact-match origin allow-list, empty by default, used for both REST and Socket.io; credentials stay disabled. The refresh token on web is option A: the same contract as mobile, no server change. The cost is that a script injected into the web page (XSS) could read it. This is limited by refresh rotation with reuse detection (ADR-010) and short access tokens, and must be reduced by the web build sending a strict Content-Security-Policy and never rendering untrusted HTML. Because rotation is strict, the web client must make sure only one tab refreshes at a time (for example with the Web Locks API), otherwise two tabs presenting the same token revoke the session.
- Consequences: CORS is not an authorization control (only browsers apply it; the token still decides who the caller is). Native apps are unaffected. Socket.io's origin list only covers long-polling requests; WebSockets are not subject to CORS in browsers, which is safe because the handshake uses a token in its payload, not a cookie. If XSS exposure turns out to be unacceptable, option B can be added later without changing mobile.

### ADR-013: Data model for events, playlists and invitations; finding users

- Status: accepted
- Date: 2026-10-11
- Deciders: belmqadem
- Context: ADR-005 fixed the rules (visibility, invitation list, per-feature license). This ADR fixes how they are stored and how an owner finds someone to invite.
- Options considered:
  - Tables: (a) `events`, `playlists`, `event_invitations`, `playlist_invitations`; (b) a shared base table for the common columns plus an invitations table; (c) one polymorphic invitations table without a foreign key.
  - Event vote license: (a) real columns with CHECK constraints; (b) one JSONB column validated in the app.
  - Finding users: search by display name, invite by exact email, or postpone.
- Decision: (a) separate tables with real foreign keys everywhere (deleting a user or a resource deletes the dependent rows). The common shape is written twice, which is accepted for simplicity, and the shared rules live in one access-engine module in code instead. The vote license is stored as columns (`vote_license` plus `latitude`, `longitude`, `radius_meters`, `starts_at`, `ends_at`) and the database itself refuses an inconsistent license: all five location fields are present exactly when the license is `location_time`, coordinates and radius are in range, and the window starts before it ends. The invitation primary key `(resource, user)` is the "already invited" rule. Users are found by a case-insensitive display-name prefix search that returns only `{ id, displayName }`, at least 3 characters, rate limited.
- Consequences: a small duplication between events and playlists, balanced by simple SQL and foreign keys. Changing the license shape means a migration, not just a code change. Display names are not unique, so results can look alike (the id is the identity). The search lets any signed-in user list display names by prefix: that is why it never returns emails, is limited to 3+ characters and is rate limited. The owner cannot be invited to their own resource; that rule lives in the service, not the schema.

### ADR-014: How the shared access engine decides, and the location + time rule

- Status: accepted
- Date: 2026-10-12
- Deciders: belmqadem
- Context: Track Vote and Playlist Editor must apply the same visibility and license rules, and the rules are the graded core, so they must be easy to test and to explain. The `location_time` license needs a precise meaning at its edges.
- Options considered:
  - Structure: rules written inside each feature's service, one shared module of pure functions, or SQL-only rules.
  - GPS accuracy: reject a position worse than a fixed limit; require the whole accuracy circle inside the radius; or ignore accuracy.
  - Edges: fully inclusive time window, or start inclusive and end exclusive.
- Decision: one module, `modules/access`. `rules.ts` holds pure functions (no database, no clock, no HTTP) taking plain facts and returning a decision, so every combination of visibility, license, role, time and position is tested in a table. `repository.ts` loads the resource and "is this user invited?" in one query. `guards.ts` turns a refusal into the contract's HTTP error. Services must call a guard before doing any work.
  - Order of questions: view (else `404`, identical to a missing resource), then act (`403 NOT_INVITED`, or the location errors), then manage (`403 FORBIDDEN`, owner only). The owner may always do all three, including on `location_time` events.
  - For `location_time` the server clock is checked first, then the position. Being invited does NOT skip the place and time rule. A position with no accuracy, or an accuracy worse than 100 m, is `400 LOCATION_REQUIRED`; the distance is computed by the server (haversine) and `<= radius` is inside. The time window is `[startsAt, endsAt)`: open at the start instant, closed at the end instant, so back-to-back windows never overlap.
  - Fail closed: an unknown license, or a `location_time` row with missing fields, throws (a 500) instead of allowing.
- Consequences: the pure rules are cheap to test exhaustively, and a bug can only be in one place. The list queries (`GET /events`, `/playlists`) repeat "public, mine or invited" in SQL, so they must be tested against `canView` to keep the two from drifting. The accuracy limit is a trade-off: it blocks coarse network-based fixes, but a real user with a poor GPS signal indoors may be refused. It does not stop a determined user from faking coordinates (see `docs/security.md`).

### ADR-015: Music catalog: Deezer's public API, with a stored copy of each track

- Status: accepted
- Date: 2026-10-12
- Deciders: belmqadem
- Context: the contract says the client sends only a track id and the backend resolves title, artist, duration and cover. We need a provider, and the app needs a way to find tracks to suggest.
- Options considered: Deezer's public API, the iTunes Search API, or a catalog we seed in our own database. Spotify was not considered: it needs a client secret and its playback needs Premium, which does not fit a school demo.
- Decision: Deezer. It needs no key or secret, and a track lookup and a search both return everything `Track` needs (checked by calling it). It sits behind a small `CatalogProvider` interface, like the OAuth verifiers, with a fake in the tests so CI never calls it. The backend exposes `GET /tracks/search` (a thin, rate-limited proxy) so the app talks to one server only. When a track is suggested we look it up once and **store a copy** of its fields in our database.
- Consequences: the queue keeps working if Deezer is down or changes a title. Deezer's preview links are signed and expire, so we do not store or return them and playback is the app's concern (an open question for the mobile side). A catalog outage affects only search and new suggestions (`502 PROVIDER_UNAVAILABLE`). Metadata is third-party text and image URLs: never rendered as HTML, and cover URLs should be restricted to Deezer's image host (recorded in `docs/security.md`). Deezer's terms of use must be checked before any public release.

### ADR-016: Queue states, advancing, and a queue version

- Status: accepted for the states and advancing; the `version` is **proposed** until the load test
- Date: 2026-10-12
- Deciders: belmqadem
- Context: the contract has `queued`, `playing` and `played` but nothing moves a track between them, and the real-time snapshot of the queue had no way to tell a late snapshot from a fresh one.
- Options considered for advancing: the owner advances it; the server advances it on a timer from each song's length; or there is no playing state. For the snapshot order: a per-event version counter, server timestamps, or a global sequence.
- Decision: the owner advances the queue with `POST /events/{id}/queue/advance`. The server chooses the next track itself (most votes, oldest suggestion on ties), so a client cannot pick one. The request names the track the app believes is playing (`currentTrackId`); if that is no longer true the answer is `409 QUEUE_CHANGED` and nothing moves, which makes a double tap harmless instead of skipping a song. The database guarantees at most one `playing` track per event (a partial unique index). A `playing` or `played` track cannot be voted for. Every change to the queue also increases a per-event `version` stored on the event row, and clients ignore any snapshot that is not newer than the one they hold.
- Why not the alternatives: a timer needs a scheduler that survives restarts and several server processes, plus pause and skip handling; no playing state would let votes reorder a song that is already playing. Timestamps cannot order snapshots reliably across processes, and a global sequence value can be taken in a different order than transactions commit, so a fresher snapshot could carry a smaller number.
- Consequences: the version is a counter on the event row, so every suggestion, vote and advance of ONE event takes that row's lock briefly. This slightly amends ADR-008, which said votes on different tracks never interact: they now queue for a few milliseconds on their event. Events are independent of each other, so it only limits one very busy event. The load test must measure it; if it is a problem the version can be taken only when a snapshot is built. The owner's device is the one expected to call advance; if it is offline the queue simply stays where it is.

### ADR-017: Run transactions again when Postgres picks them as a deadlock victim

- Status: accepted
- Date: 2026-10-12
- Deciders: belmqadem
- Context: the concurrency tests failed now and then. Postgres' own log showed deadlocks in the refresh-token path: when several requests replay one used token, each revokes the same family of rows while the others lock them too, in a different order. Postgres cancels one transaction on purpose, and that request got a `500` instead of `401 INVALID_REFRESH_TOKEN`. It only appeared under load (125 isolated rounds never showed it), and the same pattern can occur anywhere two transactions touch several shared rows.
- Options considered: lock the rows in a fixed order everywhere; move "revoked" into a single row per session so revoking locks one row; or retry the transaction when Postgres reports a deadlock. Retrying is what the Postgres manual recommends: nothing was wrong with the request, so running it again is safe.
- Decision: `withTransaction` runs the whole transaction again when Postgres reports a deadlock (`40P01`) or a serialization failure (`40001`), up to 3 attempts, after a short random pause. Nothing else is retried. The work inside a transaction must therefore touch only the database, because it may run more than once. Logout now goes through it too. A test creates a real deadlock on demand and checks that both transactions end up committed.
- Consequences: one fix for every transaction in the app, present and future (votes, advance, playlist edits). A retried refresh re-reads the token, sees it is used, revokes the family and answers 401 as it should. The deadlocks still happen inside Postgres (its counter keeps rising); they are now invisible to the client. A cheaper cure, ordering the locks, would shrink their number but could not guarantee zero, so it is not a substitute. The same load test that measures the queue version (ADR-016) will show if retries become frequent.

### ADR-018: Changing a queue: lock the event first, read fresh, check twice

- Status: accepted
- Date: 2026-10-13
- Deciders: belmqadem
- Context: suggesting, voting, withdrawing (and soon advancing) all change one event's queue, while the owner can change the event's license, visibility and invitations at any moment. The permission must be judged on the data as it is when the change happens, and these requests must not deadlock each other.
- Options considered: rely on the unique keys and atomic counters alone; take row locks in whatever order the code reaches them; or one fixed recipe for every queue change.
- Decision: one recipe. (1) A cheap permission check with no lock, so a forbidden user is refused without waiting for the lock and without making us call the catalog. (2) One transaction that first locks the event row (`FOR NO KEY UPDATE`), then reads the facts, checks the permission again, and only then touches track and vote rows, always in the order event, then track, then vote. (3) The lock is its own statement and the facts are read by the NEXT statement: when a statement waits for a row lock, Postgres re-reads only that row, so a single `SELECT ... FOR UPDATE` would keep an "is this user invited?" answer from before the wait (found by a test: a removed invitation still counted). (4) The version is raised only when something really changed. The catalog is called after the cheap check and outside the transaction.
- Consequences: the counters stay exact even without the lock, because the vote's primary key and the atomic `vote_count + 1` already guarantee it (ADR-008); the lock is what makes the permission decision fresh and the order of locks fixed. Requests for one event run one after the other, a few milliseconds each (see ADR-016; the load test measures it). A request can wait on the lock without a time limit if some transaction is stuck; a `lock_timeout` is an open item. Invitation changes do not take this lock, so an invitation removed while a vote is already running may still let that vote through: it is ordered just before the removal.

## Still to decide (record each as an ADR)

TODO:

- Location+time license: radius limits, accuracy rules, recurring vs one-off window
- Load-test tool
- Scaffold choices worth defending: no npm workspaces (shared types are type-only via a path alias), node-pg-migrate with a raw `pg` driver (no ORM), Vitest + supertest, pino logger, zod env validation, hand-written OpenAPI, zero-dependency commit-msg hook
