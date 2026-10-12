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
- **A socket outlives its access token.** `/live` verifies the token once, at the handshake, so a connection stays open after the 15-minute token expires (or after logout). Accepted for simplicity. Mitigations: every `subscribe` re-checks the user's rights on the resource, and the app reconnects with a fresh token whenever it refreshes. Alternatives rejected: disconnecting at token expiry (timer per socket and a reconnect every 15 minutes) and a `reauth` event (most states to test).
- **The web client's refresh token is readable by XSS.** On web it lives in browser storage (ADR-012, option A), so a script injected into the page could steal it. Mitigations: refresh rotation with reuse detection (a stolen token that is replayed revokes the session), 15-minute access tokens, a strict Content-Security-Policy on the web build, and never rendering untrusted HTML (display names and track titles are user-controlled). Accepted for simplicity; an httpOnly cookie is the upgrade path.
- **CORS is not an access control.** The allow-list (`ALLOWED_ORIGINS`) only stops a hostile website from reading responses in a visitor's browser. Anyone can still call the API directly, so every endpoint keeps its own authentication and authorization checks.
- **Several browser tabs can log the user out.** Strict reuse detection treats two tabs presenting the same refresh token as theft. The web client must serialize refreshes across tabs.
- **No rate limit on creating events or invitations yet.** A signed-in user could create events or invite people in a loop. Mitigations to add: a per-user limit on `POST /events` and on invitations, and a cap on invitations per event. Open item.
- **The user search exposes display names.** Any signed-in user can look up people by name prefix (3+ characters, 30 searches per minute per IP, only `id` and `displayName`, never an email). Display names are chosen by users, so clients must never render them as HTML.
- **A removed invitation does not cut a live socket yet.** Access is checked on REST calls immediately, but a socket already subscribed to a private event keeps receiving updates until it reconnects (the TODO in the real-time contract). To be implemented with the real-time events.
- TODO: the rest of this document
