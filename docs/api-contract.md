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
| Timestamps     | ISO 8601 UTC strings, e.g. `2026-10-09T16:00:00Z`                                                                     | Proposed |
| Pagination     | Lists take `?limit=` (default 20, max 100) and `?cursor=`; respond `{ "items": [...], "nextCursor": string \| null }` | Proposed |
| Unknown fields | Request bodies are validated strictly; unknown fields are rejected with `400 VALIDATION_ERROR`                        | Proposed |
| Success bodies | The resource itself (no `{ "data": ... }` envelope); lists use the shape above                                        | Proposed |

### Errors

Every non-2xx response has this body (type `ApiError`):

```json
{ "error": { "code": "EVENT_NOT_FOUND", "message": "Event not found.", "details": null } }
```

- `code` is stable and machine-readable; `message` is for humans and may change.
- `details` is optional extra data (e.g. failed fields, or the existing track on `TRACK_ALREADY_QUEUED`).
- Messages never include internals (stack traces, SQL, whether an email exists).

| HTTP | Meaning                                                      | Codes                                                                                                                                             |
| ---- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | Malformed or invalid request                                 | `VALIDATION_ERROR`, `LOCATION_REQUIRED`                                                                                                           |
| 401  | Not authenticated                                            | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`, `INVALID_PROVIDER_CREDENTIAL`                                 |
| 403  | You can see it, but may not do this                          | `FORBIDDEN`, `NOT_INVITED`, `OUTSIDE_VOTING_AREA`, `OUTSIDE_VOTING_TIME`                                                                          |
| 404  | Does not exist **or you may not know it exists**             | `EVENT_NOT_FOUND`, `PLAYLIST_NOT_FOUND`, `TRACK_NOT_FOUND`, `NOT_FOUND` (unknown route)                                                           |
| 409  | Conflicts with current state                                 | `EMAIL_TAKEN`, `PROVIDER_ACCOUNT_LINKED`, `LAST_LOGIN_METHOD`, `ALREADY_INVITED`, `TRACK_ALREADY_QUEUED`, `TRACK_NOT_VOTABLE`, `ANCHOR_NOT_FOUND` |
| 429  | Rate limited                                                 | `RATE_LIMITED`                                                                                                                                    |
| 502  | The social provider could not be reached or answered badly   | `PROVIDER_UNAVAILABLE`                                                                                                                            |
| 500  | Unexpected server error (details are logged, never returned) | `INTERNAL_ERROR`                                                                                                                                  |

### Required client headers

Every request from the app carries `X-Platform` (`ios` \| `android` \| `web`), `X-Device` (model or `unknown`) and
`X-App-Version`. The backend logs them for every mobile-triggered action. They are for logging only, never for
authorization (a client can send anything). A missing or malformed header is logged as `unknown` and never
rejects the request; values are stripped of unsafe characters and capped at 64 characters.

## Web client (Decided: ADR-012)

- The API only answers browsers from the origins in the server's `ALLOWED_ORIGINS`. A web app served from another
  origin fails in the browser with a CORS error, not an API error. Tell the backend owner the origin to add.
- Allowed request headers: `Authorization`, `Content-Type`, `X-Platform`, `X-Device`, `X-App-Version`. Methods: GET,
  POST, PUT, PATCH, DELETE. Cookies are not used and credentialed requests are not allowed.
- The web build sends `X-Platform: web`.
- **Refresh with several tabs open:** refresh tokens are single-use (ADR-010). Two tabs refreshing with the same token
  revoke the session. The web client must let only one tab refresh at a time (for example `navigator.locks`), and
  other tabs read the new token afterwards.
- The web build should send a strict Content-Security-Policy and never render untrusted HTML, because a script
  injected into the page could read the stored refresh token (see `docs/security.md`).

## Authentication (Decided: ADR-003, ADR-006, ADR-007)

- `Authorization: Bearer <accessToken>` on every endpoint except those marked _public_.
- Access token: JWT, 15 minutes, HS256. Refresh token: opaque, 7 days, rotated on every use; reusing an old one
  revokes the whole family. The same access token authenticates the Socket.io handshake.
- The app keeps the access token in memory only. The refresh token goes in secure storage on mobile (keychain /
  keystore). On web there is no secure storage, so it goes in browser storage and is sent in the request body, exactly
  like on mobile (ADR-012); see "Web client" below.

`AuthSession` (returned by register, login, refresh, OAuth login): `{ accessToken, refreshToken, expiresIn, user }`;
`expiresIn` is seconds until the access token expires.

| Method | Path                             | Auth   | Purpose                                                               | Success                   | Errors                                       |
| ------ | -------------------------------- | ------ | --------------------------------------------------------------------- | ------------------------- | -------------------------------------------- |
| POST   | `/auth/register`                 | public | Create an account with email + password                               | 201 `AuthSession`         | 400, 409 `EMAIL_TAKEN`                       |
| POST   | `/auth/login`                    | public | Email + password login                                                | 200 `AuthSession`         | 400, 401 `INVALID_CREDENTIALS`, 429          |
| POST   | `/auth/oauth/{provider}`         | public | Sign up or log in with Google or Facebook                             | 200 `AuthSession`         | 400, 401, 409 `EMAIL_TAKEN`, 429, 502        |
| POST   | `/auth/refresh`                  | public | Exchange a refresh token for a new session (body: `{ refreshToken }`) | 200 `AuthSession`         | 401 `INVALID_REFRESH_TOKEN`                  |
| POST   | `/auth/logout`                   | bearer | Revoke the session of `{ refreshToken }` (always 204)                 | 204                       | 401                                          |
| GET    | `/users/me`                      | bearer | The signed-in user, incl. linked providers                            | 200 `User`                | 401                                          |
| GET    | `/users`                         | bearer | Search users by display name prefix (`?query=`, see Finding users)    | 200 page of `UserSummary` | 400, 401, 429                                |
| POST   | `/users/me/providers/{provider}` | bearer | Link a Google/Facebook account to this account                        | 200 `User`                | 400, 401, 409 `PROVIDER_ACCOUNT_LINKED`, 502 |
| DELETE | `/users/me/providers/{provider}` | bearer | Unlink a provider                                                     | 200 `User`                | 404, 409 `LAST_LOGIN_METHOD`                 |

- `{provider}` is `google` or `facebook`. The OAuth body is `{ "credential": string }`: Google ID token or Facebook
  access token, obtained by the app from the provider. **The backend verifies it with the provider**; it never trusts
  an identity the client merely claims.
- **No automatic linking by email.** If the provider's email matches an existing account, the backend answers
  `409 EMAIL_TAKEN`; the user logs in and links from settings (otherwise an unverified provider email could take over
  an account).
- **OAuth login (ADR-011)** `POST /auth/oauth/{provider}`:
  - the provider confirms the credential, giving a stable provider user id, a name and maybe an email;
  - if that provider account is already linked, the linked user logs in (`200 AuthSession`);
  - otherwise, if the provider's **verified** email matches an existing account, `409 EMAIL_TAKEN` (no linking);
  - otherwise a new social-only account is created (no password; `email` may be `null`) and logged in.
    A Google email counts only when Google marks it verified. Facebook emails are ignored for the match
    (Facebook does not guarantee they are verified), so a Facebook account never triggers `EMAIL_TAKEN` and is stored
    with `email: null` unless we later decide otherwise.
- Provider failures: a credential the provider rejects (bad signature, expired, wrong app) is
  `401 INVALID_PROVIDER_CREDENTIAL`, always the same message. If the provider cannot be reached, `502
