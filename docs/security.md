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

- **Location+time license can be faked.** The coordinates come from the phone, so a determined user can send false ones. Mitigations to apply: the server checks the time with its own clock, rejects poor accuracy, and rate limits votes. This is a limitation to state at the defense, not a solved problem.
- **A socket outlives its access token.** `/live` verifies the token once, at the handshake, so a connection stays open after the 15-minute token expires (or after logout). Accepted for simplicity. Mitigations: every `subscribe` re-checks the user's rights on the resource, and the app reconnects with a fresh token whenever it refreshes. Alternatives rejected: disconnecting at token expiry (timer per socket and a reconnect every 15 minutes) and a `reauth` event (most states to test).
- TODO: the rest of this document
