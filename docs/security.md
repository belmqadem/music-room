# Security

TODO: hazards and mitigations writeup (graded).

## Authentication

TODO: password hashing, token lifetime, OAuth flow.

## Authorization

TODO: per-resource checks, visibility (public/private), permission (open/restricted).

## Input validation

TODO

## Secrets and configuration

- Secrets live only in `.env` (gitignored); `.env.example` has placeholders.

## Logging and privacy

TODO: what is logged (platform, device, app version), what must never be logged.

## Real-time channel

TODO: Socket.io handshake auth; the `/live` namespace currently rejects every connection.

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
- TODO: the rest of this document
