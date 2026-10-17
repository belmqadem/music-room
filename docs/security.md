# Security

What we protect, what we defend against, and what we knowingly accept. Each claim names the decision (ADR) or the test
that backs it, so it can be checked in the code. Written 2026-10-16 against `develop`.

**What is at stake**: accounts (email, password hash, linked social logins), personal data in profiles (phone, birth
date), the private events and playlists of users, and the integrity of shared state (vote counts, queue order, playlist
order).

**Who we defend against**: an anonymous visitor; a signed-in user attacking another user's data or a resource they
cannot see; someone who stole an access token (15 minutes) or a refresh token; a user who sends hostile input (SQL,
markup, huge or malformed bodies); a script that floods endpoints; and a third party whose data we show (Deezer).
**Out of scope**: a compromised server or database host, a compromised phone, and denial of service by a large botnet.

**Principles**: the backend is the only source of truth, and the app is never trusted (it can send any header, body or
coordinate). Every endpoint except the public ones below is authenticated **and** authorized on the resource.
Public endpoints: `/health`, `/docs`, and `/auth/register`, `verify-email`, `resend-verification`, `forgot-password`,
`reset-password`, `login`, `refresh`, `oauth/{provider}`. All of the auth ones are rate limited.

## Authentication

**Passwords** (ADR-006)

- bcrypt, cost 12 (about 0.25 s per hash). Only the hash is stored.
- bcrypt ignores bytes after 72, so a longer password is rejected, never truncated. Length is counted in bytes.
- A new password needs 8 to 72 bytes with a lowercase letter, an uppercase letter, a digit and a symbol. Login does not
  apply these rules, so old accounts are never locked out.
- Login answers identically for an unknown email and a wrong password, and a bcrypt comparison always runs (against a
  dummy hash when there is no account), so the response time does not reveal which one it was.

**Access token** (ADR-003, ADR-006)

- A JWT signed with HS256, valid 15 minutes, claims `sub`, `iat`, `exp`. Verification pins the algorithm (no
  algorithm-confusion attack). The secret comes from `.env` and the server refuses to start with fewer than 32
  characters.
- The mobile app keeps it in memory only.

**Refresh token** (ADR-003, ADR-006, ADR-010)

- 32 random bytes, valid 7 days, stored only as a SHA-256 hash. Rotated on every use.
- **Strict reuse detection**: presenting a token that was already exchanged revokes the whole session family. Consuming a
  token is one atomic SQL statement, so of several simultaneous requests with the same token exactly one succeeds.
  Every failure returns the same `INVALID_REFRESH_TOKEN`; reuse is logged with user and session ids, never the token.
- On the phone it lives in the secure store (Keychain / Keystore).
- Logout revokes the session family. A password reset revokes every refresh token of the user.

**Email verification and password reset** (ADR-022)

- A 6-digit code sent by email, stored only as an HMAC-SHA256 (keyed with the server secret) over `purpose:userId:code`.
  It expires after 10 minutes, allows 5 wrong tries and 60 seconds between new codes.
- A password account cannot log in until its address is verified. `403 EMAIL_NOT_VERIFIED` is returned only after the
  password matched, so it does not reveal that an address is registered.
- `forgot-password` and `resend-verification` always answer `204`, whether or not the address exists.
- A successful reset also marks the address verified (the code proved the mailbox) and logs the user out everywhere.
- A social login with a provider-verified email deletes an **unverified** password account holding the same address, so
  a squatter cannot lock the real owner out.

**Social login** (ADR-007, ADR-011)

- The app sends the provider credential (Google ID token, Facebook access token) and the **backend verifies it with the
  provider**: Google signature, issuer, audience and expiry against Google's public keys; Facebook `debug_token` with our
  app id, then `/me`. The client's claim of identity is never trusted. Provider secrets stay on the server.
- **No automatic linking by email**: a matching verified email is `409 EMAIL_TAKEN`, because an unverified provider email
  could otherwise take over an account. Facebook emails are not used at all.
- **Linking or unlinking a provider needs proof of ownership** (ADR-025): the password, or a fresh credential from a
  provider already linked to the same account, otherwise `403 REAUTH_FAILED`. A stolen access token therefore cannot add
  the thief's own login.
- A user always keeps at least one login method (`409 LAST_LOGIN_METHOD`); simultaneous unlinks are serialised by a row
  lock.

**Rate limits** (per client IP; counters in Redis; if Redis is down the request fails rather than skipping the limit)

| Endpoint group                                                   | Limit              |
| ---------------------------------------------------------------- | ------------------ |
| login, OAuth login, link and unlink of a provider                | 10 per 15 minutes  |
| register                                                         | 10 per hour        |
| verify-email, resend, forgot-password, reset-password            | 20 per 15 minutes  |
| refresh                                                          | 100 per 15 minutes |
| friend requests                                                  | 30 per hour        |
| user search, track search, suggest a track, add a playlist track | 30 per minute      |

