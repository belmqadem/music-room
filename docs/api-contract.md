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

| HTTP | Meaning                                                      | Codes                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | Malformed or invalid request                                 | `VALIDATION_ERROR`, `INVALID_CODE`, `LOCATION_REQUIRED`                                                                                                                                                                                               |
| 401  | Not authenticated                                            | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`, `INVALID_PROVIDER_CREDENTIAL`                                                                                                                                     |
| 403  | You can see it, but may not do this                          | `EMAIL_NOT_VERIFIED`, `REAUTH_FAILED`, `DISPLAY_NAME_REQUIRED`, `FORBIDDEN`, `NOT_INVITED`, `OUTSIDE_VOTING_AREA`, `OUTSIDE_VOTING_TIME`                                                                                                              |
| 404  | Does not exist **or you may not know it exists**             | `USER_NOT_FOUND`, `FRIENDSHIP_NOT_FOUND`, `EVENT_NOT_FOUND`, `PLAYLIST_NOT_FOUND`, `TRACK_NOT_FOUND`, `NOT_FOUND` (unknown route)                                                                                                                     |
| 409  | Conflicts with current state                                 | `EMAIL_TAKEN`, `DISPLAY_NAME_TAKEN`, `FRIEND_REQUEST_EXISTS`, `ALREADY_FRIENDS`, `PROVIDER_ACCOUNT_LINKED`, `LAST_LOGIN_METHOD`, `ALREADY_INVITED`, `TRACK_ALREADY_QUEUED`, `TRACK_NOT_VOTABLE`, `QUEUE_CHANGED`, `ANCHOR_NOT_FOUND`, `PLAYLIST_FULL` |
| 429  | Rate limited                                                 | `RATE_LIMITED`                                                                                                                                                                                                                                        |
| 502  | The social provider or music catalog could not be reached    | `PROVIDER_UNAVAILABLE`                                                                                                                                                                                                                                |
| 500  | Unexpected server error (details are logged, never returned) | `INTERNAL_ERROR`                                                                                                                                                                                                                                      |

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

## Authentication (Decided: ADR-003, ADR-006, ADR-007, ADR-046)

- `Authorization: Bearer <accessToken>` on every endpoint except those marked _public_.
- Access token: JWT, 15 minutes, HS256. Refresh token: opaque, 7 days, rotated on every use; reusing an old one
  revokes the whole family. The same access token authenticates the Socket.io handshake.
- The app keeps the access token in memory only. The refresh token goes in secure storage on mobile (keychain /
  keystore). On web there is no secure storage, so it goes in browser storage and is sent in the request body, exactly
  like on mobile (ADR-012); see "Web client" below.

`AuthSession` (returned by login, refresh, OAuth login): `{ accessToken, refreshToken, expiresIn, user }`;
`expiresIn` is seconds until the access token expires.

| Method | Path                             | Auth   | Purpose                                                               | Success                   | Errors                                                                 |
| ------ | -------------------------------- | ------ | --------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| POST   | `/auth/register`                 | public | Create an account with email + password; emails a 6-digit code        | 201 `{ email }`           | 400, 409 `EMAIL_TAKEN`                                                 |
| POST   | `/auth/verify-email`             | public | Confirm the email with `{ email, code }`                              | 204                       | 400 `INVALID_CODE`, 429                                                |
| POST   | `/auth/resend-verification`      | public | Send a new code (`{ email }`); same answer for any address            | 204                       | 400, 429                                                               |
| POST   | `/auth/forgot-password`          | public | Email a reset code (`{ email }`); same answer for any address         | 204                       | 400, 429                                                               |
| POST   | `/auth/reset-password`           | public | Set a new password with `{ email, code, newPassword }`                | 204                       | 400 `INVALID_CODE`, 429                                                |
| POST   | `/auth/login`                    | public | Email + password login                                                | 200 `AuthSession`         | 400, 401 `INVALID_CREDENTIALS`, 403 `EMAIL_NOT_VERIFIED`, 429          |
| POST   | `/auth/oauth/{provider}`         | public | Sign up or log in with Google or Facebook                             | 200 `AuthSession`         | 400, 401, 409 `EMAIL_TAKEN`, 429, 502                                  |
| POST   | `/auth/refresh`                  | public | Exchange a refresh token for a new session (body: `{ refreshToken }`) | 200 `AuthSession`         | 401 `INVALID_REFRESH_TOKEN`                                            |
| POST   | `/auth/logout`                   | bearer | Revoke the session of `{ refreshToken }` (always 204)                 | 204                       | 401                                                                    |
| GET    | `/users/me`                      | bearer | The signed-in user, incl. linked providers                            | 200 `User`                | 401                                                                    |
| PUT    | `/users/me/display-name`         | bearer | Choose or change your display name (`{ displayName }`, ADR-046)       | 200 `User`                | 400, 401, 409 `DISPLAY_NAME_TAKEN`                                     |
| GET    | `/users`                         | bearer | Search users by display name prefix (`?query=`, see Finding users)    | 200 page of `UserSummary` | 400, 401, 429                                                          |
| POST   | `/users/me/providers/{provider}` | bearer | Link a Google/Facebook account (body: `credential` + `reauth`)        | 200 `User`                | 400, 401, 403 `REAUTH_FAILED`, 409 `PROVIDER_ACCOUNT_LINKED`, 429, 502 |
| DELETE | `/users/me/providers/{provider}` | bearer | Unlink a provider (body: `reauth`)                                    | 200 `User`                | 400, 403 `REAUTH_FAILED`, 404, 409 `LAST_LOGIN_METHOD`, 429            |

- **Display names (ADR-046)** are unique handles, the name people find each other by: trimmed and lowercased, then 3 to
  20 of `a-z`, `0-9`, `.` and `_`, starting with a letter, never starting with `user_`; unique ignoring case (a database
  index, so two people choosing one name at the same moment cannot both get it). Register takes **no** name
  (`{ email, password }` only; a `displayName` there is `400`). Every new account, by email or Google/Facebook, gets
  a temporary name (`user_` and 12 hex digits) and `User.displayNameSet: false`; existing accounts got the same when
  the rule arrived.
  - **Until a name is chosen**, every bearer endpoint and the Socket.io handshake answer `403 DISPLAY_NAME_REQUIRED`,
    except `GET /users/me`, `PUT /users/me/display-name` and `POST /auth/logout`. The access token carries this as a
    signed claim; after choosing, the app refreshes (`POST /auth/refresh`) to get a token that lets it in. A temporary
    name is never found by `GET /users`.
  - `PUT /users/me/display-name` also changes the name later; the old one is free again at once. Friends, invitations
    and rooms refer to the user id, so nothing else changes.
- `{provider}` is `google` or `facebook`. The OAuth body is `{ "credential": string }`: the Google ID token, or for
  Facebook either the access token or, on iOS when the user did not allow tracking, the Limited Login token (a JWT;
  ADR-032). The app sends whichever the Facebook SDK gave it; the backend tells them apart. **The backend verifies it with the provider**; it never trusts
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
- **Proof of ownership (ADR-025).** Linking or unlinking changes who can get into the account for good, so a valid
  access token is not enough (it may be stolen). Both requests carry `reauth`, a login method the account **already
  has**: `{ "method": "password", "password": "..." }`, or `{ "method": "provider", "provider": "google" | "facebook",
"credential": "..." }` with a fresh credential from a provider that is already linked to this account. Link is
  `{ credential, reauth }`; unlink is `DELETE` with the JSON body `{ reauth }`. A wrong or missing proof of the right
  shape is `403 REAUTH_FAILED` (a provider credential that is rejected is also `403`, never `401`, so the app does not
  mistake it for an expired session and refresh in a loop); a malformed one is `400`. Both endpoints share the login
  rate limit (10 per 15 minutes per IP), because they check a password. The app must ask for the password (or run the
  provider sign-in again) before it calls them.
- **Link** `POST /users/me/providers/{provider}`: body `{ credential, reauth }`, bearer required. `409 PROVIDER_ACCOUNT_LINKED` if that
  provider account belongs to anyone (including this user), or this user already has that provider linked.
  **Unlink** `DELETE ...`: `404` if that provider is not linked, `409 LAST_LOGIN_METHOD` if it is the only login
  method left (a user has a login method per linked provider, plus one if they have a password).
- OAuth login shares the login rate limit (per IP, 10 per 15 minutes).
- A user always keeps at least one login method; unlinking the last one is `409 LAST_LOGIN_METHOD`.
- `INVALID_CREDENTIALS` is identical for an unknown email and a wrong password. Passwords: 8 to 72 bytes (longer
  is rejected, not truncated), bcrypt cost 12 (ADR-006). The password is never returned or logged.
- Password policy (register only): besides the length, a new password MUST contain a lowercase letter, an uppercase
  letter, a digit and a symbol (anything that is not a letter, digit or whitespace). A weak password gets `400
