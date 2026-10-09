# API Contract

> Changes to this file or `shared/types/` need review from **both** developers: the
> backend and the mobile app are built against it.
>
> Status legend: **Decided** = recorded in `docs/architecture-decisions.md`.
> **Proposed** = drafted, needs an explicit yes from both developers. **TODO** = not designed yet.

## Conventions

| Topic          | Rule                                                                                                                  | Status   |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| Style / format | REST + JSON, UTF-8, camelCase keys (ADR-001, ADR-002)                                                                 | Decided  |
| Base path      | `/api/v1/...`. `/health` and `/docs` are unversioned.                                                                 | Proposed |
| IDs            | UUID strings (v4), never sequential integers (not guessable)                                                          | Proposed |
| Timestamps     | ISO 8601 UTC strings, e.g. `2026-10-09T12:00:00Z`                                                                     | Proposed |
| Pagination     | Lists take `?limit=` (default 20, max 100) and `?cursor=`; respond `{ "items": [...], "nextCursor": string \| null }` | Proposed |
| Unknown fields | Request bodies are validated strictly; unknown fields are rejected with `400 VALIDATION_ERROR`                        | Proposed |
| Success bodies | The resource itself (no `{ "data": ... }` envelope); lists use the shape above                                        | Proposed |

### Errors

Every error response has this body (type `ApiError` in `shared/types`):

```json
{ "error": { "code": "ROOM_NOT_FOUND", "message": "Room not found.", "details": null } }
```

- `code` is a stable, machine-readable string the app can switch on; `message` is for humans and may change.
- `details` is optional extra data (e.g. which fields failed validation).
- Error messages never include internals (stack traces, SQL, whether an email exists).

| HTTP | Meaning                                                 | Example codes                      |
| ---- | ------------------------------------------------------- | ---------------------------------- |
| 400  | Malformed or invalid request                            | `VALIDATION_ERROR`                 |
| 401  | Not authenticated (missing/expired/invalid token)       | `UNAUTHENTICATED`, `TOKEN_EXPIRED` |
| 403  | Authenticated and allowed to see it, but not to do this | `FORBIDDEN`                        |
| 404  | Does not exist **or you may not know it exists**        | `ROOM_NOT_FOUND`                   |
| 409  | Conflicts with current state                            | `EMAIL_TAKEN`, `ALREADY_MEMBER`    |
| 429  | Rate limited                                            | `RATE_LIMITED`                     |

### Required client headers

Every request from the mobile app carries `X-Platform` (`ios` \| `android` \| `web`), `X-Device` (model name or
`unknown`) and `X-App-Version`. The backend logs them for every mobile-triggered action. They are for logging,
never for authorization decisions (a client can send anything).

## Authentication (Decided: ADR-003)

- `Authorization: Bearer <accessToken>` on every endpoint except those marked _public_.
- Access token: short-lived JWT. Refresh token: opaque, rotated on every use; reusing an old one revokes the
  whole token family. Lifetimes and signing algorithm: **TODO** (ADR pending).
- The same access token authenticates the Socket.io handshake (`auth: { token }`).

`AuthSession` (returned by register, login, refresh, OAuth): `{ accessToken, refreshToken, expiresIn, user }`
where `expiresIn` is seconds until the access token expires.

| Method | Path                     | Auth   | Purpose                                    | Success           | Errors                                    |
| ------ | ------------------------ | ------ | ------------------------------------------ | ----------------- | ----------------------------------------- |
| POST   | `/auth/register`         | public | Create account with email + password       | 201 `AuthSession` | 400, 409 `EMAIL_TAKEN`                    |
| POST   | `/auth/login`            | public | Email + password login                     | 200 `AuthSession` | 400, 401 `INVALID_CREDENTIALS`, 429       |
| POST   | `/auth/refresh`          | public | Exchange a refresh token for a new session | 200 `AuthSession` | 401 `INVALID_REFRESH_TOKEN`               |
| POST   | `/auth/logout`           | bearer | Revoke the given refresh token family      | 204               | 401                                       |
| POST   | `/auth/oauth/{provider}` | public | Log in / sign up with an OAuth provider    | 200 `AuthSession` | 400, 401 — **TODO**: provider(s) and flow |
| GET    | `/users/me`              | bearer | The signed-in user                         | 200 `User`        | 401                                       |

- `INVALID_CREDENTIALS` is the same response for an unknown email and a wrong password (no account enumeration).
  Login is rate limited (**Proposed**).
- Passwords: minimum length and hashing algorithm **TODO** (ADR pending). The password is never returned or logged.

## Access rules (Decided: ADR-004; details Proposed)

A room has two flags and each member has a role.

- `visibility`: `public` or `private`
- `permission`: `open` or `restricted`
- `role`: `owner`, `editor`, `voter` or `listener`