The client address comes from `X-Forwarded-For` only as far as `TRUST_PROXY` says (see Known risks).

## Authorization

Authentication says who you are; every endpoint also checks that you may touch **this** resource, and never assumes the
second follows from the first.

**Events and playlists** (ADR-005, ADR-014): one module, `modules/access`, decides for both services.

- _Visibility_: `public` (any signed-in user) or `private` (the owner and invited users). A private resource you may not
  see is `404`, identical to one that does not exist, so its existence is not revealed.
- _Permission to act_ (the license): events `everyone`, `invited_only` or `location_time`; playlists `everyone` or
  `invited_only`. Viewing and acting are separate: in a public event with an invited-only license everybody can see it
  and only invited users can vote (`403 NOT_INVITED`).
- _Location and time_: the server computes the distance and compares the time with its own clock. A position without
  accuracy, or worse than 100 m, is refused. An invitation does not skip this rule; the owner is exempt.
- _Management_ (change, delete, invite): owner only, `403 FORBIDDEN` for others who can see the resource.
- The rules are pure functions tested in tables; an unknown license or a malformed `location_time` row **fails closed**
  (500) instead of allowing. Services must call a guard before doing any work, and a suggestion is refused before the
  music catalog is asked.
- Listing queries repeat "public, mine or invited" in SQL and are tested against the same rules so the two cannot drift.

**Friends** (ADR-023): authorization is in the SQL. Only the addressee can accept (the requester gets `403`, a stranger
gets the same `404` as for an unknown id); decline/cancel only matches a pending request the caller is in; unfriend only
matches an accepted friendship between the caller and the named user.

**Profiles** (ADR-024): one function, `shapeProfile`, decides what a caller sees. Any signed-in user sees the public
block; accepted friends also see the friends block and music preferences; only the owner sees the private block (phone,
birth date). A block the caller may not see is omitted entirely. Editing has no user id in the path and the body is
strict, so a request can only change the caller's own profile. A pending friend request is not friendship.

**Users**: the user search returns only `id` and `displayName`, never an email or linked providers.

All of this is exercised by tests that try the denied case (for example: a stranger reads a private event; a requester
accepts their own request; a friend reads the private profile block).

## Input validation

- Every body is parsed with a **strict** schema (zod): unknown fields are `400`, so a client cannot slip in `userId`,
  `ownerId`, `status` and the like. Path ids and query strings are validated too (UUIDs, bounded numbers, cursors).
- JSON bodies are limited to 100 KB; a malformed or oversized body is a `400` with a generic message.
- **SQL**: every value from a request reaches Postgres as a bound parameter (`$1`, `$2`, ...). The only text put into a
  statement is fixed by the code: column lists, table names from a fixed map, a lock clause chosen from two literals, and
  the column names of a profile update, which come from a fixed table and never from the request.
- **Output**: the API returns JSON only and never builds HTML. User-controlled text (display names, bios, track titles)
  is stored as text; clients must never render it as HTML.
- **Catalog data** is untrusted: control characters removed, lengths capped, cover URLs accepted only over https from
  Deezer's image hosts (checked on the parsed host), track ids digits only (so they cannot alter a request path).
- **Errors** never echo submitted values (a validation error lists the field path and rule, not the value, because the
  value may be a password) and never show SQL or stack traces: unexpected errors are logged in full and answered with a
  generic message.
- Profile fields have limits in the schema **and** as database CHECK constraints (bio 280, names 80, phone 30, at most 10
  genres of 30 characters).

## Secrets and configuration

- Secrets live only in `.env` (gitignored, checked: `.env` and `mobile/.env` are ignored and the only tracked env files are
  the `.env.example` placeholders). The JWT secret, database password, SMTP URL and the Facebook app secret are never in
  the repository, in a PR, or in the mobile app. Provider secrets stay on the server.
- The configuration is validated at startup (types, minimum lengths) and the server refuses to start on a bad value.
- Settings that would be dangerous in production are **refused** there: `CATALOG_PROVIDER=fake` and the console mailer
  (which prints the verification codes) both stop the server when `NODE_ENV=production`.
- The Docker image runs as a non-root user and holds compiled code and production dependencies only; the load-test
  container uses `NODE_ENV=test`, with a fixed CPU and memory limit.
- No third-party library is committed; dependencies are installed from the lock files.

## Logging and privacy

- **Logged**: one structured line per finished HTTP request: request id, method, path **without the query string**,
  status, duration, user id (when authenticated) and the client's `platform`, `device` and `appVersion`. The same client
  fields are logged for every socket connection, refused handshake and subscription. Security events are logged with ids
  only: a reused refresh token, a failed re-authentication, a rejected provider credential, a social account linked.
