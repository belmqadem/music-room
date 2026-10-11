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
- Consequences: the scaffold's `rooms` module becomes this shared access engine (a rename is a follow-up). The location+time license adds a trust problem: coordinates come from the client and can be faked (see `docs/security.md`). A user's own `canVote`/`canEdit` shown in the app is a UI hint; the backend re-checks on every request.

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

## Still to decide (record each as an ADR)

TODO:

- Music catalog: which provider supplies tracks (the backend resolves metadata from a track id; the client does not send titles)
- What "playing" means for Track Vote: who advances the queue and how a track moves from queued to played
- Location+time license: radius limits, accuracy rules, recurring vs one-off window
- Load-test tool
- Scaffold choices worth defending: no npm workspaces (shared types are type-only via a path alias), node-pg-migrate with a raw `pg` driver (no ORM), Vitest + supertest, pino logger, zod env validation, hand-written OpenAPI, zero-dependency commit-msg hook
