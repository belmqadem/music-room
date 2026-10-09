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
- Consequences: security-critical code (token issue/verify/rotate, password hashing) needs the most tests, including denied cases. Exact lifetimes and the signing algorithm are still TODO.

### ADR-004: Room access model: two flags + per-member roles

- Status: accepted
- Date: 2026-10-09
- Deciders: belmqadem
- Context: the subject requires public/private visibility and open/restricted permissions; the README promises control over who votes, who edits, and who controls playback. One engine must serve both Track Vote and Playlist Editor.
- Options considered:
  - Two flags + per-member roles: `visibility` and `permission` on the room, members hold a role (owner, editor, voter, listener) that maps to a license (canVote, canEdit, canControlPlayback). More tables and rules to test.
  - Two flags + invite list only: smallest model, but cannot express "can vote but not edit" or delegating playback.
  - Full ACL per room and action: most flexible, but a large permission matrix that is easy to leave a hole in and hard to defend.
- Decision: two flags + per-member roles. The exact rules are in `docs/api-contract.md` ("Access rules").
- Consequences: all authorization goes through one function (room + user -> license), tested exhaustively.

### Still to decide (record each as an ADR)

TODO:

- Concurrency strategy: simultaneous votes
- Concurrency strategy: simultaneous playlist edits
- OAuth flow for the mobile app (provider(s), authorization-code + PKCE)
- Token lifetimes, JWT signing algorithm, password hashing algorithm
- Load-test tool
- Scaffold choices worth defending: no npm workspaces (shared types are type-only via a path alias), node-pg-migrate with a raw `pg` driver (no ORM), Vitest + supertest, pino logger, zod env validation, hand-written OpenAPI, zero-dependency commit-msg hook
