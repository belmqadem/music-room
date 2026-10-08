# API Contract

> Changes to this file or `shared/types/` need review from **every** team member:
> two people build against the contract.

## Conventions

TODO: base URL, versioning, JSON envelope, error format, pagination, date format.

## Authentication

TODO: token type, how it is sent, expiry/refresh.

## Required client headers

Every mobile request carries `X-Platform`, `X-Device`, `X-App-Version` (logged by the backend).

## Endpoints

### Health

- `GET /health` → `200 { "status": "ok" }` (no auth)

### Auth

TODO

### Rooms (visibility and permissions)

TODO

### Track Vote

TODO

### Playlist Editor

TODO

## Real-time events (Socket.io, namespace `/live`)

TODO: event names, payloads, auth handshake.

## Changelog

TODO: record every contract change (date, author, reviewers).