VALIDATION_ERROR` with one `details` entry per broken rule (`path: "password"`, a fixed English `message`, never the
  password). Login does not apply the policy, so accounts created before it still work.
- **Email verification and password reset (ADR-022).** Register creates the account and emails a 6-digit code but
  returns **no session**: `201 { email }`. The app shows a code screen, calls `POST /auth/verify-email`, then logs in
  with the password it still holds. `User.emailVerified` tells whether the address is confirmed, and
  `User.hasPassword` (ADR-044) whether the account can sign in with a password at all (a social-only account cannot, and
  cannot get one through password reset), so the app offers only the proofs of ownership that can work.
  - **Login before confirming:** `403 EMAIL_NOT_VERIFIED`, but only when the password is right; a wrong password or an
    unknown address is the same `401 INVALID_CREDENTIALS` as before, so this reveals nothing. The app answers it with
    the code screen and `POST /auth/resend-verification`.
  - **The code** is one use, expires after 10 minutes, and dies after **5 tries** (right or wrong). Asking for a new code
    replaces the old one, at most one per minute per purpose. Every failure (wrong, expired, used up, unknown address)
    is the same `400 INVALID_CODE`. A verification code does not work as a reset code, or the other way round.
  - **`resend-verification` and `forgot-password`** always answer `204`, whether or not the account exists, so they
    cannot be used to find out who is registered. A code is only sent for a password account (a social-only account has
    nothing to confirm or reset).
  - **`reset-password`**: the new password follows the register policy (`400 VALIDATION_ERROR` first, and the code is
    **not** spent by a weak password). On success the password changes, the email counts as confirmed (the code came from
    the mailbox, which also lets the real owner take back an address someone else registered first), and **every session
    of that user ends** (all refresh tokens revoked; access tokens expire within 15 minutes).
  - **Social accounts** whose provider vouches for the email (Google) are confirmed at once. If an **unconfirmed**
    password account holds that email when the owner signs in with Google, that account (it could never log in) is deleted
    and the Google account is created: a stranger cannot lock the real owner out by registering their address.
  - The four code endpoints share one rate limit (**Proposed**): 20 per 15 minutes per IP.
- Login and register are rate limited (**Proposed**): 10 attempts per 15 minutes (login) and 10 per hour (register) per IP; refresh allows 100 per 15 minutes.
- **Refresh rotation (strict, ADR-010):** every refresh consumes the presented token and returns a new one in the same session. Presenting a token that was already used revokes the whole session, so the user must log in again. Consequence for the app: **never send the same refresh token twice**; do not retry a refresh request after a network timeout. Reconnect and log in if it fails. All refresh failures return the same `401 INVALID_REFRESH_TOKEN`.
- **Logout** always answers `204` (also for unknown tokens, or a token of another user, which is not revoked). It does not cancel the current access token, which stays valid until it expires (at most 15 minutes).

## Finding users (Decided: ADR-013)

To invite someone, the app needs their id. `GET /users?query=ada` (bearer) returns `Page<UserSummary>`, where
`UserSummary` is `{ id, displayName }` and **nothing else**: never an email or linked providers.

- The search is a case-insensitive **prefix** match on the display name, and finds only names that were chosen (never a
  temporary `user_` name, ADR-046). `query` is trimmed and must be at least 3
  characters, otherwise `400 VALIDATION_ERROR`. The caller is not in their own results.
- Results are ordered by display name, then id, and paginated like every list (`limit` default 20).
- Display names are unique (ADR-046); still invite by `id`, which never changes when a name does.
- Rate limited (`429 RATE_LIMITED`; **Proposed**: 30 searches per minute per IP), so the user directory cannot be walked quickly.
- An invitation's `user` is also a `UserSummary`: the owner never sees an invitee's email.

## Friends (Decided: ADR-023)

A friendship is **mutual**: one person asks, the other accepts. It is the basis of "friends-only" information in
profiles. `Friendship` is `{ id, user: UserSummary, status: "pending" | "accepted", direction: "incoming" | "outgoing",
createdAt, respondedAt }`, always seen from the caller's side: `user` is the OTHER person (never an email), `direction`
says who asked first.

| Method | Path                                   | Auth   | Purpose                                                     | Success                     | Errors                                                                          |
| ------ | -------------------------------------- | ------ | ----------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| POST   | `/friends/requests`                    | bearer | Ask someone (`{ userId }`)                                  | 201 `Friendship` (or 200)   | 400, 404 `USER_NOT_FOUND`, 409 `FRIEND_REQUEST_EXISTS` / `ALREADY_FRIENDS`, 429 |
| GET    | `/friends/requests?direction=`         | bearer | Pending requests, `incoming` or `outgoing` (required)       | 200 page of `Friendship`    | 400                                                                             |
| POST   | `/friends/requests/{requestId}/accept` | bearer | Accept a request you received                               | 200 `Friendship` (accepted) | 403 `FORBIDDEN`, 404 `FRIENDSHIP_NOT_FOUND`, 409 `ALREADY_FRIENDS`              |
| DELETE | `/friends/requests/{requestId}`        | bearer | Decline (addressee) or cancel (requester) a pending request | 204                         | 404 `FRIENDSHIP_NOT_FOUND`                                                      |
| GET    | `/friends`                             | bearer | Your friends, most recently accepted first                  | 200 page of `Friendship`    | 400                                                                             |
| DELETE | `/friends/{userId}`                    | bearer | Unfriend (either side)                                      | 204                         | 404 `FRIENDSHIP_NOT_FOUND`                                                      |

- **One row per pair.** A request exists in one direction at a time. If A asks B while B's request to A is still
  pending, nothing new is created: the existing request is accepted and the answer is `200` (not `201`) with
  `status: "accepted"`. Its `direction` stays that of the original request, so for A it reads `incoming`.
- **Only the addressee can accept.** The person who asked gets `403 FORBIDDEN`. Anyone who is not part of the request
  gets `404 FRIENDSHIP_NOT_FOUND`, the same answer as for an id that does not exist.
- **Decline, cancel and unfriend** delete the row, so the same two people can ask again later. `DELETE
/friends/requests/{id}` only touches a pending request; an accepted friendship is only removed by `DELETE
/friends/{userId}`, and a pending request is not removed by it.
- A request to yourself is `400 VALIDATION_ERROR`. Asking someone you already ask is `409 FRIEND_REQUEST_EXISTS`,
  someone who is already your friend `409 ALREADY_FRIENDS` (from either side).
- Lists are paginated like every list (`limit` default 20). Requests are ordered by when they were sent, friends by when
  they were accepted, newest first.
- Sending requests is rate limited (**Proposed**): 30 per hour per IP, so nobody can be flooded with them.
- Not included yet: blocking, and real-time notification of a new request (the app polls the list).

## Profiles (Decided: ADR-024, ADR-042)

A profile has four **blocks**. The server decides who sees each one; the user does not choose.

| Block              | Fields                                     | Seen by                        |
| ------------------ | ------------------------------------------ | ------------------------------ |
| `publicInfo`       | `bio` (≤ 280)                              | any signed-in user             |
| `friendsInfo`      | `fullName` (≤ 80), `city` (≤ 80)           | accepted friends and the owner |
| `musicPreferences` | `genres` (≤ 10 tags, each ≤ 30 characters) | accepted friends and the owner |
| `privateInfo`      | `phone` (≤ 30), `birthDate` (`YYYY-MM-DD`) | the owner only                 |

`Profile` is `{ userId, displayName, publicInfo, friendsInfo?, musicPreferences?, privateInfo?, friendship }`. **A block
the caller may not see is omitted**, not empty or null. A pending friend request is not friendship. Fields the owner
never filled in are `null` (`genres`: `[]`).

`friendship` (ADR-042) is where the caller stands with the owner: `{ id, status, direction }` of the pending request or
the friendship between the two, from the caller's side (as in `Friendship`), or `null` when there is none. It is always
`null` on your own profile (also in the PATCH answer). `id` is what accept, decline and cancel take; unfriending takes
the owner's `userId`. Only the two people concerned ever see it, so it reveals nothing to anyone else.

| Method | Path                      | Auth   | Purpose                                          | Success             | Errors                    |
| ------ | ------------------------- | ------ | ------------------------------------------------ | ------------------- | ------------------------- |
| GET    | `/users/me/profile`       | bearer | Your own profile, all four blocks                | 200 `Profile`       |                           |
| PATCH  | `/users/me/profile`       | bearer | Change your own profile (`UpdateProfileRequest`) | 200 `Profile` (all) | 400 `VALIDATION_ERROR`    |
| GET    | `/users/{userId}/profile` | bearer | Someone's profile, only the blocks you may see   | 200 `Profile`       | 400, 404 `USER_NOT_FOUND` |

- **PATCH** takes any of the four blocks, each with any of its fields. A field that is absent is left as it is; `null`
  clears it; `genres`, when sent, **replaces** the whole list. An empty body changes nothing. Unknown fields are
  `400`, so a body cannot name another user.
- Text is trimmed; a blank value becomes `null`. Genres are trimmed, lowercased and deduplicated (order kept).
  `birthDate` must be a real date between 1900-01-01 and today. `phone` is digits with `+ ( ) . -` and spaces.
- Responses are `Cache-Control: no-store`: what a profile shows depends on who asks.
- Your own id in `/users/{userId}/profile` gives the same answer as `/users/me/profile`.

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

| Method | Path                                      | Who may call it        | Purpose                                             | Success                  | Errors                                                           |
| ------ | ----------------------------------------- | ---------------------- | --------------------------------------------------- | ------------------------ | ---------------------------------------------------------------- |
| POST   | `/events`                                 | any authenticated user | Create an event (caller is owner)                   | 201 `MusicEvent`         | 400                                                              |
| GET    | `/events`                                 | any authenticated user | Page of events you can see (public + yours/invited) | 200 page of `MusicEvent` | —                                                                |
| GET    | `/events/{eventId}`                       | anyone who can see it  | Event details incl. `myPermissions`                 | 200 `MusicEvent`         | 404                                                              |
| PATCH  | `/events/{eventId}`                       | owner                  | Change name, visibility, vote license               | 200 `MusicEvent`         | 400, 403, 404                                                    |
| DELETE | `/events/{eventId}`                       | owner                  | Delete the event                                    | 204                      | 403, 404                                                         |
| GET    | `/events/{eventId}/invitations`           | owner                  | List invited users                                  | 200 page of `Invitation` | 403, 404                                                         |
| POST   | `/events/{eventId}/invitations`           | owner                  | Invite a user                                       | 201 `Invitation`         | 400, 403, 404, 409 `ALREADY_INVITED`                             |
| DELETE | `/events/{eventId}/invitations/{userId}`  | owner                  | Remove an invitation                                | 204                      | 403, 404                                                         |
| GET    | `/events/{eventId}/tracks`                | anyone who can see it  | The queue, **already ordered** (see Ranking)        | 200 `EventQueueUpdate`   | 404                                                              |
| POST   | `/events/{eventId}/tracks`                | anyone allowed to act  | Suggest a track (counts as your vote)               | 201 `EventTrack`         | 400, 403, 404 `TRACK_NOT_FOUND`, 409 `TRACK_ALREADY_QUEUED`, 502 |
| PUT    | `/events/{eventId}/tracks/{trackId}/vote` | anyone allowed to act  | Vote for a track (**idempotent**)                   | 200 `EventTrack`         | 400, 403, 404, 409 `TRACK_NOT_VOTABLE`                           |
| DELETE | `/events/{eventId}/tracks/{trackId}/vote` | anyone who can see it  | Withdraw your own vote (**idempotent**)             | 200 `EventTrack`         | 404, 409 `TRACK_NOT_VOTABLE`                                     |
| POST   | `/events/{eventId}/queue/advance`         | owner                  | Move to the next track (body: `currentTrackId`)     | 200 `EventQueueUpdate`   | 400, 403, 404, 409 `QUEUE_CHANGED`                               |

- Request bodies: `CreateEventRequest`, `UpdateEventRequest`, `InviteRequest` (`{ userId }`),
  `SuggestTrackRequest` (`{ providerTrackId, location? }`, `location` is a `GeoPoint`), `VoteRequest` (`{ location? }`, only needed when the
  license is `location_time`), `AdvanceQueueRequest` (`{ currentTrackId }`). The backend looks up title and artist
  from the music catalog itself; the client sends only the track id (see "Music catalog").
- A user has at most one vote per track, and may vote for several tracks.
- **Withdrawing a vote** needs only that you can still see the event: no license and **no location**, and `DELETE` has
  no body. So someone who voted and then left the area, or lost their invitation, can always take their vote back.
  (Only `PUT` and suggesting need the license, and for `location_time` the `location`.) You can only remove your own
  vote. Withdrawing when you have not voted is `200` and changes nothing.
- **Suggesting** counts as your vote (`voteCount` starts at 1, `votedByMe` is true). If you are not allowed, the answer
  is `403`/`400`/`404` **before** the catalog is asked. The `PUT` vote body is optional (only `{ location }`).
- Repeating a vote or a withdrawal changes neither the count nor the queue `version`.
- **Listing** (`GET /events`): public events, your own, and private events you are invited to, newest first. `limit`
  is 1 to 100 (default 20); `nextCursor` is opaque, pass it back as `?cursor=` and never build one. A bad `limit` or
  `cursor` is `400 VALIDATION_ERROR`.
- **Changing an event** (`PATCH`): send at least one of `name`, `visibility`, `voteLicense`. A new `voteLicense`
  **replaces** the whole license (send all `location_time` fields again). It takes effect immediately; votes already
  cast stay. Unknown fields (`ownerId`, `id`, ...) are `400`.
- **Invitations** (`/events/{id}/invitations`): owner only (`403 FORBIDDEN` for anyone else who can see the event,
  `404` if they cannot). `POST` takes `{ userId }`; it takes effect immediately, so the invited user can find the
  event (and vote, if the license needs an invitation) at once. Errors: `409 ALREADY_INVITED`, `404 NOT_FOUND` for an
  unknown user, `400` for a malformed id or for inviting the owner. `DELETE` is idempotent (`204` even if that user was
  not invited) and takes effect immediately. The list is newest invitation first and paginated like every list.
- `GET /events/{id}`: a private event you may not see is `404 EVENT_NOT_FOUND`, identical to a missing one. Anyone who
  can see an event but is not its owner gets `403 FORBIDDEN` on `PATCH`, `DELETE` and the invitation endpoints.

### Music catalog and track search (Decided: ADR-015)

| Method | Path             | Auth   | Purpose                                   | Success           | Errors             |
| ------ | ---------------- | ------ | ----------------------------------------- | ----------------- | ------------------ |
| GET    | `/tracks/search` | bearer | Search the catalog (`?query=`, `?limit=`) | 200 `Page<Track>` | 400, 401, 429, 502 |

- Tracks come from Deezer's public catalog. The app finds tracks with `GET /tracks/search?query=daft+punk&limit=10`
  (bearer): it returns `Page<Track>` (`nextCursor` is always `null`: one page, at most 25 results; `query` is 2 to 100
  characters). The app then suggests one by sending only its `providerTrackId`.
- When a track is suggested, the backend asks the catalog for it and **stores a copy** of title, artist, duration and
  cover. The queue never depends on the catalog afterwards. An id the catalog does not know is `404 TRACK_NOT_FOUND`;
  if the catalog cannot be reached it is `502 PROVIDER_UNAVAILABLE` (retry later). Search is rate limited like user
  search (**Proposed**: 30 per minute per IP).
- Titles, artists and cover URLs come from a third party: never render them as HTML. `Track` has no audio link:
  Deezer's preview links expire, so playback is the app's concern.

### Queue states and advancing (Decided: ADR-016)

- Each queue entry is `queued` (can be voted for), `playing` (at most one per event, frozen: no more votes) or
  `played` (history). `GET /events/{id}/tracks` returns the `playing` track first, then the `queued` ones in ranking
  order, as an `EventQueueUpdate`. `played` tracks are not returned.
- The **owner** moves the queue: `POST /events/{id}/queue/advance` with `{ currentTrackId }`, where `currentTrackId` is
  the track the app believes is playing, or `null` if none is. The server marks it `played` and starts the best
  `queued` track (most votes, oldest suggestion on ties); if nothing is queued, nothing plays. The answer is the new
  `EventQueueUpdate`.
  With nothing playing and nothing queued there is nothing to do: `200`, the queue unchanged and its `version` too.
- If `currentTrackId` is not what is really playing (for example the owner double-tapped "next", or a second device
  advanced first), the answer is `409 QUEUE_CHANGED` and **nothing moves**, so no song is skipped. `details` holds the
  current `EventQueueUpdate`; the app shows it.
- Voting on a track that is `playing`, `played` or gone is `409 TRACK_NOT_VOTABLE`. Suggesting a track that is already
  `queued` is `409 TRACK_ALREADY_QUEUED`; suggesting one that is `playing` or `played` is allowed (it queues again).
- `version` (**Proposed**): every change to the queue (suggestion, vote, advance) increases the event's `version`.
  Keep the highest version you have seen and ignore any snapshot, from REST or from the socket, that is not higher.

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

### Playlist rules (Decided: ADR-020)

Playlists follow the same access rules as events (public by default, private means only the owner and invited users;
see "Access rules"), the same listing (newest first, `limit` and an opaque `cursor`), the same `PATCH` (at least one
field, a new `editLicense` replaces the old one, takes effect immediately), the same invitation endpoints and the same
`403`/`404` behaviour as events (see "Events"). Only the differences are listed here.

- **Who may edit**: license `everyone` (default) means anyone who can see the playlist; `invited_only` means the owner
  and invited users, others get `403 NOT_INVITED`. There is no location rule for playlists. Anyone allowed to edit may
  add, move and remove **any** entry, not only their own. Reading (`GET`) needs only that you can see the playlist.
- **Order**: `GET .../tracks` returns the entries in playlist order and the current `version`, as a `PlaylistSnapshot`.
  Every edit answers with the new `PlaylistSnapshot` (`201` for add, `200` otherwise). Clients do not compute positions.
- **Adding** (`POST .../tracks`): send the catalog id, as for events; the backend resolves title, artist and cover
  (`404 TRACK_NOT_FOUND`, `502 PROVIDER_UNAVAILABLE`) and refuses before asking the catalog if you may not edit.
  `afterEntryId` omitted appends; an `afterEntryId` that is not an entry of this playlist is `409 ANCHOR_NOT_FOUND`.
  Adding is rate limited like suggesting (**Proposed**: 30 per minute per IP).
- **Size limit**: a playlist holds at most **500** entries; adding the 501st is `409 PLAYLIST_FULL`.
- **Moving** (`POST .../tracks/{entryId}/move`): `afterEntryId` is the entry it must follow, or `null` for the start. An
  `entryId` that is not in this playlist is `404 TRACK_NOT_FOUND`; an `afterEntryId` that is not is `409
