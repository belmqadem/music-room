# Mobile handoff: what the app must do

For the mobile developer. The full rules are in `docs/api-contract.md` (section names are given below); this page says
what the **app** has to do and what changed since the early drafts. The backend is the source of truth: the app only
displays and sends.

## 1. Screens and the endpoints behind them

Events (Track Vote) and playlists (Playlist Editor) are **separate resources with separate ids** (ADR-026). There is no
"session" id. The routes are `event/[id]` and `playlist/[id]`.

| Screen                | What it shows / does                                                                  | Endpoints                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| welcome, sign-in      | Log in, social login                                                                  | `POST /auth/login`, `POST /auth/oauth/{provider}`                                                                           |
| sign-up, verify-email | Register, then enter the emailed code                                                 | `POST /auth/register`, `/auth/verify-email`, `/auth/resend-verification`                                                    |
| forgot-password       | Ask for a code, set a new password                                                    | `POST /auth/forgot-password`, `/auth/reset-password`                                                                        |
| events tab            | Public events, plus the ones you own or are invited to; entry point to create one     | `GET /events` (paginated), `POST /events`                                                                                   |
| playlists tab         | Public playlists, plus the ones you own or are invited to; entry point to create one  | `GET /playlists` (paginated), `POST /playlists`                                                                             |
| create-event          | Create an event: visibility and who may vote (everyone, invited only, place and time) | `POST /events`                                                                                                              |
| create-playlist       | Create a playlist: visibility and who may edit (everyone, invited only)               | `POST /playlists`                                                                                                           |
| event/[id]            | Track Vote: the live queue, suggest, vote, withdraw, owner advances                   | `GET /events/{id}`, `/tracks`, `POST .../tracks`, `PUT/DELETE .../vote`, `POST .../queue/advance`, `/tracks/search`, socket |
| playlist/[id]         | Playlist Editor: live list, add, move, remove                                         | `GET /playlists/{id}`, `/tracks`, `POST .../tracks`, `.../move`, `DELETE .../tracks/{entryId}`, socket                      |
| invitations (owner)   | Invite or remove people on a private or restricted event/playlist                     | `GET/POST /events/{id}/invitations`, `DELETE .../{userId}`, same for playlists, `GET /users?query=`                         |
| profile               | Own profile; another user's profile                                                   | `GET/PATCH /users/me/profile`, `GET /users/{id}/profile`                                                                    |
| friends               | Friends, requests (poll the list), unfriend                                           | `/friends`, `/friends/requests`, `.../accept`, `DELETE /friends/{userId}`                                                   |
| settings              | Backend URL, linked accounts, log out                                                 | `GET /users/me`, `POST/DELETE /users/me/providers/{provider}`, `POST /auth/logout`                                          |

## 2. What changed since the early drafts (read these first)