PROVIDER_UNAVAILABLE`; the app may retry later. Both are logged without the credential.
- **Link** `POST /users/me/providers/{provider}`: same body, bearer required. `409 PROVIDER_ACCOUNT_LINKED` if that
  provider account belongs to anyone (including this user), or this user already has that provider linked.
  **Unlink** `DELETE ...`: `404` if that provider is not linked, `409 LAST_LOGIN_METHOD` if it is the only login
  method left (a user has a login method per linked provider, plus one if they have a password).
- OAuth login shares the login rate limit (per IP, 10 per 15 minutes).
- A user always keeps at least one login method; unlinking the last one is `409 LAST_LOGIN_METHOD`.
- `INVALID_CREDENTIALS` is identical for an unknown email and a wrong password. Passwords: 8 to 72 bytes (longer
  is rejected, not truncated), bcrypt cost 12 (ADR-006). The password is never returned or logged.
- Login and register are rate limited (**Proposed**): 10 attempts per 15 minutes (login) and 10 per hour (register) per IP; refresh allows 100 per 15 minutes.
- **Refresh rotation (strict, ADR-010):** every refresh consumes the presented token and returns a new one in the same session. Presenting a token that was already used revokes the whole session, so the user must log in again. Consequence for the app: **never send the same refresh token twice**; do not retry a refresh request after a network timeout. Reconnect and log in if it fails. All refresh failures return the same `401 INVALID_REFRESH_TOKEN`.
- **Logout** always answers `204` (also for unknown tokens, or a token of another user, which is not revoked). It does not cancel the current access token, which stays valid until it expires (at most 15 minutes).

## Finding users (Decided: ADR-013)

To invite someone, the app needs their id. `GET /users?query=ada` (bearer) returns `Page<UserSummary>`, where
`UserSummary` is `{ id, displayName }` and **nothing else**: never an email or linked providers.

- The search is a case-insensitive **prefix** match on the display name. `query` is trimmed and must be at least 3
  characters, otherwise `400 VALIDATION_ERROR`. The caller is not in their own results.
- Results are ordered by display name, then id, and paginated like every list (`limit` default 20).
- Display names are not unique: show the results so the user can tell them apart, and invite by `id`.
- Rate limited (`429 RATE_LIMITED`), so the user directory cannot be walked quickly.
- An invitation's `user` is also a `UserSummary`: the owner never sees an invitee's email.

## Access rules (Decided: ADR-005)

Both resources, **Event** (Track Vote) and **Playlist** (Playlist Editor), follow the same rules.

- Each has an **owner** (its creator), a `visibility`, and an **invitation list**.
- `visibility`: `public` (default) or `private`.
- The owner can always do everything on their own resource, including managing invitations and settings.
- An **invited user** is anyone on the invitation list. Invitations take effect immediately (**Proposed**: no
  accept step).

### Who can see it

| visibility | Who can see it                                                 | Everyone else                                      |
| ---------- | -------------------------------------------------------------- | -------------------------------------------------- |
| public     | any authenticated user (listed in `GET /events`, `/playlists`) | —                                                  |
| private    | the owner and invited users (listed for them only)             | `404`, identical to a resource that does not exist |

### Who can act (license)

The license applies to people who can already see the resource.

| Resource | License         | Default | Who may vote/suggest (event) or edit (playlist)                                                                                           |
| -------- | --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Event    | `everyone`      | yes     | anyone who can see the event                                                                                                              |
| Event    | `invited_only`  |         | the owner and invited users; others get `403 NOT_INVITED`                                                                                 |
| Event    | `location_time` |         | anyone who can see the event **and** is within `radiusMeters` of the event's point **and** the server time is within `startsAt`..`endsAt` |
| Playlist | `everyone`      | yes     | anyone who can see the playlist                                                                                                           |
| Playlist | `invited_only`  |         | the owner and invited users; others get `403 NOT_INVITED`                                                                                 |

- Suggesting a track and voting are both "voting" for the license check.
- **Viewing is separate from acting**: in a public event with license `invited_only`, everyone can view, only
  invited users can vote.
- `location_time`: the app sends its coordinates with the vote/suggestion; the server computes the distance
  (it never trusts a "I am inside" flag) and compares times with **its own clock**. Failures:
  `400 LOCATION_REQUIRED`, `403 OUTSIDE_VOTING_AREA`, `403 OUTSIDE_VOTING_TIME`. Coordinates can still be faked by
  the client; see `docs/security.md`.
  - Send `accuracyMeters` with the position. A position without it, or worse than **100 m**, is `LOCATION_REQUIRED`
    (the app should ask for a better fix).
  - The time window is `startsAt` (included) to `endsAt` (excluded). A position exactly on the radius counts as inside.
  - The server checks the time first: outside the window the answer is `OUTSIDE_VOTING_TIME` even without a location.
  - An invitation does not skip the place and time rule. The owner is never restricted by it.
- `myPermissions` on a resource (`canView`, `canAct`, `canManage`) is a **UI hint**. For `location_time`, `canAct`
  means "eligible if you are in the right place and time". The backend checks everything again on every request.

## Events (Track Vote)

All endpoints are bearer-authenticated and check the access rules above on every call.

| Method | Path                                      | Who may call it        | Purpose                                             | Success                  | Errors                                    |
| ------ | ----------------------------------------- | ---------------------- | --------------------------------------------------- | ------------------------ | ----------------------------------------- |
| POST   | `/events`                                 | any authenticated user | Create an event (caller is owner)                   | 201 `MusicEvent`         | 400                                       |
| GET    | `/events`                                 | any authenticated user | Page of events you can see (public + yours/invited) | 200 page of `MusicEvent` | —                                         |
| GET    | `/events/{eventId}`                       | anyone who can see it  | Event details incl. `myPermissions`                 | 200 `MusicEvent`         | 404                                       |
| PATCH  | `/events/{eventId}`                       | owner                  | Change name, visibility, vote license               | 200 `MusicEvent`         | 400, 403, 404                             |
| DELETE | `/events/{eventId}`                       | owner                  | Delete the event                                    | 204                      | 403, 404                                  |
| GET    | `/events/{eventId}/invitations`           | owner                  | List invited users                                  | 200 page of `Invitation` | 403, 404                                  |
| POST   | `/events/{eventId}/invitations`           | owner                  | Invite a user                                       | 201 `Invitation`         | 400, 403, 404, 409 `ALREADY_INVITED`      |
| DELETE | `/events/{eventId}/invitations/{userId}`  | owner                  | Remove an invitation                                | 204                      | 403, 404                                  |
| GET    | `/events/{eventId}/tracks`                | anyone who can see it  | The queue, **already ordered** (see Ranking)        | 200 `EventTrack[]`       | 404                                       |
| POST   | `/events/{eventId}/tracks`                | anyone allowed to act  | Suggest a track (counts as your vote)               | 201 `EventTrack`         | 400, 403, 404, 409 `TRACK_ALREADY_QUEUED` |
| PUT    | `/events/{eventId}/tracks/{trackId}/vote` | anyone allowed to act  | Vote for a track (**idempotent**)                   | 200 `EventTrack`         | 400, 403, 404, 409 `TRACK_NOT_VOTABLE`    |
| DELETE | `/events/{eventId}/tracks/{trackId}/vote` | anyone allowed to act  | Withdraw your vote (**idempotent**)                 | 200 `EventTrack`         | 403, 404, 409 `TRACK_NOT_VOTABLE`         |

- Request bodies: `CreateEventRequest`, `UpdateEventRequest`, `InviteRequest` (`{ userId }`),
  `SuggestTrackRequest` (`{ providerTrackId, location? }`, `location` is a `GeoPoint`), `VoteRequest` (`{ location? }`, only needed when the
  license is `location_time`). The backend looks up title and artist from the music catalog itself; the client sends
  only the track id (**TODO** catalog provider).
- A user has at most one vote per track, and may vote for several tracks.
- **Listing** (`GET /events`): public events, your own, and private events you are invited to, newest first. `limit`
  is 1 to 100 (default 20); `nextCursor` is opaque, pass it back as `?cursor=` and never build one. A bad `limit` or
  `cursor` is `400 VALIDATION_ERROR`.
- **Changing an event** (`PATCH`): send at least one of `name`, `visibility`, `voteLicense`. A new `voteLicense`
  **replaces** the whole license (send all `location_time` fields again). It takes effect immediately; votes already
  cast stay. Unknown fields (`ownerId`, `id`, ...) are `400`.
- `GET /events/{id}`: a private event you may not see is `404 EVENT_NOT_FOUND`, identical to a missing one. Anyone who
  can see an event but is not its owner gets `403 FORBIDDEN` on `PATCH`, `DELETE` and the invitation endpoints.

### Ranking and concurrency (Decided: ADR-008)

- Order: most votes first; ties: oldest suggestion first. The server returns the queue already ordered; clients do
  not re-sort.
- Voting twice for the same track, or two devices of one user voting at once, counts once (`PUT` is idempotent).
- Many users voting at the same moment never lose votes; counts are exact.
- Two people suggesting the same track at once: one gets `201`, the other `409 TRACK_ALREADY_QUEUED` with the
  existing track in `details`, so the app can vote for it instead.
- Voting on a track that already started playing or was removed: `409 TRACK_NOT_VOTABLE`.

## Playlists (Playlist Editor)

| Method | Path                                            | Who may call it        | Purpose                                             | Success                  | Errors                                |
| ------ | ----------------------------------------------- | ---------------------- | --------------------------------------------------- | ------------------------ | ------------------------------------- |
| POST   | `/playlists`                                    | any authenticated user | Create a playlist (caller is owner)                 | 201 `Playlist`           | 400                                   |
| GET    | `/playlists`                                    | any authenticated user | Page of playlists you can see                       | 200 page of `Playlist`   | —                                     |
| GET    | `/playlists/{playlistId}`                       | anyone who can see it  | Playlist details incl. `myPermissions`              | 200 `Playlist`           | 404                                   |
| PATCH  | `/playlists/{playlistId}`                       | owner                  | Change name, visibility, edit license               | 200 `Playlist`           | 400, 403, 404                         |
| DELETE | `/playlists/{playlistId}`                       | owner                  | Delete the playlist                                 | 204                      | 403, 404                              |
| GET    | `/playlists/{playlistId}/invitations`           | owner                  | List invited users                                  | 200 page of `Invitation` | 403, 404                              |
| POST   | `/playlists/{playlistId}/invitations`           | owner                  | Invite a user                                       | 201 `Invitation`         | 400, 403, 404, 409 `ALREADY_INVITED`  |
| DELETE | `/playlists/{playlistId}/invitations/{userId}`  | owner                  | Remove an invitation                                | 204                      | 403, 404                              |
| GET    | `/playlists/{playlistId}/tracks`                | anyone who can see it  | Ordered tracks + current `version`                  | 200 `PlaylistSnapshot`   | 404                                   |
| POST   | `/playlists/{playlistId}/tracks`                | anyone allowed to edit | Add a track (end of list, or after an anchor)       | 201 `PlaylistSnapshot`   | 400, 403, 404, 409 `ANCHOR_NOT_FOUND` |
| POST   | `/playlists/{playlistId}/tracks/{entryId}/move` | anyone allowed to edit | Move an entry after another entry (or to the start) | 200 `PlaylistSnapshot`   | 400, 403, 404, 409 `ANCHOR_NOT_FOUND` |
| DELETE | `/playlists/{playlistId}/tracks/{entryId}`      | anyone allowed to edit | Remove an entry                                     | 200 `PlaylistSnapshot`   | 403, 404                              |

- Request bodies: `AddPlaylistTrackRequest` (`{ providerTrackId, afterEntryId? }`, omit `afterEntryId` to append),
  `MovePlaylistTrackRequest` (`{ afterEntryId: string | null }`, `null` = move to the start).
- An **entry** (`PlaylistEntry`) is one occurrence of a track in a playlist, with its own id. The same song may
  appear twice.
- Editing a playlist you can see but may not edit: `403 NOT_INVITED` (license `invited_only`).

### Concurrency (Decided: ADR-009)

- Edits are expressed by intent ("after this entry"), never by index, and applied one at a time per playlist on the
  server. Moving **different** entries at once: both succeed, in arrival order. Moving the **same** entry at once:
  both succeed in arrival order and the last one wins; all clients end with the same list.
- Every applied edit increments `version`. A client ignores any update whose version is not newer than its own and
  refetches if it sees a gap.
- Removing an entry that is already gone is not an error. Anchoring to an entry that was removed meanwhile gives
  `409 ANCHOR_NOT_FOUND`; the app refreshes.

## Real-time events (Socket.io, namespace `/live`)

- The handshake carries the access token (`auth: { token }`); the server verifies it and refuses the connection
  otherwise. A refused connection raises `connect_error` whose `data.code` is `TOKEN_EXPIRED` (refresh the token,
  then reconnect) or `UNAUTHENTICATED`. The app should also send the `X-Platform`, `X-Device` and `X-App-Version`
  headers (`extraHeaders`) so the connection is logged like any request.
- The token is checked only at the handshake. A connected socket keeps working after the 15-minute token expires,
  so permissions are re-checked on every `subscribe`, and the app should reconnect with a fresh token when it
  refreshes. (Decided; see `docs/security.md`.)
- Client -> server: `subscribe` with `{ resource: "event" | "playlist", id }` and an acknowledgement. The server
  runs the same "can this user see it?" check as REST; on failure it answers `NOT_FOUND`. `unsubscribe` leaves.
  The client's claim is never trusted.
- Server -> client (after the change is committed):
  - `event:queue` -> `EventQueueUpdate` `{ eventId, tracks: EventTrack[] }`: the full ordered queue with absolute
    vote counts (applying it twice or out of order is harmless).
  - `playlist:updated` -> `PlaylistSnapshot` `{ playlistId, version, tracks }`: apply only if `version` is newer.
- When someone is uninvited or a resource becomes private, the server removes their sockets from its channel
  (**TODO**: implement and test; otherwise they keep receiving updates).
- Payloads are full snapshots for simplicity; switch to deltas only if load tests justify it.

## Changelog

| Date       | Change                                                                                                                                             | Author    | Reviewed by |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| 2026-10-09 | First draft: conventions, auth, rooms/roles model                                                                                                  | belmqadem | withdrawn   |
| 2026-10-09 | Rewritten from the subject: events, playlists, licenses, OAuth, concurrency, real-time                                                             | belmqadem | pending     |
| 2026-10-10 | Added error codes `NOT_FOUND` (404, unknown route) and `INTERNAL_ERROR` (500); additive, no existing code changed                                  | belmqadem | pending     |
| 2026-10-10 | Clarified refresh rotation (strict reuse detection), logout behaviour and refresh rate limit; no type or endpoint shape changes                    | belmqadem | pending     |
| 2026-10-11 | Real-time handshake: `connect_error` `data.code` values and the token-checked-once rule; no type or endpoint shape changes                         | belmqadem | pending     |
| 2026-10-11 | OAuth semantics (login, link, unlink), new error codes `INVALID_PROVIDER_CREDENTIAL` (401) and `PROVIDER_UNAVAILABLE` (502); additive              | belmqadem | pending     |
| 2026-10-11 | Web client section: CORS allow-list, headers, refresh token in browser storage, multi-tab rule; no type or endpoint shape changes                  | belmqadem | pending     |
| 2026-10-11 | Added `GET /users?query=` and the `UserSummary` type; `Invitation.user` is now a `UserSummary` instead of a `User` (no email exposed to owners)    | belmqadem | pending     |
| 2026-10-12 | Clarified `location_time` details (accuracy limit 100 m, window [start, end), time checked first, owner exempt); no type or endpoint shape changes | belmqadem | pending     |
