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
  - Passwords: **bcrypt, cost 12**, via a maintained library. bcrypt silently ignores bytes past 72, so passwords longer than 72 bytes are **rejected**, not truncated. Minimum length 8. On register only, a password must also contain a lowercase letter, an uppercase letter, a digit and a symbol (classic complexity rules, chosen over a length-plus-blocklist policy such as NIST 800-63B because they are simple to state, test and show in the mobile form; the weakness is that they allow patterns like `Password1!`, and a common-password blocklist can be added later). Login does not apply them, so older accounts are never locked out. The login response is identical for unknown email and wrong password, and login is rate limited.
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
- Consequences: the version is a counter on the event row, so every suggestion, vote and advance of ONE event takes that row's lock briefly. This slightly amends ADR-008, which said votes on different tracks never interact: they now queue for a few milliseconds on their event. Events are independent of each other, so it only limits one very busy event. The load test must measure it; if it is a problem the version can be taken only when a snapshot is built. The owner's device is the one expected to call advance; if it is offline the queue simply stays where it is. Implementation detail worth defending: a track's `started_at` and `ended_at` are stamped with `clock_timestamp()`, not `now()`. `now()` is the moment the transaction began, and a request that began waiting for the event's lock early can run after one that began later; it would stamp an end before the start the other request just wrote, and the lifecycle constraint would turn that into an error (a test forces this order).

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

### ADR-019: Real-time queue updates: one shared snapshot, sent after commit, coalesced

- Status: accepted
- Date: 2026-10-13
- Deciders: belmqadem
- Context: everyone watching an event should see the queue change at once. A queue snapshot contains `votedByMe`, which differs for every listener, and a busy event can change many times a second.
- Options considered: (a) one shared snapshot without `votedByMe`, which the app merges with its own votes; (b) a personal snapshot per listener; (c) a bare "changed, version N" ping that makes every app call the API.
- Decision: (a). The server builds ONE payload and Socket.io fans it out to the room. The acknowledgement of `subscribe` is personal (it carries `votedByMe`), so the app starts from the truth and then merges. Updates are sent after the database commit, never inside the transaction, and a failed broadcast is logged but never fails the request that caused it. Broadcasts are coalesced per event: while one snapshot is being built, further changes only mark the event "dirty" and one more snapshot follows, so a burst of 30 votes costs a few reads instead of 30. A subscriber is checked twice (before joining and after, the second time authoritative) so a change of access in between cannot leave someone in the room. When access is lost (invitation removed, event made private or deleted) the server re-checks everybody in that event's room with one query and removes those who may no longer see it. Subscriptions per socket are limited to 25.
- Consequences: per-change cost grows slowly with the number of listeners (one read, one serialization). The price is that a vote made on the user's OTHER device is not reflected in their `votedByMe` until they read again. Reaching an event's room needs a single Socket.io process: with several processes, the Redis adapter (Redis is already running) is the upgrade path, and `fetchSockets` and `socketsLeave` already work through it. Deltas instead of full snapshots remain an option if the load test shows the payload size matters. Playlists use the same hub (one implementation for both kinds; they differ only in the tables that say who may see the thing and in where the snapshot is read from). Their rooms are named `playlist:<id>`, apart from `event:<id>`, so an id of one kind can never reach the subscribers of the other, and the 25-subscription limit counts both kinds together.

### ADR-020: Playlist order stored as dense positions; edits follow the same recipe as the queue

- Status: accepted
- Date: 2026-10-14
- Deciders: belmqadem
- Context: ADR-009 chose edits by intent under a per-playlist lock, with positions rewritten on each move. This ADR fixes how the order is stored and how the rest of ADR-018 applies.
- Options considered for the order: (a) a dense integer `position` (0, 1, 2, ...) rewritten as entries are inserted, removed or moved; (b) fractional or lexicographic keys, so an edit writes one row but keys must be rebalanced now and then; (c) a linked list of "next" pointers, where reading the order needs a recursive query.
- Decision: (a). Order is one integer column, the list is read with a plain `ORDER BY position`, and the invariant is simple enough to state and test: positions are exactly 0 to n-1 with no gap. The unique constraint on `(playlist, position)` is **deferrable** (checked at commit), so one `UPDATE position = position + 1` can shift a block of rows without tripping over itself, and the database still refuses to commit any state with two entries in one place. A playlist holds at most 500 entries, so the worst edit rewrites 500 small rows. An edit follows ADR-018: a cheap permission check with no lock; one transaction that locks the playlist row first (as its own statement), reads fresh, checks again and then rewrites the entries; the catalog is called before the transaction, never inside it; the `version` rises only when the list really changed; the broadcast happens after the commit.
- Why not the others: (b) writes less but needs rebalancing code and keys that are hard to read in a test or at a defense; (c) makes the simple read, the 'move after' lookup and the invariant all harder. Both only pay off for lists far bigger than the limit we set.
- Consequences: every insert, move or removal costs up to n row updates inside the lock; the load test must confirm this at 500 entries with many editors. Two entries moved at once are applied one after the other and the last wins, exactly as ADR-009 says. Positions are an internal detail and are never sent to clients (they get the ordered list).

### ADR-021: How the load tests are run: a limited container, per-user addresses, a fake catalog, our own harness

- Status: accepted
- Date: 2026-10-14
- Deciders: belmqadem
- Context: the subject asks for load-test results that justify the server specs we choose. A number such as "carries 1,000 users" means nothing unless the server's resources are stated and the test measures our code, not the network or a third party.
- Options considered: the tool (our own Node harness, Artillery, or k6 in Docker); where the server runs (on the laptop with no limit, or in a container with fixed CPU and memory); how a single load generator avoids our per-IP rate limits (switch the limits off, or make every virtual user look like a different client).
- Decision:
  - Tool: **our own Node harness** (built on `socket.io-client`, already a dependency). It can measure what a generic tool cannot: the time from "a vote was answered" to "every listener received the snapshot", and whether the result is still correct (exact vote counts, versions that only grow).
  - Server: the backend runs **in a container with stated resources** (`BACKEND_CPUS`, `BACKEND_MEMORY`), built from `backend/Dockerfile` as compiled JavaScript, as a non-root user. `make loadtest-up` starts it with Postgres and Redis. The results are therefore "this spec carries this load", and a different spec is one setting away. Design target: **1,000 connected users**.
  - Rate limits stay ON. A new `TRUST_PROXY` setting (number of reverse proxies in front of the server, default 0) makes the server read the client address from `X-Forwarded-For`, counted from the right; the load generator gives every virtual user its own address, the way real users behind a proxy look. This is also what a real deployment needs, so it closes the old "trust proxy" TODO.
  - A **fake catalog** (`CATALOG_PROVIDER=fake`) so no load test calls Deezer. The configuration refuses it when `NODE_ENV=production`, and the container runs with `NODE_ENV=test` for that reason (nothing else depends on it).
  - Users and tokens are created directly in the database and signed with the secret, so the test does not spend its time hashing passwords; password hashing is a deliberate cost (ADR-006) measured separately.
- Consequences: the load generator runs on the laptop next to the container, so very high numbers measure the laptop as much as the server (the harness reports its own CPU, and the results say so). `TRUST_PROXY` must be the REAL number of proxies: a client can write anything in `X-Forwarded-For`, and a value that is too high lets it pick its own address and dodge the limits (tests pin this down). Docker's own VM (2 CPUs, 3.8 GB here) caps what can be measured; the results state the VM size.

### ADR-022: Email verification and password reset: 6-digit codes, login blocked until verified