| Change                                                                                                                                                             | What the app must do                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register` answers `201 { email }` with **no session** (ADR-022)                                                                                        | Go to verify-email with that address. Log in only after the code is confirmed.                                   |
| `POST /auth/login` can answer `403 EMAIL_NOT_VERIFIED`                                                                                                             | Send the user to verify-email (offer "resend").                                                                  |
| New passwords need 8 to 72 bytes with a lowercase, uppercase, digit and symbol (ADR-006)                                                                           | Check it in the form for fast feedback; the server decides (`400 VALIDATION_ERROR`). Login accepts any password. |
| Linking or unlinking Google/Facebook needs `reauth` (ADR-025): the password, or a fresh credential from an already linked provider. Failure is `403 REAUTH_FAILED` | Ask for the password (or rerun the provider sign-in) first. Do **not** treat this 403 as an expired session.     |
| `event:queue` is one snapshot for everybody, **without `votedByMe`** (ADR-019)                                                                                     | Keep your own `votedByMe` per track from REST answers and the subscribe acknowledgement, and merge it in.        |
| `Invitation.user` is a `UserSummary` (`{ id, displayName }`), never an email                                                                                       | Show the display name; invite by `id`.                                                                           |
| A profile hides blocks you may not see (they are **missing**, not empty)                                                                                           | Render only the blocks present. `privateInfo` only exists on your own profile.                                   |
| A track in a queue/playlist is a **copy** of the catalog data                                                                                                      | Never render titles, artists or cover URLs as HTML.                                                              |

## 3. Rules the client must follow

- **Headers**: every request and the socket handshake carry `X-Platform`, `X-Device` and `X-App-Version`. REST already does
  (`src/api/client-headers.ts`); the socket must pass the same headers as `extraHeaders`.
- **Tokens**: access token 15 minutes, sent as `Authorization: Bearer`, kept in memory only; the refresh token (7 days) goes in secure storage. On `401 TOKEN_EXPIRED` refresh once with
  `POST /auth/refresh` and retry. Refresh tokens **rotate**: store the new one every time, and never refresh from two
  places at once (reuse revokes the session). `401 INVALID_REFRESH_TOKEN` means log in again.
  **This is implemented** (ADR-028, `mobile/src/auth`, `mobile/src/api`): screens never handle tokens. Use
  `useAuth()` for the signed-in state, `auth.signIn / register / verifyEmail / signOut ...` for the account actions,
  and `api.get / post / put / patch / delete` for every other call; errors are `RequestError` with the backend's `code`.
- **Errors** are `{ error: { code, message, details? } }`; switch on `code`, show your own text. `429 RATE_LIMITED`: wait and retry.
- **Pagination**: lists return `{ items, nextCursor }`; pass `nextCursor` back as `?cursor=`, never build one.
- **Sockets** (`/live`): connect with `auth: { token }`, then `subscribe` `{ resource: "event" | "playlist", id }`. Apply a
  snapshot only if its `version` is higher than yours. After a reconnect, subscribe again. On `event:access-lost` leave the
  screen. Reconnect with a fresh token when you refresh.
- **Location**: for an event with a `location_time` license, send `location` (`latitude`, `longitude`, `accuracyMeters`) with suggest
  and vote. The server decides; "I am inside" is never trusted.
- **Friend requests** have no push: poll `GET /friends/requests?direction=incoming` when the friends screen opens.
- **Backend URL**: development uses `http://`, but a release build should refuse any backend URL that is not `https://`
  (`docs/security.md`, transport security).
- **Nothing authoritative lives on the device**: what you may do comes from the server's answers (`myPermissions` is a hint
  only; the server checks every call).

## 4. Where to look in the contract

Authentication (register, verify, reset, login, OAuth, link), Friends, Profiles, Access rules, Events, Music catalog, Queue
states, Playlists, Playlist rules, Real-time events. The changelog at the end lists every change with the date.

## 5. Status of the app (updated 2026-10-20)

- Done: routes and navigation (ADR-026), API client and session (ADR-028), theme from the design tokens (ADR-029), shared components (ADR-030), and the auth screens (ADR-031): welcome, sign-up, verify-email, sign-in, forgot-password, checked against the real backend.
- Done: "Continue with Google / Facebook" on sign-in and sign-up (ADR-033), in a development build once the ids are in `mobile/.env`.
- Open: the backend address is set in Settings, which is only reachable when signed in. A signed-out user (the first launch) needs a way to change it, for example a "Server address" link on the welcome or sign-in screen.
- Done: Track Vote part 1 (ADR-034): the events list, and the event screen with the live queue, voting and withdrawing, and the owner's "Next track", over one shared live connection (`src/sockets`).
- Done: suggesting a track from the catalog search, in a sheet over the event screen (ADR-034).
- Done: voting and suggesting in place-and-time events: the position is asked only when the server needs it (ADR-034, `expo-location`; rebuild the development builds).
- Done: creating an event with its visibility and its three voting modes (ADR-034). Track Vote now has every screen except invitations.
- Done: invitations, shared by events and playlists (ADR-035): the owner finds people by name and invites or removes them.
- Done: the Playlist Editor: the playlists list and the live editor (add, move, remove; invitations for the owner) (ADR-036).
- Done: creating a playlist with its visibility and who may edit (ADR-036). Every screen of the mandatory part is now in the app.
- Next: `TEMP_ALLOW_ALL_ROUTES` off and a server address before sign-in; then every flow on the iOS and Android builds.