- **Never logged**: request or response bodies, headers (so no `Authorization`), query strings, passwords, tokens,
  provider credentials, email codes. There is no redaction filter; the logger is simply never given those values, and
  tests check that a password and a provider credential do not appear in the log output.
- `X-Platform`, `X-Device` and `X-App-Version` are stripped to letters, digits and a few separators, cut to 64
  characters and mapped to `unknown` when missing, so a client cannot forge log lines, and they are **never** used for
  authorization.
- **Personal data**: email (needed for login), and in profiles the full name, city, phone and birth date. The last two
  are stored as plain text so the owner can read them back, and are returned only to their owner. Caller-specific responses (profiles, friends,
  queues, playlists, search, the signed-in user) are sent with `Cache-Control: no-store`. Deleting a user deletes their profile, friendships, invitations and
  sessions (`ON DELETE CASCADE`).
- In development the console mailer prints the 6-digit codes to the log; production refuses it.

## Real-time channel

- `/live` accepts a connection only with a valid access token in the handshake; otherwise `connect_error` with
  `TOKEN_EXPIRED` or `UNAUTHENTICATED`. Handshake failures are logged without the token.
- The token is checked once, at the handshake (a limit we accept, see Known risks). To make up for it, **every
  `subscribe` re-runs the same visibility check as REST**, joins the room, and checks again after joining, so access
  removed in between is caught.
- A client cannot name a room freely: it subscribes to `{ resource, id }` and the server decides. At most 25 subscriptions
  per socket. A private or missing resource gets the same `NOT_FOUND`.
- When access is removed (an invitation withdrawn, the resource made private or deleted) the server removes the user from
  the room and sends `event:access-lost`.
- Broadcasts carry one shared snapshot for the whole room and **no per-user data** (`votedByMe` is not in them), so a
  broadcast can never leak what one user did to another (ADR-019).
- Origins: browsers are limited to an allow-list; the mobile app sends no `Origin` and is unaffected.

## Known risks / open items

- **Location+time license can be faked.** The coordinates come from the phone, so a determined user can send false ones. Mitigations to apply: the server checks the time with its own clock, rejects poor accuracy, and rate limits votes. This is a limitation to state at the defense, not a solved problem. The access engine already rejects positions with no accuracy or worse than 100 m and uses the server clock; it cannot tell a real fix from a fake one.
- **Linking a login method needs proof of ownership (ADR-025).** Link and unlink of a social account require the password or a fresh credential from an already linked provider, so a stolen 15-minute access token cannot add the thief's own login. Residual: the guess limit is per IP (10 per 15 minutes), not per account.
- **A socket outlives its access token.** `/live` verifies the token once, at the handshake, so a connection stays open after the 15-minute token expires (or after logout). Accepted for simplicity. Mitigations: every `subscribe` re-checks the user's rights on the resource, and the app reconnects with a fresh token whenever it refreshes. Alternatives rejected: disconnecting at token expiry (timer per socket and a reconnect every 15 minutes) and a `reauth` event (most states to test).
- **The web client's refresh token is readable by XSS.** On web it lives in browser storage (ADR-012, option A), so a script injected into the page could steal it. Mitigations: refresh rotation with reuse detection (a stolen token that is replayed revokes the session), 15-minute access tokens, a strict Content-Security-Policy on the web build, and never rendering untrusted HTML (display names and track titles are user-controlled). Accepted for simplicity; an httpOnly cookie is the upgrade path.
- **CORS is not an access control.** The allow-list (`ALLOWED_ORIGINS`) only stops a hostile website from reading responses in a visitor's browser. Anyone can still call the API directly, so every endpoint keeps its own authentication and authorization checks.
- **Several browser tabs can log the user out.** Strict reuse detection treats two tabs presenting the same refresh token as theft. The web client must serialize refreshes across tabs.
- **No rate limit on creating events or invitations yet.** A signed-in user could create events or invite people in a loop. Mitigations to add: a per-user limit on `POST /events` and on invitations, and a cap on invitations per event. Open item.
- **The user search exposes display names.** Any signed-in user can look up people by name prefix (3+ characters, 30 searches per minute per IP, only `id` and `displayName`, never an email). Display names are chosen by users, so clients must never render them as HTML.
- **A removed invitation (or a private/deleted event) cuts live sockets, but not instantly.** The server re-checks the event's room right after the change commits and removes anyone who may no longer see it (`event:access-lost`). In the short gap between the commit and that re-check, a removed user could still receive one update. A user keeps their socket connection itself (and the 15-minute-token limit above); only the event's channel is closed.
- **Catalog data is untrusted third-party content.** Track titles, artists and cover URLs come from Deezer and are stored and shown to every participant. They must never be rendered as HTML, and cover URLs are accepted only over https from Deezer's own image hosts (`*.dzcdn.net`, checked on the parsed host so look-alikes and `user@host` tricks fail) and are otherwise dropped; control characters are removed and lengths capped before anything is stored. A Deezer track id is digits only, so it can never alter the request path. Deezer reports many failures as HTTP 200 with an error body; the adapter reads that body instead of trusting the status.
- **Suggestions call an external service.** Each suggestion makes one request to Deezer, so a user could spend our quota or slow the API. Search and suggestion are rate limited (30 per minute per IP proposed) and the request has a short timeout.
- **A late snapshot could overwrite a newer queue.** Fixed by the proposed `version` (ADR-016); clients must ignore a snapshot whose version is not higher.
- **A queue request can wait on the event lock indefinitely.** Suggest, vote and withdraw serialize on the event's row (ADR-018). If a transaction is ever stuck, requests for that event pile up behind it. To add with the load test: a `lock_timeout` so they fail fast instead of hanging.
- **No per-user limit on votes yet.** Votes are idempotent and cheap, so only suggestions are rate limited (they cost a catalog call). A user could still toggle a vote in a loop. To decide from the load-test results.
- **`TRUST_PROXY` must be the real number of reverse proxies.** The per-IP rate limits count the client address. Behind a proxy, every user would share the proxy's address unless the server reads `X-Forwarded-For`; but a client can write anything in that header. With `TRUST_PROXY=N` the server counts N entries from the right (the ones its own proxies added) and ignores anything the client invented to the left. Too small a value merges users into one limit; too large a value lets a client pick its own address and dodge the limits. Default 0: the header is ignored. Tests cover both the default and the spoofing case.
- **The fake catalog must never run in production.** `CATALOG_PROVIDER=fake` invents tracks for any numeric id. The configuration refuses to start with it when `NODE_ENV=production`.
- **Access tokens are not revoked at logout.** Logout revokes the refresh token, but the access token (and so a stolen
  copy) stays valid until it expires, at most 15 minutes. Accepted: stateless verification is the point of ADR-003. A
  deny-list in Redis would close it at the price of a Redis read on every request.