- Status: accepted
- Date: 2026-10-15
- Deciders: belmqadem
- Context: the subject requires email validation for password accounts and a forgot-password flow. Until now anyone could register any address (and, with Google's verified email, lock the real owner out through `EMAIL_TAKEN`), and a forgotten password was a dead end.
- Options considered:
  - Proof by a **link** with a long random token (256 bits, safest against guessing) or by a **6-digit code** typed in the app. A link needs a deep link or a hosted page, and neither exists yet in Expo.
  - Unverified accounts **cannot log in**, or can log in with limits. Limits mean a permission rule per action to define, test and defend, and the squatter still holds the address meanwhile.
  - Mail: an interface with a console implementation (development) and an SMTP one (nodemailer), or SMTP only.
- Decision:
  - **Codes**: 6 digits from `crypto.randomInt`, valid 10 minutes, **5 tries** per code (counted by the same SQL statement that reads the hash, so simultaneous guesses cannot exceed it), single use (`DELETE` decides the winner when two correct submissions race). One pending code per user and purpose (`PRIMARY KEY (user_id, purpose)`); a new one replaces the old and is refused inside one minute. 6 digits has only a million values, so the code is stored as an **HMAC-SHA256** keyed with the server secret over `purpose:userId:code` (a plain hash could be reversed in a second from a leaked database; the purpose and user make a code useless elsewhere). The key is `JWT_ACCESS_SECRET`: rotating it only voids pending codes, which live 10 minutes anyway.
  - **Verification**: register returns `201 { email }` and **no session**; login answers `403 EMAIL_NOT_VERIFIED` only after the password matched (no enumeration). Existing accounts are marked verified by the migration. Social accounts with a provider-verified email are verified on creation.
  - **Reset**: `forgot-password` answers `204` for any address; `reset-password` checks the register password policy before the code is spent, then changes the hash, marks the email verified and **revokes every refresh token** of the user in one transaction.
  - **Squatting**: when a provider proves an address that an unverified password account holds, that account is deleted (it could never log in, so it owns nothing) and the social account is created. A verified account is never touched (ADR-007 stays: no automatic linking).
  - **Mail**: `Mailer` interface; `console` for development (refused when `NODE_ENV=production`, it prints the codes), `smtp` through nodemailer (`SMTP_URL`, `MAIL_FROM`), Mailpit in docker-compose under the `mail` profile to read the mails locally. The mail is sent **without waiting** for the server: a slow or failing SMTP cannot fail the request or reveal whether an account exists; a failure is logged (never the message) and the user can ask again.
- Alternatives: links (stronger tokens, more mobile and infra work); allow limited login (more rules); a transactional-mail API such as Resend or SendGrid (one HTTPS call, no SMTP, but a vendor account and key).
- Consequences:
  - A 6-digit code is guessable in principle: an attacker can ask for a new code every minute and try 5, about 7,200 tries a day against a million values (roughly 0.7% a day for one targeted account), bounded by the per-IP limit. Mitigations if it matters: a per-account daily cap on codes, or switching to the link option.
  - The register response changed (no session) and `User` gained `emailVerified`: a contract change the mobile app must follow.
  - Response time of `forgot-password` differs slightly between a known and an unknown address (one database write); the mail itself is not waited for.
  - `nodemailer` is a new dependency; SMTP credentials live only in `.env`.

### ADR-023: Friends: mutual request and accept, one row per pair

- Status: accepted
- Date: 2026-10-15
- Deciders: belmqadem
- Context: the subject requires profile information that only friends can see. That needs a notion of friendship before the profile can be built.
- Options considered:
  - **Mutual**: one person asks, the other accepts. "Friends-only" means both agreed.
  - **One-way follow**: no acceptance. Simpler tables, but "friends-only" would mean "anyone who follows me", which anyone can grant themselves, so it would protect nothing.
  - Storage: one row per pair with a status, or two directed rows (A->B, B->A).
- Decision:
  - Mutual, in one table `friendships(requester_id, addressee_id, status pending|accepted, created_at, responded_at)` with **one row per unordered pair**, enforced by a unique index on `(LEAST(a, b), GREATEST(a, b))`. A->B and B->A can therefore never both exist, even when sent at the same moment; the database enforces it, not a check before the insert.
  - Declining, cancelling and unfriending **delete** the row (no `declined` state), so the pair can ask again and a rejected person cannot be told apart from "never asked".
  - A->B while B->A is pending **completes that request** (both want it): `200` with `accepted`, not a second row and not an error.
  - Sending locks the pair (`FOR UPDATE`) and decides inside one transaction. If two requests insert at the same moment, the loser hits the unique index and decides again with the winner's row in view (a new transaction, because a failed insert aborts the old one). Accepting is one `UPDATE ... WHERE id AND addressee_id AND status = 'pending'`, so of several simultaneous accepts exactly one matches.
  - Authorization is part of the SQL: accept only matches the addressee; decline/cancel only matches a pending request the caller is in; unfriend only matches an accepted friendship between the caller and the named user. The requester trying to accept gets `403`; anyone not in the request gets the same `404` as for an unknown id.
- Alternatives: following (above); two directed rows (simultaneous opposite requests then need extra logic to avoid a duplicate friendship).
- Consequences: `areFriends(a, b)` is the single question the profile code asks before showing friends-only data, and only `accepted` counts. No blocking and no real-time notification yet (the app polls the request list); both can be added without changing this table's meaning. Deleting a user deletes their friendships (`ON DELETE CASCADE`).

### ADR-024: Profiles: fixed blocks, the server decides who sees each

- Status: accepted
- Date: 2026-10-15
- Deciders: belmqadem
- Context: the subject requires a profile with public information, friends-only information, private information and music preferences, with visibility enforced by the backend.
- Options considered:
  - **Fixed blocks, fixed audience** (chosen): each block has one audience decided by the server.
  - **Per-field visibility chosen by the user** (each field public / friends / private): more flexible, but every field then needs a stored setting, and every read has to check it. More rules to get wrong and defend.
  - Where the check lives: in each endpoint, or in one function used by all.
- Decision:
  - Four blocks: `publicInfo {bio}` (any signed-in user), `friendsInfo {fullName, city}` and `musicPreferences {genres}` (accepted friends and the owner), `privateInfo {phone, birthDate}` (the owner only). Music preferences default to empty, so they reveal nothing until the owner fills them in.
  - **One function decides**: `shapeProfile(record, relation)` in `modules/profiles/visibility.ts`, with `relation` = self / friend / stranger. `GET /users/me/profile` and `GET /users/{id}/profile` both go through it. The relation is computed with `areFriends` (ADR-023); a pending request is not friendship.
  - A block the caller may not see is **omitted**, not returned empty or null, so its absence says nothing about whether it was filled in.
  - Editing has no user id in the path (`PATCH /users/me/profile`) and the body is `strict`, so there is no way to name another user's profile. An unknown field (for example `userId`) is a `400`.
  - PATCH is one `INSERT ... ON CONFLICT (user_id) DO UPDATE` that sets only the columns that were sent: the row is created on first use, two simultaneous PATCHes cannot collide on the insert, and neither overwrites fields it did not send.
  - Authentication is required on all three endpoints. An unknown user id is `404 USER_NOT_FOUND`; a user who never edited has an empty profile.
  - Validation: bio at most 280, fullName and city at most 80, phone 3 to 30 characters of digits and separators, birthDate a real `YYYY-MM-DD` between 1900 and today, at most 10 genres of at most 30 characters (trimmed, lowercased, deduplicated). Limits are also database CHECK constraints.
- Alternatives: per-field visibility (above).
- Consequences:
  - Any signed-in user can read any user's public block and display name (by id); ids are only obtained from search, invitations and friend lists, and search is rate limited.
  - The display name is already visible in `UserSummary`, so it is returned in every view.
  - The user cannot choose to make the "friends" block public or hide the bio. If the team wants that later, it is a new column per block and a change in `shapeProfile`.
  - Phone and birth date are personal data: they are stored in clear text (the owner needs to read them back), never logged, and never returned to anyone else.

### ADR-025: Linking and unlinking a social login needs proof of ownership

- Status: accepted
- Date: 2026-10-16
- Deciders: belmqadem
- Context: `POST /users/me/providers/{provider}` needed only a valid access token and a credential for any Google or Facebook account. With a stolen access token (valid 15 minutes) an attacker could link their own Google account and then log in as the victim for good, after the token expired. Unlinking had the same weakness in the other direction (removing the owner's other ways in).
- Options considered:
  - **Prove it with a login method the account already has** (chosen).
  - An emailed 6-digit code (ADR-022 machinery): works for both account types but not for accounts without an email, needs a new endpoint and a two-step flow in the app.
  - Only notify the owner by email after a link: detects, does not prevent.
  - Accept the risk (15-minute window).
- Decision:
  - Link and unlink carry `reauth`: either the account's **password**, or a **fresh credential from a provider already linked** to the account (checked against that account's own `oauth_identities`, not just "valid"). Either one is enough, so social-only accounts can do it too.
  - Failure is `403 REAUTH_FAILED` (new code). A rejected provider credential used as proof is also 403, not 401: a 401 tells the app "your session expired" and could start a refresh loop. A deleted user is still 401.
  - The proof is checked before anything else (before the new credential is sent to the provider, before the "last login method" check), so a failed proof tells the caller nothing about the account.
  - Password check reuses `verifyPassword`: a bcrypt comparison always runs, so an account without a password takes as long as a wrong password.
  - Both endpoints share the login rate limit (10 per 15 minutes per IP): they check a password, so they must not be a way to guess one.
  - Unlink is a `DELETE` with a JSON body. Servers and `fetch` accept it; some proxies and HTTP clients drop bodies on `DELETE`. We accept this because the alternative (`POST .../unlink`) breaks the REST shape the contract already uses; if a real client strips the body, switch to the `POST` form.
- Alternatives: the options above.
- Consequences:
  - Breaking change for the link and unlink calls (the mobile app does not call them yet). The app must ask for the password, or run the provider sign-in again, before linking.
  - Residual risk: the limit is per IP, so an attacker with a stolen token and many addresses can guess a password through these endpoints during the token's 15 minutes. The password policy (ADR-006) and the token lifetime bound this; a per-account limit would close it; the team decided not to build one (2026-10-17) and accepts the risk.
  - A social-only account whose only linked provider is temporarily unreachable cannot link or unlink until it is back (`502`).

### ADR-026: Events and playlists stay separate resources in the app

- Status: accepted
- Date: 2026-10-16
- Deciders: belmqadem, with kaoutharrr to confirm in the contract review
- Context: the first mobile skeleton used routes such as `session/[id]/track-vote` and `session/[id]/playlist-editor`, which assume that one "session" id reaches both services. The backend has two resources, `/events` (Track Vote) and `/playlists` (Playlist Editor), each with its own id, visibility and permission mode.
- Options considered:
  - **Separate** (chosen): the app has event screens and playlist screens; a user creates one or the other.
  - A **session that holds one event and one playlist**: a new backend resource or link table, a contract change, and the question of which visibility and permission rules apply to the pair.
  - "Session" as a label only, mapped to an event or a playlist inside the app: hides the real model and is hard to explain.
- Decision: no session id. The mobile routes are `event/[id]` (Track Vote) and `playlist/[id]` (Playlist Editor). The subject describes two services with their own visibility and permission modes, and the backend already models exactly that.
- Consequences: no backend or contract change. The skeleton's `session/[id]` screens are renamed or merged (the event screen is the track-vote screen, the playlist screen is the editor). The home screen lists both kinds. If a combined session is wanted later it is an additive resource that points at an event and a playlist.

### ADR-027: Response security headers set by hand, and `/docs` off in production

- Status: accepted
- Date: 2026-10-17
- Deciders: belmqadem
- Context: `docs/security.md` listed two open risks: no security headers on responses, and the Swagger UI (`/docs`) served in every environment.
- Options considered:
  - **`helmet`** (the usual package): one line, many headers. A new dependency to review, and its default Content-Security-Policy breaks the Swagger UI, so it needs per-route configuration.
  - **A small middleware written by hand** (chosen): four headers, about 15 lines, no dependency, each one explainable.
  - Leave it: a JSON API gets little from browser headers, but a missing `nosniff` or CSP is the first thing a security review looks for.
- Decision:
  - `securityHeaders` is the first middleware, so errors, 404s and rate-limit answers carry the headers too: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` (an API answer must not load, run or be framed).
  - `/docs` is exempt from the CSP only (exact path `/docs` or `/docs/...`, not `/docs-evil`), because the Swagger UI needs scripts; it still gets `nosniff`.
  - `Strict-Transport-Security` is sent only when `req.secure` is true. That is the request's real protocol, taken from `X-Forwarded-Proto` only when `TRUST_PROXY` says a proxy is trusted, so a client cannot make us send it by writing the header, and plain-http development never sees it.
  - `/docs` is mounted only when `DOCS_ENABLED` allows: default on in development and test, off when `NODE_ENV=production`, overridable either way. When off, `/docs` is the ordinary `404 NOT_FOUND`.
- Alternatives: `helmet` (above); protecting `/docs` with a login instead of switching it off (more code and a credential to manage for a document that adds little over `docs/api-contract.md`).
- Consequences: the production deployment must set `TRUST_PROXY` for HSTS to be sent. The header list is deliberately short; `Permissions-Policy` and cross-origin isolation headers are not set because they matter for pages, not for a JSON API. If the team prefers `helmet`, only `middleware/security-headers.ts` and its tests change.

### ADR-028: How the app keeps the session: one guarded refresh, tokens handled outside the screens

- Status: accepted
- Date: 2026-10-18
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: refresh tokens are single use and a token used twice revokes the whole session (ADR-003, ADR-010). The access token lives 15 minutes. The app has many screens that call the API at the same time, and runs on phones and in browsers with several tabs (ADR-012). A bug in token handling logs users out at random, so it must exist in one place and be tested.
- Options considered:
  - **When to refresh**: on a timer before the token expires, or only when the server answers `401 TOKEN_EXPIRED`. A timer needs background timers (not reliable on a phone) and clock handling; reacting to the answer costs one extra failed call every 15 minutes.
  - **How**: an HTTP library with interceptors (axios), or a small client of our own on `fetch`. The library is one more dependency for about 60 lines of logic we must be able to explain.
  - **State**: a state library (zustand, Redux) or React's `useSyncExternalStore`.
- Decision:
  - Reactive refresh. A call sends the access token; on `401 TOKEN_EXPIRED` the app refreshes **once** and repeats the call **once**. Any other error is passed through untouched (a `403 REAUTH_FAILED` or a wrong password must never look like an expired session). A second `401` on the repeat ends the session instead of looping.
  - **One refresh in flight**: simultaneous calls that all see an expired token share one refresh. A call whose "expired" answer arrives after another call already refreshed just repeats with the new token. On web, `navigator.locks` makes tabs take turns, and the refresh token is read from storage inside the turn, so a tab that waited uses the token the other tab saved.
  - **The new refresh token is saved before it is used**, because the old one is already spent on the server. If the device storage refuses the write, the session lasts until the app closes (a warning is logged) instead of failing in the middle of use.
  - The session ends locally only when the server says it is over (`401` on refresh). Offline or a server error keeps the stored token, so the next launch can try again.
  - Signing out never depends on the network: the server is told when reachable, the phone forgets the session either way, and the caller is told whether the server was reached. If the device cannot delete the stored token the error is raised, not hidden.
  - Storage: iOS Keychain / Android Keystore through `expo-secure-store` on phones; `localStorage` on web (ADR-012, option A, risk accepted in `docs/security.md`). The access token is never stored.
  - Plain TypeScript with injected `fetch`, storage and backend address, so it is tested in Node without a phone (60 tests, mutation-checked). Screens use `useAuth()`, `auth.*` and `api.*` only.
- Alternatives: the options above.
- Consequences: two new dependencies, `expo-secure-store` (runtime) and `vitest` (tests, same as the backend). The retry is only safe for calls that can be repeated; voting (`PUT`) and reading are idempotent, adding a track is not, but a request that was refused as expired was never run by the server. A response lost after a successful refresh means the next refresh reuses a spent token and logs the user out (ADR-010, accepted). Web tabs without `navigator.locks` (old browsers) can still race.

### ADR-029: The mobile theme is generated from the design tokens

- Status: accepted
- Date: 2026-10-18
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: the design comes from Stitch as `design-tokens.json` (colors, type scale, radii). The rule in `CLAUDE.md` is that screens never hardcode a color, font, size or radius. A rule nobody can check is a wish, and two hand-copied copies of the same values drift apart.
- Options considered:
  - **Generated** (chosen): a script turns the tokens into code, and a test fails when the committed output is stale.
  - **Hand-written theme file**: simplest, no script, but it can silently drift from the export, and re-exporting from Stitch means re-copying by hand.
  - **Read the JSON at runtime or in Metro**: always in sync, but the types are lost (a typo in a color name becomes a runtime bug) and the build gets a custom step.
- Decision:
  - `mobile/scripts/generate-theme.mjs` (no dependency) reads `design-tokens.json` and writes three committed files in `mobile/src/theme/`: `tokens.generated.ts` (typed `colors`, `radius`, `typography`, font names), `fonts.generated.ts` (the font files to load) and `theme.generated.css` (Tailwind / NativeWind theme variables, so `className="bg-ember"` works). `make theme` runs it.
  - The export is never edited. Tokens we add live in `design-tokens.extensions.json` (today: `text.placeholder` = #757B8B, 4.55:1 on the input fill, where `text.tertiary` is 3.32:1); the generator merges them and refuses one that already exists in the export.
  - Every color needs a name in the generator (`COLOR_NAMES`); a new token in a re-export stops the build until someone names it, instead of getting an accidental name. The generator also refuses an unreadable color, a size in the wrong unit, a text style whose font family has no such weight, and a light color mode.
  - The CSS first resets Tailwind's default palette, radii, fonts and sizes (`--color-*: initial` and so on), so `bg-red-500` or `text-lg` simply do not exist: only tokens can be used. (Checked by compiling the real CSS with Tailwind.)
  - React Native cannot synthesize weights from a custom font, so each (role, weight) is its own loaded font file: `font-sans-600`, `font-display-800`, and `typography.h3.fontFamily` is `PlusJakartaSans_600SemiBold`. Letter spacing is converted from em to pixels.
  - Fonts come from Expo's `@expo-google-fonts/*` packages (Syne, Plus Jakarta Sans, JetBrains Mono), imported per weight so unused weights are not bundled, and loaded with `expo-font` while the splash screen stays up. If loading fails the system font is used and a warning is logged.
  - `make test` includes tests that fail if the generated files differ from the generator's output, and a scan that fails on a `#hex`, `rgb()` or `hsl()` color anywhere in `mobile/src` outside the generated files.
- Alternatives: the options above.
- Consequences: three font packages, `@types/node` (dev, for the tests) and the generator to maintain. Spacing is not part of the Stitch tokens, so Tailwind's spacing scale still applies; a spacing token set is worth proposing before the layouts multiply. Tailwind's `transparent` and `current` keywords still work (they are not colors). If Stitch exports a new token category (shadows, say), the generator has to learn it.

### ADR-030: Shared components: tokens only, variant rules in plain modules, tested in Node

- Status: accepted
- Date: 2026-10-18
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: `DESIGN.md` says to build shared components first and compose screens from them. The design rules are specific (one Ember button per screen, Chartreuse only for live things, inverse text on bright fills, depth from surface tiers and not shadows). In React Native a wrong class name draws nothing and raises no error, and nobody can see the app from the test run.
- Options considered:
  - **How to test components**: render them (`@testing-library/react-native` with `jest-expo`: heavy, a second test runner), or keep each component thin and test what it asks for.
  - **How to style**: `StyleSheet` objects with the token values, or `className` with the token classes (NativeWind). The classes are readable, and the generated theme (ADR-029) already removes every non-token value.
- Decision:
  - Five components plus a layout wrapper in `mobile/src/components`: `Text`, `Button`, `Input`, `Card`, `Badge`, `Screen`. Screens import them from `@/components`.
  - Styled with `className` using only token classes. Typography comes from the `typography` constants (React Native cannot synthesize weights, so each style names its font file).
  - Each component's variant logic is in a plain module without React Native (`button-styles.ts`, `input-styles.ts`, ...), so vitest tests it in Node: Ember only on the primary button and its pressed state is ember-hover; the label on a bright fill is the inverse color; an input error wins over focus and the focus ring is Ember; cards separate levels with surface tiers and have no shadow; Chartreuse appears only in the live badge; every text/fill pair reads at least 4.5:1.
  - A test compiles every class the app uses (written in a `className` or built by a style module) with the real stylesheet and fails on one that does not come out, so a typo or a use of Tailwind's removed default palette (`bg-red-500`) cannot slip through. Another scans for shadow and elevation styles.
  - Navigation follows the design system too: a `ThemeProvider` with the token colors (canvas background, primary text, hairline borders), a styled tab bar, a light status bar. The navigation highlight is the primary text color, not Ember, because Ember is for the one main action of a screen. `app.json` is dark only and the splash screen uses the canvas color; a test keeps both in line with the tokens.
  - `TrackRow` and `RoomCodeChip` (also named in `DESIGN.md`) are not built yet: they depend on the event and playlist data the screens will show.
  - A temporary gallery (`/gallery`, `src/dev`) shows every component and state on a device.
- Alternatives: the options above.
- Consequences: what the tests cannot prove is how it looks and feels (spacing, press feedback, keyboard behaviour, the fonts rendering); that needs a device, and the gallery is for that. Spacing is not part of the design tokens, so the components use Tailwind's spacing scale (`p-4`, `px-5`, `gap-3`); a spacing token set should be proposed before many screens exist. A component that should accept a new look must get its rule in the style module and a test first.

### ADR-031: The auth screens: checks that mirror the backend, no personal data in routes

- Status: accepted
- Date: 2026-10-19
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: the auth screens (welcome, sign-up, verify-email, sign-in, forgot-password) sit on the auth logic of ADR-028 and the components of ADR-030. Decisions were needed on how much to check before the network, how screens pass the email to each other, what the user reads when something fails, and what happens after the email is confirmed.
- Options considered:
  - **Checks**: only the backend's answer; or the same rules in the app, for an answer before the network.
  - **Passing the email between screens**: a route parameter (`/verify-email?email=...`); or a small in-memory handoff.
  - **After confirming the email**: sign in automatically (the app would have to carry the password from the sign-up screen to the code screen); or go to sign-in with the email filled in.
  - **Error text**: show the backend's `message`; or map each stable `code` to our own words.
- Decision:
  - The app mirrors the backend's rules (password 8 to 72 UTF-8 bytes with a lowercase, an uppercase, a digit and a symbol, all Unicode-aware; email trimmed and lowercased, 254 at most; display name 1 to 50 after trimming; 6-digit codes). The backend still decides: a test runs the backend's own rules against the app's on a table of inputs (Unicode letters and digits, emoji, accented characters, the 72-byte edge) and fails if they ever disagree.
  - The email is handed over in memory (`auth/forms/handoff.ts`), never in the route: on the web build a route becomes a URL, and a URL ends up in browser history and server logs. A screen that finds the handoff empty (app reopened, link opened directly) asks for the email.
  - The password never leaves the screen where it is typed. So confirming the email leads to sign-in with the email filled in and a one-time notice, not to an automatic sign-in.
  - Every failure is mapped from its `code` to our own words (`auth/forms/error-messages.ts`); a server message is never shown as is, except the per-field rule messages of a `VALIDATION_ERROR`. Messages never say whether an address has an account where the backend does not (forgot-password and resend say "if there is an account").
  - `EMAIL_NOT_VERIFIED` at sign-in (which the backend only answers after the password matched) sends the user to the code screen. The "send a new code" button mirrors the backend's 60 s wait, clamped so a clock change never makes it longer.
- Verified against the real backend in a browser: sign-up with the policy messages, a wrong then the right code, a wrong then the right password, the session restored after a reload, forgot-password and sign-in with the new password. That run found two bugs that the tests could not: the API prefix `/api/v1` was missing from every call (the fake backend in the tests used the same wrong paths), and a tap on the padding of an input did not focus it. Both are fixed with a test each.
- Alternatives: the options above.
- Consequences: one extra step after confirming the email. The rules live in two places, held together by the parity test. Google and Facebook sign-in buttons come later (the logic exists, `auth.signInWithProvider`). The backend address can only be changed in Settings, which is in the signed-in group: a signed-out user cannot reach it yet (see the open item in `docs/mobile-handoff.md`).

### ADR-032: Facebook Limited Login tokens are accepted (iOS)

- Status: accepted
- Date: 2026-10-19
- Deciders: kaoutharrr and belmqadem
- Context: on iOS, the Facebook SDK only gives a classic access token when the user allows App Tracking Transparency. If they do not, it falls back to Limited Login and gives an OpenID token (a JWT) instead, which cannot be checked with the Graph API. ADR-011 verified access tokens only, so Facebook sign-in on iOS would have failed for everyone who says no to tracking.
- Options considered:
  - **Accept the Limited Login token too** (chosen): check it locally, like Google's ID token.
  - Ask for the tracking permission before Facebook login: no backend change, but an odd prompt for a login and a dead end when the user says no.
  - Offer Facebook on Android only.
- Decision:
  - The credential body does not change. The backend tells the two kinds apart by shape: a JWT is three base64url parts separated by dots, a classic access token has no dots.
  - A Limited Login token is verified with `jose`, like Google's (ADR-011): signature against Facebook's public keys (`https://www.facebook.com/.well-known/oauth/openid/jwks/`), RS256 only, issuer `https://www.facebook.com`, audience = our app id (otherwise a token issued to another app could log in here), expiry, and a non-empty `sub`. The values come from Facebook's discovery document (`https://limited.facebook.com/.well-known/openid-configuration/`). The Graph API is never asked about such a token.
  - The identity is `sub` and `name`. The email in the token is ignored, as for the classic login (ADR-011).
  - A failure to download Facebook's keys is `502 PROVIDER_UNAVAILABLE` (we could not decide), not a rejected credential.
- Alternatives: the options above.
- Consequences:
  - Facebook sign-in works on iOS whatever the user answers to tracking. No contract shape change; the description of `credential` gains the third kind.
  - Assumption to confirm on a device: Facebook says its subject identifiers are "pairwise" (per app). We assume a Limited Login `sub` equals the app-scoped user id that the classic login returns for the same person and app, so one person keeps one account across Android and iOS. If they differ, the same person would get two accounts; the fix would be linking, not a new rule.
  - Verified for real on an iOS simulator (2026-10-19): the SDK sent a Limited Login token (RS256, a `kid` from the published key set, issuer `https://www.facebook.com`, audience = our app id) and sign-in succeeded. The same run showed that after a Limited Login the SDK also returns an access token that `debug_token` reports as invalid; the app therefore sends the JWT (ADR-033).
  - The observed token was valid for **90 days** (`exp` about 7,776,000 s after `iat`), not "short-lived" as Facebook's page says. Like Google's ID token it is not bound to a server-issued nonce, so a captured token could be replayed for that long, against Google's hour or so. Chosen mitigation: the backend refuses a Limited Login token issued more than 10 minutes ago (`maxTokenAge`), since the app sends it seconds after the login; a stolen token is useless after that. Rejected for now: a server-issued, single-use nonce passed to the SDK, which is stronger (no replay at all) but needs a new endpoint and app changes.
  - The RS256 pin is a second line of defence: `jose` already refuses an HS256 token against an RSA key, so a mutation that also allows HS256 is not caught by a test.

### ADR-033: Google and Facebook sign-in in the app: native SDKs in a development build

- Status: accepted
- Date: 2026-10-19
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: the backend already verifies Google ID tokens and Facebook tokens (ADR-007, ADR-011, ADR-032); the app needs to obtain them. The defense runs on a development build on a simulator or emulator.
- Options considered:
  - **Native SDKs** (chosen; Expo's current recommendation): `@react-native-google-signin/google-signin` and `react-native-fbsdk-next`. Native account pickers; they need a development build (not Expo Go).
  - `expo-auth-session` in the browser: runs in Expo Go and on the web, but Expo has deprecated its Google and Facebook helpers and the redirect setup is fragile.
- Decision:
  - "Continue with Google" and "Continue with Facebook" on the sign-in and sign-up screens, as secondary buttons (the screen's one Ember button stays its email action). The SDK gives the app a credential, `auth.signInWithProvider` sends it, and the backend answers with our own session. The provider's SDK is signed out right after it hands over its token: our session is the backend's (ADR-028).
  - Google: the Web client id is configured, because the ID token is issued for it; the backend's `GOOGLE_CLIENT_IDS` must list it. Facebook: only `public_profile` is asked (the backend ignores the Facebook email). The tracking permission is never requested, so on iOS the SDK returns a Limited Login token, which the backend accepts (ADR-032).
  - Automatic event logging and advertiser-id collection are off, and the tracking prompt is never shown. Note: the SDK adapter registers itself in the app delegate, so the Facebook SDK is loaded when the app launches (seen on the simulator: an SKAdNetwork message at launch), not only when the button is tapped; `Settings.initializeSDK()` on tap is kept as a safety net.
  - Ids come from `mobile/.env`: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_FACEBOOK_APP_ID` (public identifiers), and `FACEBOOK_CLIENT_TOKEN`, used only when the app is built. `app.config.ts` adds each SDK's config plugin only when its ids are set, so a build without them still works and simply shows no button. The web build never shows them (the native SDKs do not run in a browser).
  - The SDKs are loaded only when a button is tapped, so Expo Go and the web build do not crash on a missing native module; there, the button is either hidden or explains that this build has no such sign-in.
  - Failures have our own words, naming the provider. A provider account whose verified email belongs to an existing password account gets `EMAIL_TAKEN` (no automatic linking, ADR-007): the message tells the user to sign in with the password and link the provider from their profile.
- Alternatives: the options above.
- Consequences:
  - Two native dependencies. `npm run ios` / `npm run android` in `mobile/` now build and install a development build (`expo run:*`). The generated `mobile/ios` and `mobile/android` folders are not committed.
  - Checked without real ids: the config with and without ids, the generated `Info.plist` (URL schemes, Facebook settings, no tracking text) and Android manifest, and bundles for web and iOS. Checked for real on an iPhone 17 Pro simulator (iOS 26.5) against the backend: Google and Facebook sign-in both create a social-only account and a session, which survives an app restart. That run found that after a Limited Login the iOS SDK also returns an access token which Facebook's `debug_token` reports as invalid, so the app now sends the Limited Login JWT whenever there is one (`pickFacebookCredential`). Facebook's developer settings must list an iOS platform with the bundle id `com.musicroom.app`, otherwise its login page refuses the redirect.
  - Android: Google keys an Android OAuth client on package + signing SHA-1, unique across all of Google Cloud. React Native's template debug key is public and the same in every app, and `com.musicroom.app` with that key was already registered by someone else, so debug builds are signed with each developer's own `~/.android/debug.keystore` instead (a config plugin in `app.config.ts`; the template key only when that file is missing). Each developer registers their SHA-1 with Google and key hash with Facebook; no key is shared or committed. Alternatives: a unique package name (simpler, but renames the app on Android and its Facebook entry), or one team debug key shared outside the repo (one registration, but a key file to pass around).
  - Building inside an iCloud-synced folder (this repo on the Desktop) fails: iCloud adds "… 2" duplicates to `node_modules` and file attributes that code signing rejects. Build from a folder outside iCloud.
  - The buttons are text only. Google's and Facebook's branding guidelines ask for their logo and colours; that is a design task (the logos are not design tokens).
  - Linking a provider to an existing account (with re-authentication, ADR-025) has no screen yet.

### ADR-034: Track Vote in the app: the server's queue only, gated by version, kept live by one socket

- Status: accepted
- Date: 2026-10-20
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: the Track Vote screen shows a queue that many people change at once. Updates reach the phone from three sources in any order: REST answers, the subscribe acknowledgement and `event:queue` snapshots (ADR-016, ADR-019). The broadcast snapshots are the same for everybody, so they carry no `votedByMe`. The token is checked only at the socket handshake (it expires after 15 minutes).
- Options considered:
  - **What the app shows**: optimistic updates (count and order change on tap, rolled back on error); or **the server's state only** (chosen).
  - **Out-of-order messages**: apply whatever arrives last; or **apply a queue only if its `version` is higher than the one held** (chosen, as the contract asks).
  - **Socket ownership**: one socket per screen; or **one shared connection** that screens subscribe through (chosen).
- Decision:
  - `features/track-vote/queue-state.ts`, pure and tested: a queue from any source replaces the held one only if its `version` is higher. The app never re-sorts and never counts votes; it shows the server's order and counts.
  - My own votes are kept apart (a set of queue-entry ids), taken from REST queues and the subscribe acknowledgement, updated by the answer to my vote or withdrawal, and merged into every queue shown. A same-version REST queue is ignored, so a slow read cannot undo my vote's answer.
  - No optimistic update: a vote shows once the server answered. Ranking is server-side (ADR-008), so a guessed order could be wrong and would have to be rolled back; on a LAN the round trip is short.
  - The owner's "Next track" sends the id this phone shows as playing; a `409 QUEUE_CHANGED` (a double tap, or a second device first) shows the queue from the error's `details`, so no song is skipped.
  - `sockets/live-connection.ts`, tested with a fake socket: one connection, opened by the first subscription and closed with the last (a new socket each time, so a changed backend address is used). After every (re)connect it subscribes again, because the server forgets subscriptions on a disconnect. `TOKEN_EXPIRED` at the handshake: one refresh through the auth controller's single refresh (`refreshAccessToken`, shared with REST calls), then reconnect; refused again right after, or `UNAUTHENTICATED`, it stops (offline) instead of looping. Sign-out closes it.
  - The handshake sends the access token and, in React Native, our `X-Platform` / `X-Device` / `X-App-Version` headers (WebSocket transport), so the backend logs it like a request. Browsers cannot send headers on a WebSocket: the web build's socket connections are logged without them.
  - Without a live connection, the app reads the queue again over REST after each of my actions, so counts and order are not stale.
  - `myPermissions` only decides what is shown (the Vote control, "Next track"); the server checks every call. A user who may see but not vote gets a read-only queue; withdrawing my own vote is always offered, as the contract allows.
- Verified against the real backend in the web build: the list; the queue with Deezer covers; another user's vote re-ordering the queue live with my marks kept; withdrawing; starting to play; a non-invited user seeing a read-only queue (and the API refusing that user's vote with `403 NOT_INVITED`).
- Alternatives: the options above.
- Suggesting (added 2026-10-20): the catalog search is a sheet over the event screen, not a screen of its own, because a suggestion counts as my vote and the event screen's queue must record that answer (a re-read could not: a same-version queue is ignored, see above). Search waits for a 400 ms pause in typing and shows only the latest query's answer (`api/track-search.ts`, tested with fake timers), since search is rate limited (30 per minute per IP). A `409 TRACK_ALREADY_QUEUED` carries the queued track: the app votes for it instead and says so (`suggest-track.ts`).
- Place-and-time events (added 2026-10-20, `expo-location`, "while using the app" only): the position is asked only when the server needs it. A vote or suggestion goes without one; on `400 LOCATION_REQUIRED` the app gets the position (with its accuracy) and sends once more, then sends it straight away for the rest of that event (`location-required.ts`). Options considered: always ask in such events (one request less, but it would ask the owner, who is never restricted, and people outside the event's hours, since the server checks the time first). Withdrawing never sends a position. No position within 15 s, location services off, or permission refused (for now or for good) each have their own message; `LOCATION_REQUIRED` after sending means "not precise enough" (worse than 100 m, for example Android's approximate location or iOS reduced accuracy). The event screen shows the radius and time window, in the phone's language and time zone.
- Last known position (added 2026-10-25): an Android pass showed "no position within 15 s" twice while the phone had a position from seconds before (a GPS that is not warming up gives no new fix; indoors on a real phone it is common too). When no fresh fix comes, or the phone fails to give one, the app now sends the phone's last known position if it is at most 2 minutes old and its accuracy is known and within 100 m, the server's own limit (`position-fallback.ts`, pure and tested). Options considered: a longer wait (slower, and still fails indoors); the last known position first (fast, but older than needed when a fresh one would come); fall back only after the fresh attempt (chosen). Consequence: a vote can use a position up to 2 minutes old, so someone who just left the venue can still vote for that long; the server cannot tell, as it cannot tell how a phone got its position anyway. A refused permission or location services off never fall back.
- Creating an event (added 2026-10-20): name, who can see it (public, private) and who can vote (everyone, invited people, at the venue). `create-event-form.ts` turns the form into the request and checks what the backend checks (name 1 to 100 characters after trimming, coordinates in range, a comma accepted as decimal point); a test runs every request the app builds through the backend's own `createEventSchema`. For "at the venue": the venue comes from the owner's current position or typed coordinates (no map), the radius is 100, 200, 500 or 1000 m, and the window is a preset (opens now, in 1 or 2 hours; lasts 1, 2, 4 or 8 hours). Options considered for the window: a date and time picker (any window, but `@react-native-community/datetimepicker` is another native dependency and another rebuild) against presets (no dependency, enough for a party or a class, quick to demo); presets chosen, a picker can be added later.
- Consequences: a vote takes one round trip to show; in exchange the screen never shows a state the server did not have. In a place-and-time event the first vote costs one extra round trip. An event cannot be scheduled further ahead than two hours from the app (presets). Not yet: inviting people (the private and "invited people" modes need it to be useful).

### ADR-035: Invitations in the app, shared by events and playlists

- Status: accepted
- Date: 2026-10-20
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: private events and playlists, and "invited people" voting or editing, are only usable once the owner can invite people (ADR-005, ADR-013). The backend has the same invitation endpoints for both resources and a people search that returns only `{ id, displayName }`.
- Options considered:
  - **One invitations feature for both resources** (chosen): `features/invitations` takes the resource (`event` or `playlist`) and its id, route `invitations/[resource]/[id]`; or a copy inside each feature.
  - **Finding people**: reuse the catalog search's runner, made generic (`api/latest-search.ts`: waits for a pause in typing, shows only the latest answer); or a second copy of it.
- Decision:
  - The owner sees "Invite people" on an event that is private or where only invited people vote (an invitation changes nothing elsewhere). The screen searches people from 3 characters (the backend's minimum, so the directory cannot be listed), shows each result's name and the start of its id (names are not unique; there is never an email), and lists who is invited, newest first, with Invite and Remove.
  - Every action waits for the server; the list keeps one entry per person. `409 ALREADY_INVITED` (invited meanwhile from another device) reloads the list. A plain `404 NOT_FOUND` on an invitation means the person (the event itself answers `EVENT_NOT_FOUND`); `400` means inviting the owner, who never needs it.
  - Invitations take effect at once on the server: an invited person can see a private event straight away, and a removed one gets `404` again and loses its live updates (`event:access-lost`).
- Verified against the real backend in the web build: before an invitation the invitee got `404` for the private event, `200` after it, `404` again after the removal.
- Alternatives: the options above.
- Consequences: the Playlist Editor gets invitations by linking to `invitations/playlist/<id>`. Not done: inviting from the friends list (the contract's friends endpoints are not in the app yet).

### ADR-036: Playlist Editor in the app: the server's list only, edits by intent, kept live

- Status: accepted
- Date: 2026-10-23
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: several people edit the same playlist at once. The backend applies edits one at a time per playlist, expressed by intent ("after this entry"), and answers every edit, like every live update, with the whole ordered list and its `version` (ADR-009, ADR-020).
- Options considered:
  - **What the app shows**: move the row on tap and roll back on error; or **the server's list only** (chosen, as for Track Vote, ADR-034).
  - **Reordering**: drag and drop (needs a gesture library and gives an index); or **one place up or down** per tap (chosen), turned into an anchor.
  - **A gap in versions** (the contract says to refetch): every message is a full list, so a newer one already contains everything; the app applies it and does not refetch.
- Decision:
  - `playlist-state.ts`, pure and tested: a list from any source (REST, subscribe acknowledgement, `playlist:updated`, an edit's answer) replaces the one held only if its `version` is higher; the app never computes positions.
  - "Move up" is sent as "after the entry two above" (or `null`, the start), "move down" as "after the entry below"; a test applies the server's rule to prove each gives the expected order. The buttons are dimmed where a move is impossible.
  - Adding appends at the end, from the same catalog search sheet as Track Vote (now shared, `catalog/TrackSearchSheet.tsx`). Anyone allowed to edit can move and remove any entry.
  - `409 ANCHOR_NOT_FOUND` (the anchor was removed meanwhile) or `TRACK_NOT_FOUND` on a move (the entry is gone): the app says so and reads the list again. On an add, `TRACK_NOT_FOUND` means the catalog does not know the track.
  - The owner gets "Invite people" when the playlist is private or only invited people edit (ADR-035).
- Verified against the real backend in the web build: the list with its live badge; adding from the search; moving up; another user's move and removal arriving live; removing. Not reproduced by hand: the `409` conflict path (it needs two edits within the same instant); its message and reload decision are unit-tested.
- Alternatives: the options above.
- Creating a playlist (added 2026-10-23): name, who can see it (public, private) and who may edit (everyone, invited people), with the same checks as the backend's `createPlaylistSchema` (a test runs every request through it); the new playlist opens straight away, and the Playlists tab reloads on return.
- Consequences: one tap moves one place, so a long move takes several taps; drag and drop can come later.

### ADR-037: Screens guarded by the sign-in state; the server address is set while signed out

- Status: accepted
- Date: 2026-10-23
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: while the screens were being built, a temporary flag let every screen open whatever the sign-in state. The subject requires the backend address to be configurable in the app, and the defense runs the backend on another machine of the local network, so the address must be set before the first sign-in.
- Options considered:
  - **Changing the address**: anytime; or **only while signed out** (chosen).
  - **The component gallery** (`/gallery`, a design tool): delete it; or **keep it in development builds only** (chosen).
- Decision:
  - The flag is gone. Signed out: only the sign-in screens; signed in: only the app (`Stack.Protected` in the root layout), also for a URL typed or opened as a link. The server checks every request anyway.
  - "Server address" on the welcome screen: type `http(s)://address:port`, "Check connection" (reads `/health` and tells "a Music Room server", "something else answers" or "no answer", in 5 s at most), Save, or "Use the default" (the build's `EXPO_PUBLIC_API_URL`). The rules are pure and tested (`settings/server-address.ts`).
  - Signed in, Settings (from Profile) shows the address read-only with "Sign out to change it": a session's refresh token belongs to one server, and changing the address while signed in would send it to another server at the next refresh.
  - Update (2026-10-27): the read-only address was removed from Settings; the address is only seen and set while signed out.
  - Saving a different address (or "Use the default") first deletes any stored session (added 2026-10-25, `auth.forgetStoredSession`). Signed out does not always mean nothing is stored: when the server cannot be reached at launch, the app shows the sign-in screens but keeps the refresh token to try again next time. Found in the Android pass: without this, changing the address in that state sent the old server's token to the new one at the next launch. If deleting fails, the address is not changed; a restore still running is awaited first; saving the address already in use keeps the session. Options considered: store which server issued the token and never send it elsewhere (more code, keeps the session); show "server unreachable, retry" instead of the sign-in screens (better to use, more work, still possible later); delete on change (chosen: smallest, and switching servers means a new sign-in anyway).
  - `/gallery` redirects to the welcome screen in a release build.
- Verified in the web build against the backend: a sign-in URL while signed in opens the app, an app URL while signed out opens the welcome screen; the address refused without `http://`, "no answer" on a free port, "not a Music Room server" on another service, saved and kept across a reload, reset to the default. Not yet: the gallery redirect in a release build.
- Alternatives: the options above.
- Consequences: to switch servers, sign out first. Plain `http` is accepted (the defense network); a production build should require `https`.

### ADR-038: One copy file and one voice for the app; Track Vote events are "rooms" in the UI

- Status: accepted
- Date: 2026-10-25
- Deciders: belmqadem, kaoutharrr to confirm in review
- Context: the app's words were spread over every screen, in a neutral, formal tone. The audience is young people, and the same action was sometimes named two ways ("Create an event" on the list, "Create event" on the form). The subject names the modes public/private (who can see) and open/restricted (who can act).
- Options considered:
  - **Where the words live**: inline in each screen (as before); per-feature message files only; **one typed file, `mobile/src/copy.ts`** (chosen: one place to review the voice, and a second language is one more object of the same shape). No i18n library yet: nothing needs it.
  - **What an event is called in the UI**: keep "event" (matches the code, the API and the subject); **"room"** (chosen by the team, for the tone); both events and playlists as rooms (refused: ADR-026 keeps them separate).
  - **Who can see it**: **Public / Private** (chosen: the subject's words) or Open / Invite only (refused: "open" is the subject's word for who can act, so the two graded modes would read alike).
- Decision:
  - Every user-facing string is in `copy.ts`, grouped by screen or feature, with functions for text with values. The `messages.ts` files keep mapping backend error codes to text, and take the text from `copy`. The voice and vocabulary are in CLAUDE.md, "Copy and tone (mobile)", and the PR template asks about them.
  - In the UI a Track Vote event is a "room"; the routes, the code, the API and the docs keep "event". Who can vote in a room: "Everyone in the room", "Invited people only", "At the venue". Who can edit a playlist: "Everyone who can see it", "Invited people only".
  - Permission, privacy and error text stays literal: the tone pass changed wording, never meaning.
- Consequences: the UI says "room" where the code says event, so the defense has to explain that one mapping. Badges are uppercase by their style token (DESIGN.md, `badge` 700 uppercase), so "Yours" still shows as YOURS: a design decision, not copy. Tests that check exact wording were updated with it.

### ADR-039: Your profile in the app: the four blocks with who sees each, edited on a separate screen

- Status: accepted
- Date: 2026-10-25
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: the Profile tab showed only the name, the email and Sign out. The backend has the four profile blocks with a fixed audience each (ADR-024). This is the first of three parts: your profile; then other people's profiles and friends; then linked accounts.
- Options considered:
  - **Editing**: each block edited and saved in place; or **one edit screen with one Save** (chosen: one form, one request, the same pattern as Create room and Create playlist, fewer states to get wrong).
  - **What Save sends**: the whole form; or **only the fields that changed** (chosen: a field you did not touch is never overwritten, for example by a second device that changed it meanwhile).
  - **Genres**: a tag editor; or **one comma-separated field** (chosen: no new component; the tags are shown as badges on the profile).
  - **Birth date**: a date picker (a native dependency and a rebuild); or **typed as YYYY-MM-DD** (chosen, as the presets for events avoided a picker).
- Decision:
  - The Profile tab reads `GET /users/me/profile` each time it shows (so an edit appears on return) and shows only the blocks the server sent (`ProfileBlocks`, reused for other people's profiles later). Each block says who sees it, literally: "Anyone signed in", "Only you and your friends", "Only you".
  - "Edit profile" opens a form filled from a fresh read. `profile-form.ts` (pure) checks what the backend checks (lengths, phone shape, a real date between 1900 and today in UTC, at most 10 genres of 30 characters, the genre characters) and builds the `PATCH` with only what changed: trimmed, a blank field as `null` (clears it). Phone and birth date must be `null`, not `""`, which the backend refuses. Genres are lowercased and deduplicated before counting, as the backend does. Nothing changed: nothing is sent.
  - A test runs the requests the form builds, and the values it refuses, through the backend's own `updateProfileSchema`.
- Consequences: the display name is not editable (the contract has no endpoint for it). A `400` after the form's own checks means the two disagree; the app says a field was refused rather than guessing which.

### ADR-040: The app draws its own headers; the profile reads as a profile, not a form

- Status: accepted
- Date: 2026-10-25
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: the native stack and tab headers looked dated and differed between iOS (centered title) and Android (left title, arrow), and the profile tab was a column of form-like blocks.
- Options considered:
  - **Headers**: style the native headers (still two looks, few levers); hide them and put a title in every screen (every screen changes); or **the navigators' `header` option with one component of ours** (chosen: one place, every screen keeps setting its title as before).
  - **Icon sizes**: no token exists. Add size tokens (the theme generator only merges colors today); or **size an icon by the line height of the text next to it** (chosen: the icon lines up with its text and follows the type scale; nothing is hardcoded).
- Decision:
  - Tab screens (Rooms, Playlists, Profile): no title at all, the tab bar already says where you are; the header is only room for the status bar (`StatusBarSpace`). A large title in the display font was tried first and dropped by the team. Pushed screens: `StackHeader`, a round back button (a surface tier with a hairline) and the title centered on one line, so a room or playlist still shows its name and iOS has a visible way back. No bar line (depth from surfaces, DESIGN.md rule 2). The same on iOS and Android.
  - The profile tab: initials in a round avatar, the name in the display font and the email, then Edit profile (the screen's one Ember button). Each block under a heading with its icon (globe, people, note, lock) and who sees it; short values on the right of their label, the bio under it, genres as lowercase pills. Settings and Sign out as rows (Sign out in the error color, no chevron: it does not open a screen).
  - `Icon` wraps `expo-symbols` with one list of names (SF Symbols on iOS, Material Symbols on Android and web); icons are decorative, the text next to them carries the meaning.
- Consequences: a new screen gets its header by being in one of the stacks. Tab screens start right under the status bar with their main action (Create room, Create playlist, the profile's avatar).
- Partly superseded by ADR-041: the profile's sections and edit buttons, and where Create room and Create playlist sit.
- Update (2026-10-27): Rooms and Playlists now carry the app's logo and name (`BrandHeader`: the logo's rings from `scripts/generate-icons.mjs` and "Music Room" in the display font, centered on a surface-low band that rounds off at the bottom); Profile still only leaves room for the status bar.

### ADR-041: Profile sections named by what they hold, each with its own edit; create buttons at the bottom

- Status: accepted
- Date: 2026-10-25
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: on the profile, the blocks were headed by who can see them (Public, Friends only, Private) with a line of explanation each, which read as settings rather than a profile; one Edit profile button opened every field at once. On Rooms and Playlists, the create button sat at the top of the list, out of thumb reach on a tall phone.
- Options considered:
  - **Section names**: the visibility tiers (exact, but about rules, not you); or **what the section holds** (chosen), with the tiers kept where you decide what to share.
  - **Editing**: one form for everything; or **one edit button per section** opening only that section's fields (chosen: shorter forms, and the button sits next to what it changes).
  - **Create button**: at the top of the list; at the end of the list (out of sight once the list grows); or **pinned at the bottom, above the tab bar** (chosen).
- Decision:
  - Your profile: **My bio**, **About me** (full name, city, phone, birth date: the friends-only and private blocks together) and **My taste in music**; on someone else's profile (to come) **Bio**, **About**, **Music taste**, chosen by whether the profile is editable. The "who can see this" lines are gone from the profile.
  - Each section has a round pencil button (outlined, not Ember: DESIGN.md allows one Ember element per screen, and three pencils would break that; an Ember version was tried and dropped). It opens Edit profile with `?section=bio|about|music`; `PROFILE_SECTIONS` in `profile-form.ts` maps each section to its fields, and a missing or unknown section shows the whole form. Edit profile keeps the tiers (Public, Friends only, Private, Music taste) and the exact line about who sees each group: that is where you choose what to share.
  - Saving still sends only what changed. An error on a field of another section (not possible while the server checks the same rules) is shown with the field's name rather than blocking the save silently.
  - Create room and Create playlist: pinned under their list, above the tab bar, and shown while the list loads.
- Consequences: the server and its visibility rules are unchanged; only the names on the profile changed. Part 2 (other people's profiles) reuses `ProfileBlocks` without `onEdit`.

### ADR-042: A profile says where you stand with its owner

- Status: accepted
- Date: 2026-10-26
- Deciders: belmqadem, kaoutharrr (contract change: both review)
- Context: someone else's profile in the app needs one action depending on where you stand: Add friend, Cancel request, Accept or Decline, Unfriend. `GET /users/{userId}/profile` did not say; accept, decline and cancel take the request's id, which only the request lists had.
- Options considered:
  - **The app works it out**: friends when `friendsInfo` is present, pending by scanning your incoming and outgoing request lists (two more requests per profile, paging when there are many, briefly out of date).
  - **Try and react**: always offer Add friend and turn `409 FRIEND_REQUEST_EXISTS` into "Request sent" (no way to cancel or accept from the profile).
  - **A new endpoint** (`GET /friends/with/{userId}`): one more request per profile for something the profile read already knows.
  - **The profile answer carries it** (chosen): the server already reads the row between the two people to decide what to show; returning it costs nothing and keeps the server the source of truth.
- Decision: `Profile.friendship` is `{ id, status, direction }` from the caller's side, or `null` when there is no row, and always `null` on your own profile. The profile code now reads the row once (`findPair`, replacing `areFriends`) and `visibility.ts` decides both the relation (only `accepted` makes a friend) and this field, so there is still one place for profile visibility.
- Security: the row concerns only the caller and the owner, so it tells the caller nothing they could not already see in their own request lists. No other user id or date is included. Friends-only blocks still need `accepted`; a pending request, either way, still sees the public block only (tests: unit for `relationOf` and `friendshipOf`, integration for each state; four mutations of these rules each fail a test).
- Consequences: one field more on every profile answer, always present (so a client never confuses "absent" with "none"). The app shows the right action from one request and refreshes the profile after acting.

### ADR-043: Friends in the app: a row on your profile, one screen, actions on the person's profile

- Status: accepted
- Date: 2026-10-26
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: the friends endpoints (ADR-023) and `Profile.friendship` (ADR-042) existed with no screen. Friendship decides who sees About and Music taste, so it has to be reachable, but it is not a mandatory feature of the subject.
- Options considered:
  - **Where**: a fourth tab (visible, but the tab bar is for the mandatory features); or **a Friends row on your profile** (chosen), with the number of requests waiting.
  - **Unfriend**: one tap (too easy to do by mistake, and it removes what both of you see); a system alert (looks different on each platform); or **asked again in place** (chosen): the button turns into the exact consequence, Unfriend and Keep as friend.
  - **New requests**: pushed live (not in the contract yet); or **read again whenever the screen or the profile tab shows** (chosen), with pull-to-refresh where there is a list.
- Decision:
  - Friends screen (`/friends`): Find people (the same search as invitations, ADR-013), then Requests (Accept, Decline), Sent (Cancel request), and Your friends. Empty request sections are not shown. Every list is read again after each action.
  - Someone's profile (`/person/{id}`): their full name and then their city in small text under their name, each only when the server sent it and it is filled in (so only for a friend); then Bio and Music taste (ADR-041), with no About box and no line explaining what friends see (both were tried and dropped as clutter). One action from `friendship`, with no status badge (the button says it): Add friend, Cancel request, Accept and Decline, or Unfriend. After any action, and after any error, the profile is read again, so a conflict (they accepted or cancelled meanwhile) shows the server's state; Add friend when they had already asked makes you friends at once ("You're friends now."). Your own id opens the Profile tab instead.
  - Ids in request paths are URL-encoded: a person id can come from a link and must not reach another path.
- Genres, on every profile, are "vinyl chips": a pill with a small record drawn from surface tiers and the hairline (no new token, no Ember or Chartreuse); picked over a numbered top list and a mixed-size tag cloud.
- Consequences: `PersonRow` and `ProfileHeader` are shared; the invitations screen uses the same row and the same search wording. Real-time requests can be added later without changing these screens.
- Tested: 31 tests (`friendStateOf` for every state including your own profile, the request count, the error messages, each call's method and path, the encoded id). On the Android emulator as Bob: accept from a person's profile, Unfriend asked twice, Add friend and Cancel request (from the profile and from the Sent list), search, and Add friend while the other person had already asked.

### ADR-044: `User.hasPassword`, so the app asks only for proofs that can work

- Status: accepted
- Date: 2026-10-26
- Deciders: belmqadem, kaoutharrr (contract change: both review)
- Context: linking or unlinking Google or Facebook needs proof of ownership (ADR-025): the password, or a fresh sign-in with a provider already linked. `User` did not say whether the account has a password, so the app would offer "Confirm with your password" to a social-only account, where it can only fail, and could not tell that an Unlink would remove the last login method.
- Options considered:
  - **The app offers every proof** and explains a refusal ("…or this account has no password"): no contract change, but a dead end shown on purpose, and Unlink on the last method is only refused by the server.
  - **`User.hasPassword`** (chosen): one boolean the server already knows (`password_hash IS NOT NULL`).
- Decision: `User.hasPassword` is always present, in every `User` answer (login, OAuth, `/users/me`, link, unlink). The app counts login methods as linked providers plus one for a password, the same count the server uses for `409 LAST_LOGIN_METHOD`, and the server still decides.
- Security: `User` is only ever returned to the user themself (`UserSummary` stays `{ id, displayName }`). The field says whether a hash exists, never anything about it. A social-only account cannot get a password through reset (`forgot-password` only sends a code to accounts that have one), so the value does not change under the app. A test pins the exact fields of `/users/me` and that no hash appears.

### ADR-045: Sign-in methods in Settings: link and unlink with a proof first

- Status: accepted
- Date: 2026-10-26
- Deciders: kaoutharrr, belmqadem to confirm in review
- Context: the link and unlink endpoints (ADR-025) had no screen. Both need a proof of ownership, and `User.hasPassword` (ADR-044) now tells the app which proofs can work.
- Options considered:
  - **Where**: a row on the profile opening its own screen; or **a Sign-in methods section in Settings** (chosen): account security with the settings, the profile stays about you.
  - **Order when linking**: pick the new account first, then confirm; or **confirm first, then pick the account to link** (chosen): the confirm step reads the same for link and unlink, and nothing about the new account is fetched before you have said it's you. The password is only checked by the server at the end, so a wrong one is reported after the account was picked.
- Decision:
  - Rows: Email and password (your email, or "Not set up"; not changed here), Google, Facebook, each "Linked" or "Not linked". Link is offered when this build has the provider's SDK ("Not available in this version of the app" otherwise); Unlink only when it is not your last way to sign in (the row says "Your only way to sign in"), counted as the server counts (linked providers plus one for a password).
  - Confirm, in place under the row: the password field only if `hasPassword`, and "Confirm with Google/Facebook" for each linked provider this build can sign in with. If there is no proof possible here, it says so. Cancelling a provider sign-in at any step changes nothing.
  - After success the user is read again from the server (`refreshUser`) and the rows follow it. Errors come from the codes: wrong password, a provider account that isn't yours, already linked elsewhere, last login method, the provider unreachable.
- Security: the app never decides; it only avoids offering proofs that cannot work. The password is kept in the field only until the change is sent and is never logged. Provider SDKs are signed out right after handing over their token (ADR-033).
- Consequences: `PROVIDERS` and `ProviderLogo` are shared by sign-in and Settings. The sign-in error for an email already taken now points to Settings.
- Tested: 25 tests (login method count, when Unlink is offered, which proofs, each call's method, path and body, every error message). On the Android emulator as Bob (a password account): the section, the confirm step, and cancelling Google's account picker (nothing linked). Linking a real Google or Facebook account was not done in this run: that is a sign-in with a real account, done by a person.

### ADR-046: Unique display names, chosen after sign-up and required everywhere

- Status: accepted
- Date: 2026-10-27
- Deciders: belmqadem (kaoutharrr to confirm in review: contract change)
- Context: display names were free text (1 to 50 characters) and not unique, so two "Ada"s looked alike in search and finding a friend meant telling them apart by the start of their id. The team wanted a unique name people find each other by, chosen by every account, whatever way it signed up.
- Options considered:
  - **What is unique**: a new `username` next to a free display name (like Instagram); or **the display name itself** (chosen by the team: one name, the real name stays in the profile's About).
  - **Rules**: free text unique ignoring case (look-alike Unicode letters can impersonate); or **handle rules** (chosen): 3 to 20 of `a-z`, `0-9`, `.` and `_`, starting with a letter, stored lowercase so "Ada", "ada" and "Ada " are one name.
  - **When**: in the register form (Google and Facebook would still need a separate step); or **after the first sign-in, for every way in** (chosen), and for existing accounts at their next sign-in.
  - **Enforcement**: only the app routes to the step; a database read on every request; or **a signed claim in the access token** (chosen): `dns: true` once the name is set. It costs nothing per request (the token is verified anyway) and covers the Socket.io handshake too. The app refreshes right after choosing to get a token with the claim. A token without the claim (older ones) counts as "not chosen", the safe default.
  - **Accounts without a name**: `display_name` NULL (every `UserSummary` would need a nullable name) or **a temporary name** `user_` + 12 hex digits of the id (chosen), with `display_name_set` false: lists keep working, search never shows it, and chosen names may not start with `user_`, so only two new accounts could collide (48 random bits; the unique index refuses it and OAuth sign-up retries).
- Decision:
  - `users.display_name_set` and a unique index on `lower(display_name)`. The rules are checked by the API (Zod), not by a database CHECK, so tests and old rows can hold other names; the API is the only way to choose one.
  - Register takes `{ email, password }` only. `PUT /users/me/display-name` chooses or changes the name: `409 DISPLAY_NAME_TAKEN` from the unique index (no "check then write": two people choosing one name at once cannot both get it, tested with 8 at once).
  - Until it is chosen, every bearer route and the live handshake answer `403 DISPLAY_NAME_REQUIRED`, except reading `/users/me`, choosing the name and signing out (a second authenticate with `allowWithoutDisplayName`).
  - The migration gives every existing account a temporary name; its old free-text name is not kept (it may break the rules or collide), and the down migration cannot restore it.
  - App: sign-up asks only email and password; a third route group, `(onboarding)`, holds "Pick your username" and is the only one open to a signed-in account without a name (no back, Sign out only). Settings has a Username row to change it. The app calls it **username**; the code and API keep `displayName`.
- Security: the claim is signed with the access-token secret, so a client cannot skip the step; the server answers 403 whatever the app shows. The name is the only thing the endpoint can change, and only for the caller (no user id in the path; unknown fields are 400).
- Consequences: one more step for every account once. Names can change, so anything that must stay stable (friends, invitations, owners) keeps using the id, as it already did. People search now finds one person per name.
- Tested: backend unit (rules, the claim, the middleware, the handshake) and integration (every state, case, simultaneous choice, change and freeing, search, OAuth sign-up); eight mutations of these rules each fail a test. App: the rules against the backend's own schema, save then refresh, the messages; on the Android emulator against a test database, sign-up, the step (rules, a taken name in other capitals, Back), the app opening, and a change from Settings.

### ADR-047: Google and Facebook credentials work once; Google ID tokens expire for us after 10 minutes

- Status: accepted
- Date: 2026-10-27
- Deciders: belmqadem (kaoutharrr to confirm in review)
- Context: a security check found that a captured provider credential could be replayed. `docs/security.md` said tokens older than 10 minutes were refused, but only Facebook Limited Login tokens were (ADR-032): a Google ID token was accepted for its whole life (about an hour), and a Facebook classic access token (Android, and iOS with tracking allowed) was checked with `debug_token` and accepted for as long as Facebook said it was valid, weeks for the SDK's long-lived tokens. The same credentials also serve as the `reauth` proof (ADR-025).
- Options considered:
  - **Age limit only**: `maxTokenAge` on Google like Limited Login. One line, but nothing for classic Facebook tokens, and a fresh token can still be replayed for 10 minutes.
  - **One-time use** (chosen, with the age limit): remember every accepted credential until it expires and refuse it the second time. Covers every provider and every use without changing the app or the contract's shape.
  - **A per-login nonce**: the textbook fix for ID tokens, but it changes the contract and both apps, and Facebook classic tokens carry no nonce, so one-time use would still be needed for them.
  - **Where to remember**: Redis (optional in this app, with an in-memory fallback that would not be shared between instances) or **Postgres** (chosen: always there, shared, and a primary key settles simultaneous uses).
- Decision: Google ID tokens: `maxTokenAge: "10m"`. Every verified credential is spent in `verifyWithProvider` (the one path for login, link and proof): `used_provider_credentials(credential_hash, expires_at)` with the SHA-256 of `provider:credential`, kept until the provider's expiry (a classic Facebook token: its `expires_at`, at most 90 days; 0 means "never" and gets the 90). A second use answers like a rejected credential (401, or 403 REAUTH_FAILED as a proof). Only verified credentials get a row, so garbage cannot fill the table; expired rows are deleted when a new one is spent. The spend happens before the rest of the request, so a credential stays spent even if the login then fails (`EMAIL_TAKEN`): the user signs in with the provider again.
- Not changed: access tokens stay valid until they expire (at most 15 minutes) after logout. A Redis deny-list would close it at the price of a read on every request and every socket handshake; ADR-003's stateless tokens are kept and the risk stays accepted in `docs/security.md`.
- Consequences: every login, link or proof needs a fresh credential from the SDK, which the app already does (it signs the SDK out right after taking a token, ADR-033). To check on devices: that Facebook hands out a new classic token at each sign-in after that sign-out. Tests: unit (the Google age limit, the Facebook expiry and its 90-day cap) and integration (a replayed login, 8 simultaneous uses with exactly one winner, a credential spent on login refused as a proof and the other way round, only hashes stored and never a refused credential, expired rows forgotten); four mutations each fail a test.

### ADR-048: Free and Premium: the Playlist Editor and "At the venue" rooms are paid

- Status: accepted
- Date: 2026-10-27
- Deciders: belmqadem, kaoutharrr (contract change: both review)
- Context: the subject's bonus asks for two offers, a free limited one and a paid one, a way to switch between them, and some features only on the paid one ("Music Playlist Editor for instance"). The mandatory part is closed.
- Options considered:
  - **What is paid**: the Playlist Editor only (the subject's example); or **the Playlist Editor and "At the venue" rooms** (chosen): two modules gated shows the rule is general, and Track Vote stays free where new people arrive (a friend invites you to a room).
  - **Payment**: a real provider (store billing, or Stripe test mode with keys and webhooks), or **simulated** (chosen): the subject asks for switching between offers, not for payments, and a real flow adds accounts and secrets to defend for nothing graded. The switch is an explicit, confirmed action, recorded like a purchase would be.
  - **Where the plan is checked**: in the access token (stale until refresh, as with ADR-046's claim) or **read from the database on the gated writes only** (chosen): a switch counts from the next request, and reads, by far the most frequent calls, cost nothing more.
  - **After a downgrade**: delete or hide what was made on Premium; or **keep everything, read-only for the free owner** (chosen), with Premium collaborators still able to edit and a free owner still able to shrink what they own (delete, remove invitations).
- Decision: `users.plan` (`free` default, `premium`) with `plan_changed_at`, and `plan_changes` logging every switch with the client's platform, device and app version (one locked transaction, so simultaneous switches log only what really changed). `PUT /users/me/plan`. `requirePremium` (access module) on creating a playlist, changing its settings, inviting to it, and adding, moving and removing its tracks; on creating a room with, or switching a room to, a `location_time` license. It runs after the visibility and permission checks, so a hidden playlist still answers 404. `403 PREMIUM_REQUIRED` otherwise.
- Security: the server decides on every request; the app only hides buttons. The plan cannot be set by any other route (strict bodies). A known window: a write whose plan check ran just before a downgrade can still complete; the next one is refused.
- App: Settings has a Plan row opening Plans (what each offer includes, the current one, the switch behind a confirm step that says payment is simulated). Where a Free user meets a Premium feature it is explained, not hidden: Create playlist opens Plans; a playlist its license lets you edit says "Editing playlists is Premium" with See Premium instead of Add track; picking "At the venue" when creating a room shows the same instead of the venue settings. Your profile shows a Premium badge. Editing in the app needs both the license (`myPermissions.canAct`) and the plan; the server checks both.
- Consequences: test users that create playlists or venue rooms are created on Premium. Tests: every gated route on Free and Premium, a downgrade with each kind of edit, a Premium collaborator after the owner's downgrade, what stays free (rooms, voting, deleting, removing invitations), the 404-before-403 order, an upgrade counting at once, the log and simultaneous switches; six mutations each fail a test.

### ADR-049: Offline mode: saved copies to read, playlist reorders and removals synced later

- Status: accepted
- Date: 2026-10-27
- Deciders: kaoutharrr (belmqadem to confirm in review)
- Context: the subject's bonus asks for an offline mode. The backend stays the single source of truth (CLAUDE.md), so "offline" cannot mean the phone deciding anything; it means showing what was last seen, and keeping what the user did until the server can judge it. App only: no backend or contract change.
- Options considered:
  - **Scope**: read-only copies everywhere; or **read-only copies plus offline playlist reorders and removals** (chosen). Adding needs the music catalog (search) and votes or suggestions only mean something live, so those stay online only.
  - **Knowing we are offline**: a network-status library (a native module, so a rebuild, and it says "Wi-Fi on", not "our server answers"); or **the requests themselves** (chosen): one that cannot reach the server marks the app offline, any answer marks it online, and while offline a `/health` ping every 8 seconds notices the server is back.
  - **Where to keep copies**: SecureStore (size-limited), SQLite (a schema to maintain for a cache), or **AsyncStorage, already installed** (chosen), one entry per screen under `offline:v1:`.
  - **An offline change the server no longer accepts** (the track it was to follow was removed, the track itself is gone, the playlist became private, the plan went back to Free): merge it locally, or **drop it and say so** (chosen): the server's version rule stays the only concurrency rule, and the user sees each change that was not applied, and why.
- Decision:
  - Copies: the first page of Rooms, Playlists and the Friends lists; a room's details and queue; a playlist's details and tracks; your profile; the signed-in user. Shown only when a call fails with `NETWORK_ERROR`, under a plain "You're offline." notice, and replaced by the server's answer as soon as it is back.
  - Starting offline: `restore()` opens the app signed in on the saved user instead of the sign-in screen. There is no access token then; the first call that reaches the server gets one with the stored refresh token first. A refresh the server refuses (401) still signs out, as before.
  - Outbox (`src/offline/outbox.ts`): reorders and removals made offline (or whose request could not reach the server) are queued in order, shown at once on the saved list, and kept across restarts. Once online they are sent one at a time, in order, through the normal endpoints, so every check (authentication, license, Premium) runs again. Each answer is applied, dropped with a reason, or (offline again, rate limited, server error) kept with everything after it for the next try. A removal of a track already gone counts as done. Afterwards the playlist is read again from the server.
- Security: the private profile block (phone, birth date) is never saved (`offlineProfile`, tested). No token is added to storage: the refresh token stays in SecureStore as before. Sign-out wipes every offline key and pending change, even offline. Copies are plain AsyncStorage, readable on a rooted phone, like any app cache: only what the user was already shown, minus the private block. An offline change gets no more rights than an online one: the server judges it when it arrives.
- Consequences: a change made offline can be refused later, and the user is told. Pending changes are lost if the user signs out before they sync. Lists show only their first page offline. Tests: connectivity, the store, `applyPending`, the outcome of every answer, the outbox (order, stop and keep, one sync at a time, restarts), the offline start in the auth controller, and the profile without its private block. On the Android emulator with the server cut off: offline start, each saved screen, a reorder and a removal offline, the sync with a move dropped because another user removed its anchor, Add track off, and sign-out leaving nothing behind.

### ADR-050: The web version: the same app in a centered column, email and password only

- Status: accepted
- Date: 2026-10-27
- Deciders: kaoutharrr (belmqadem to confirm in review)
- Context: the subject's multi-platform bonus asks to make the service available on the web and "responsive" to any screen size. The app is built with Expo, whose web target compiles the same code, and the backend was already ready for it: it accepts the `web` platform in its logging headers and lets in browser calls only from the exact addresses in `ALLOWED_ORIGINS`.
- Options considered:
  - **Layout on wide screens**: a centered column only (chosen); or the column plus a side bar instead of the tab bar and two columns on large screens. The column already keeps every screen readable from a phone to a desktop, with one rule in one place. The richer layout would roughly double the work and the screens to test, for a bonus judged on adapting to the screen size.
  - **Social sign-in on the web**: email and password only (chosen); Google only; or both. The web flows need each provider's web setup, and Facebook needs HTTPS outside localhost. Email and password already gives full access, so the web adds no new way to sign in and nothing to change in the auth flow.
  - **Where it runs**: locally (chosen): `make web`, at the address already allowed. Deploying it would mean hosting and securing one more thing for nothing graded.
- Decision:
  - A `maxWidth.content` token of 640 px, in `design-tokens.extensions.json`; the generator turns it into `max-w-content`. The root layout puts the whole app in one centered column of that width. Phones are narrower, so nothing changes there. A tablet or a browser window gets the column, with the canvas around it. The track search sheet, a modal drawn outside that column, centers itself the same way.
  - Fixes found by using the app in a browser:
    - A screen opened by its address (a link, or a refresh) now has the tabs under it (`initialRouteName`), so its back button leads home instead of disappearing.
    - The brand header no longer nests two headings, which is invalid HTML.
    - The logo and the welcome picture are sized by a wrapper view (the picture's also clips it), because on the web an image's own size beats its className: the picture ran past the column.
  - Logging: the web has no device model, so the browser stands in for it (`X-Device: Chrome on macOS`, from the user agent). The every-action logging rule holds on the web too.
- Security: no check changes. A browser can call the API only from an allowed address, and the server checks every request as before. The user agent is used for logging only, like every client header, and the backend still filters its characters. Tokens on the web are kept as before, in the web storage with a refresh lock across tabs. Sign-out clears them and every offline copy (ADR-049).
- Consequences: Google and Facebook buttons stay hidden on the web. "At the venue" uses the browser's location prompt, or coordinates typed by hand. Tests: the column token (its value, the CSS it produces, a refused unit) and the device name for every common browser and system. In Chrome against the dev backend: every tab, a room live, a playlist with Add track, About me, Plans with both switches logged as `web` / `Chrome on macOS`, a screen opened by its address, phone (390 px) and tablet (820 px) widths, and sign-out. On the Android emulator: unchanged.

### ADR-051: The app's name in the brand gradient, Ember to Chartreuse

- Status: accepted
- Date: 2026-10-27
- Deciders: kaoutharrr (belmqadem to confirm in review)
- Context: a brand spec for the header's "Music Room": Syne 800, letter spacing -0.03em, a left-to-right gradient from Electric Ember (#FF5A36) to High-Voltage Chartreuse (#C8FF00). DESIGN.md rule 4 keeps Chartreuse for live content only and forbids it as a decorative color. Gradient text is plain CSS on the web, but Android and iOS cannot clip a gradient to text.
- Options considered:
  - **The Chartreuse rule**: keep it (solid Ember title, or no change); or **allow the gradient on the app's name only, as a written exception** (chosen). The brand mark's rings already use both colors, and one documented exception keeps the rule defensible: Chartreuse still means "live" everywhere else.
  - **On phones**: gradient on the web only, solid elsewhere (no new library, but the app would look different per platform); or **the gradient everywhere** (chosen). That needs `expo-linear-gradient` and `@react-native-masked-view/masked-view`, both native, so the dev builds were rebuilt once.
  - **Size**: hero (32 px, an existing token); or **26 px, as before** (chosen), so the header band keeps its height. That needs one new text style.
- Decision:
  - A `brandTitle` text style (26 px, line height 32, Syne 800, -0.03em) in `design-tokens.extensions.json`. The generator now accepts text styles there, refusing a name that already exists or a weight that is not loaded, as it does for colors.
  - `BrandTitle` draws it:
    - on the web, a CSS gradient clipped to the text (`bg-linear-to-r from-ember to-chartreuse bg-clip-text`, transparent text);
    - on Android and iOS, a `LinearGradient` masked by the text (`MaskedView`), with an invisible copy of the text giving the gradient its size.
  - The colors come from the tokens (`colors.ember`, `colors.chartreuse`), never as values in the code. DESIGN.md rule 4 names the exception.
- Accessibility: the title stays one heading read as "Music Room". On phones, the MaskedView carries the heading role and the label; the mask and the invisible copy are not read twice.
- Consequences: two native dependencies, installed from the lockfile like every other. npm 11 pruned other platforms' optional packages from the lockfile when adding them, which `npm ci` then refused, so the lockfile change was limited to the two new packages and checked with `npm ci`. MaskedView's Android support is marked experimental by Expo; it was checked on the emulator. Tests: the new text style and both refusals. On the web (Chrome) and the Android emulator: the title in the gradient.

## Still to decide (record each as an ADR)

TODO:

- Location+time license: radius limits, accuracy rules, recurring vs one-off window
- Scaffold choices worth defending: no npm workspaces (shared types are type-only via a path alias), node-pg-migrate with a raw `pg` driver (no ORM), Vitest + supertest, pino logger, zod env validation, hand-written OpenAPI, zero-dependency commit-msg hook