### Roles and licenses

A **license** is what a user may do in a room. It is derived from role (and flags), never sent by the client.

| Role     | canVote | canEdit | canControlPlayback | Manage members/settings |
| -------- | ------- | ------- | ------------------ | ----------------------- |
| owner    | yes     | yes     | yes                | yes                     |
| editor   | yes     | yes     | no                 | no                      |
| voter    | yes     | no      | no                 | no                      |
| listener | no      | no      | no                 | no                      |

"Viewing" the room (its details, queue and playlist) is separate: it requires being allowed to **see** it (below).

### Who can see a room

| visibility | Who can see it                                                         | Everyone else gets                                |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| public     | any authenticated user (appears in `GET /rooms`)                       | —                                                 |
| private    | its members (owner, or invited users who accepted/joined). Not listed. | `404 ROOM_NOT_FOUND`, same as if it did not exist |

### Effective license of a user in a room

1. If the user is a **member**: the license of their role — except that in an `open` room nobody is below `editor`
   (roles only differentiate members in `restricted` rooms). The `owner` is always the owner.
2. If the user is **not a member** but can see the room (public only): `open` -> `editor` license; `restricted` -> `listener`.
3. Otherwise: no access (`404`).

`canControlPlayback` is owner-only in this first version (delegating playback is a possible later extension).

> **Open question for both developers:** is "open" meant to include edit rights for anyone who can see the room,
> or only voting? This draft says voting **and** editing. Needs a decision before Track Vote / Playlist Editor.

## Rooms

All endpoints are bearer-authenticated. Every one checks authorization against the room (not just "is logged in").

| Method | Path                               | Who may call it                      | Purpose                                            | Success                  | Errors                        |
| ------ | ---------------------------------- | ------------------------------------ | -------------------------------------------------- | ------------------------ | ----------------------------- |
| POST   | `/rooms`                           | any authenticated user               | Create a room (caller becomes owner)               | 201 `Room`               | 400                           |
| GET    | `/rooms`                           | any authenticated user               | Paginated list: public rooms + rooms you belong to | 200 page of `Room`       | —                             |
| GET    | `/rooms/{roomId}`                  | anyone who can see the room          | Room details incl. your role and license           | 200 `Room`               | 404                           |
| PATCH  | `/rooms/{roomId}`                  | owner                                | Change name, visibility, permission                | 200 `Room`               | 400, 403, 404                 |
| DELETE | `/rooms/{roomId}`                  | owner                                | Delete the room                                    | 204                      | 403, 404                      |
| POST   | `/rooms/{roomId}/join`             | anyone who can see a **public** room | Become a member                                    | 200 `RoomMember`         | 404, 409 `ALREADY_MEMBER`     |
| POST   | `/rooms/{roomId}/leave`            | a non-owner member                   | Stop being a member                                | 204                      | 404, 403 (owner cannot leave) |
| GET    | `/rooms/{roomId}/members`          | anyone who can see the room          | Paginated member list                              | 200 page of `RoomMember` | 404                           |
| POST   | `/rooms/{roomId}/invites`          | owner                                | Invite a user (by `userId`) with a role            | 201 `RoomMember`         | 400, 403, 404, 409            |
| PUT    | `/rooms/{roomId}/members/{userId}` | owner                                | Change a member's role                             | 200 `RoomMember`         | 400, 403, 404                 |
| DELETE | `/rooms/{roomId}/members/{userId}` | owner                                | Remove a member                                    | 204                      | 403, 404                      |

Notes:

- Invites are **Proposed** as immediate membership (no accept step) to keep scope small; revisit if needed.
- `PATCH /rooms/{roomId}` changing visibility to `private` does not remove existing members.
- A 403 means "you can see this room but may not do that"; a 404 means "no such room, as far as you may know".
  Never return 403 for a private room the caller cannot see (it would confirm the room exists).

## Track Vote

**TODO** — blocked on the concurrency decision for simultaneous votes. Placeholder in `shared/types/src/vote.ts`.

## Playlist Editor

**TODO** — blocked on the concurrency decision for simultaneous edits. Placeholder in `shared/types/src/playlist.ts`.

## Real-time events (Socket.io, namespace `/live`)

- The handshake carries the access token; the server verifies it and rejects the connection otherwise.
  (The namespace currently refuses every connection until this is implemented.)
- A client joins a room's channel only if the effective license rules above allow viewing it.
- Event names and payloads: **TODO** (depends on Track Vote and Playlist Editor).

## Changelog

| Date       | Change                                              | Author    | Reviewed by |
| ---------- | --------------------------------------------------- | --------- | ----------- |
| 2026-10-09 | First draft: conventions, auth, access rules, rooms | belmqadem | pending     |