- **A Google ID token is not bound to a nonce.** A captured, still-valid ID token (about an hour) could be replayed to log
  in. Mitigations: the app sends it over TLS only, it is verified for signature, issuer, audience and expiry, and login
  is rate limited. Open item: a per-login nonce.
- **The guess limits are per IP, not per account.** An attacker with many addresses can spread guesses of a password
  (through login or the link/unlink re-authentication) or of an emailed code (5 tries per code, 60 s between codes, about
  0.7% a day for one targeted account, ADR-022). The password policy and the lifetime of codes and tokens bound it. Decision (2026-10-17): accepted, no per-account counter is planned.
- **Registering reveals whether an address is taken** (`409 EMAIL_TAKEN`), which allows checking if someone has an
  account. Accepted for a usable sign-up form; limited to 10 registrations per hour per IP. Login, forgot-password and
  resend do not reveal it.
- **Response headers and `/docs` (ADR-027).** Every response, including errors, 404s and rate-limit answers, carries
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a restrictive `Content-Security-Policy`
  (`default-src 'none'; frame-ancestors 'none'`); `Strict-Transport-Security` is added only when the request really
  arrived over https (behind a TLS proxy with `TRUST_PROXY` set). They are set by hand, without `helmet`. The Swagger UI
  at `/docs` needs scripts, so it gets the first two headers only. `/docs` is served in development and test and
  **switched off when `NODE_ENV=production`** (override with `DOCS_ENABLED=true|false`). Not done: `Permissions-Policy`
  and cross-origin isolation headers, which matter for pages, not for a JSON API.
- **Transport security is the deployment's job.** The server speaks plain HTTP; TLS must be terminated in front of it (and
  `TRUST_PROXY` set to the number of proxies). The mobile app accepts `http://` backend URLs because local development
  needs them (the default is `http://localhost:3000`); a release build should require https. Open item.
- **Personal data is stored unencrypted at rest** (phone, birth date, email). Disk and backup encryption belong to the
  host. Field-level encryption was not done.
- **Dependencies**: `npm audit --omit=dev` reports 0 vulnerabilities for the backend (2026-10-16). For the mobile app it
  reports 34 (1 critical, 22 high), all in packages pulled in by Expo / React Native and their build and dev tooling (the
  critical one is `shell-quote`, used by the dev server's tooling), not code we wrote. We did not check each one against
  the shipped bundle. The fix is to follow Expo's patch releases; `npm audit fix --force` would make breaking changes.
- **No audit table of security events.** They are in the logs only; there is no queryable history of logins, links or
  resets.