ANCHOR_NOT_FOUND`. Moving an entry after itself, or to the place it already has, changes nothing: `200`, the
  snapshot, and the `version` stays the same.
- **Removing** (`DELETE .../tracks/{entryId}`): `200` with the snapshot. An entry that is already gone is not an
  error and changes nothing (the `version` stays).
- `version` rises by 1 for every edit that really changes the list, and only then.

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
- Client -> server, each with an acknowledgement:
  - `subscribe` with `SubscribeRequest` `{ resource: "event" | "playlist", id }`. The server runs the same "can this
    user see it?" check as REST, joins you to its channel, checks again, and answers `{ ok: true, snapshot }` where
    `snapshot` is the current `EventQueueUpdate` **with your own `votedByMe`** (event) or the current
    `PlaylistSnapshot` (playlist). Otherwise `{ ok: false, error }`:
    `NOT_FOUND` (missing, or private and you may not see it: the same answer), `VALIDATION_ERROR` (bad payload) or
    `RATE_LIMITED` (more than 25 subscriptions on one socket, events and playlists together). The client's claim is never trusted; only the token from the handshake identifies you.
  - `unsubscribe` with the same payload leaves the channel (`{ ok: true }`, also if you were not in it).
- Server -> client (sent after the change is committed):
  - `event:queue` -> `QueueSnapshot` `{ eventId, version, tracks }`: the full ordered queue (`playing` first, then
    `queued` ranked) with absolute vote counts, **the same for everybody, so without `votedByMe`** (ADR-019). Apply it
    only if `version` is higher than the one you hold; keep your own `votedByMe` per track (from REST answers and the
    subscribe acknowledgement) and merge it in. A vote made on your other device shows up in your `votedByMe` only after
    the next REST read or re-subscribe. Several quick changes may be sent as one snapshot: you always get the
    latest state, not every step.
  - `event:access-lost` -> `AccessLost` `{ resource: "event" | "playlist", id, reason }`: you were removed from the
    channel because you can no longer see it (`no_access`: uninvited, or it became private) or it was deleted
    (`deleted`). (The event name is `event:access-lost` for both kinds; read `resource`.) You
    receive no more updates for it; the REST calls now answer `404` as well.
  - `playlist:updated` -> `PlaylistSnapshot` `{ playlistId, version, tracks }`: the full ordered list, the same for
    everybody. Apply it only if `version` is higher than the one you hold. Several quick edits may arrive as one
    snapshot. Sent after every committed edit, never for a request that changed nothing.
- Reconnecting: subscriptions do not survive a disconnect. After reconnecting, subscribe again; the acknowledgement
  brings you up to date.
- Payloads are full snapshots for simplicity; switch to deltas only if load tests justify it.

## Changelog

| Date       | Change                                                                                                                                                                                                                                                                                                                                                             | Author    | Reviewed by |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ----------- |
| 2026-10-09 | First draft: conventions, auth, rooms/roles model                                                                                                                                                                                                                                                                                                                  | belmqadem | withdrawn   |
| 2026-10-09 | Rewritten from the subject: events, playlists, licenses, OAuth, concurrency, real-time                                                                                                                                                                                                                                                                             | belmqadem | pending     |
| 2026-10-10 | Added error codes `NOT_FOUND` (404, unknown route) and `INTERNAL_ERROR` (500); additive, no existing code changed                                                                                                                                                                                                                                                  | belmqadem | pending     |
| 2026-10-10 | Clarified refresh rotation (strict reuse detection), logout behaviour and refresh rate limit; no type or endpoint shape changes                                                                                                                                                                                                                                    | belmqadem | pending     |
| 2026-10-11 | Real-time handshake: `connect_error` `data.code` values and the token-checked-once rule; no type or endpoint shape changes                                                                                                                                                                                                                                         | belmqadem | pending     |
| 2026-10-11 | OAuth semantics (login, link, unlink), new error codes `INVALID_PROVIDER_CREDENTIAL` (401) and `PROVIDER_UNAVAILABLE` (502); additive                                                                                                                                                                                                                              | belmqadem | pending     |
| 2026-10-11 | Web client section: CORS allow-list, headers, refresh token in browser storage, multi-tab rule; no type or endpoint shape changes                                                                                                                                                                                                                                  | belmqadem | pending     |
| 2026-10-11 | Added `GET /users?query=` and the `UserSummary` type; `Invitation.user` is now a `UserSummary` instead of a `User` (no email exposed to owners)                                                                                                                                                                                                                    | belmqadem | pending     |
| 2026-10-12 | Clarified `location_time` details (accuracy limit 100 m, window [start, end), time checked first, owner exempt); no type or endpoint shape changes                                                                                                                                                                                                                 | belmqadem | pending     |
| 2026-10-12 | Event invitations: owner-only rules, idempotent removal, error codes, and the user search rate limit; no type or endpoint shape changes                                                                                                                                                                                                                            | belmqadem | pending     |
| 2026-10-12 | Track Vote: catalog search `GET /tracks/search`, `POST /events/{id}/queue/advance` with `QUEUE_CHANGED`, queue states, `EventQueueUpdate.version` (**Proposed**) and `GET .../tracks` now returns `EventQueueUpdate`; new error code `QUEUE_CHANGED`                                                                                                               | belmqadem | pending     |
| 2026-10-13 | Track Vote queue: withdrawing a vote needs only that you can see the event (was: the full vote license); optional `PUT` body; suggest is checked before the catalog is asked                                                                                                                                                                                       | belmqadem | pending     |
| 2026-10-13 | Advance: nothing playing and nothing queued is a `200` no-op; wording only, no type or endpoint shape changes                                                                                                                                                                                                                                                      | belmqadem | pending     |
| 2026-10-13 | Real-time: `subscribe`/`unsubscribe` acknowledgements, `event:queue` is one shared `QueueSnapshot` without `votedByMe` (**contract change**, ADR-019), new `event:access-lost`; types `QueueEntry`, `QueueSnapshot`, `SubscribeRequest`, `SubscribeAck`, `UnsubscribeAck`, `AccessLost`                                                                            | belmqadem | pending     |
| 2026-10-14 | Playlist Editor: error code `PLAYLIST_FULL` (409, limit 500 entries), rules for no-op moves and removals, `subscribe` and `access-lost` now cover playlists, `playlist:updated` described; types `SubscribeAck` (snapshot union) and `AccessLost.resource` extended                                                                                                | belmqadem | pending     |
| 2026-10-15 | Friends: `POST/GET /friends/requests`, `.../accept`, `DELETE /friends/requests/{id}`, `GET /friends`, `DELETE /friends/{userId}`; type `Friendship`; new error codes `USER_NOT_FOUND`, `FRIENDSHIP_NOT_FOUND`, `FRIEND_REQUEST_EXISTS`, `ALREADY_FRIENDS`; additive                                                                                                | belmqadem | pending     |
| 2026-10-15 | Profiles: `GET/PATCH /users/me/profile`, `GET /users/{userId}/profile`; types `Profile`, `PublicInfo`, `FriendsInfo`, `PrivateInfo`, `MusicPreferences`, `UpdateProfileRequest`; no new error codes; additive                                                                                                                                                      | belmqadem | pending     |
| 2026-10-16 | Provider link and unlink need proof of ownership: `POST /users/me/providers/{provider}` body is now `{ credential, reauth }`, `DELETE` takes `{ reauth }`; new type `Reauth`, `LinkProviderRequest`, `UnlinkProviderRequest`, error code `REAUTH_FAILED` (403). **Breaking** for the link and unlink calls                                                         | belmqadem | pending     |
| 2026-10-19 | Facebook `credential` may also be a Limited Login token (JWT, iOS without tracking permission); same body and error codes; additive (ADR-032)                                                                                                                                                                                                                      | belmqadem | pending     |
| 2026-10-26 | Profiles: `Profile.friendship` (`ProfileFriendship`: `{ id, status, direction }` or `null`), where the caller stands with the owner; always present, `null` on your own profile; additive for readers (ADR-042)                                                                                                                                                    | belmqadem | pending     |
| 2026-10-26 | Auth: `User.hasPassword` (boolean), whether the account can sign in with a password; always present; additive for readers (ADR-044)                                                                                                                                                                                                                                | belmqadem | pending     |
| 2026-10-27 | Unique display names (ADR-046): `RegisterRequest` loses `displayName` (**breaking** for register); new `PUT /users/me/display-name` (`SetDisplayNameRequest`), `User.displayNameSet`, error codes `DISPLAY_NAME_TAKEN` (409) and `DISPLAY_NAME_REQUIRED` (403, every bearer route and the socket handshake until a name is chosen); search finds only chosen names | belmqadem | pending     |
