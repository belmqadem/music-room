# Music Room

**Music, collaboration, and mobility.**

Music Room is a mobile app for shaping a room's music together, in real time.
Instead of one person controlling the aux cord, everyone in the session gets
a say in what plays next.

## What it does

When people are gathered — a party, a studio session, a get-together — Music
Room turns the shared playlist into something the whole room builds together:

- **Vote on what plays next.** Suggest a track or vote for one already in the
  queue. Popular tracks rise to the top and play sooner.
- **Edit a playlist together, live.** Build a shared playlist with friends or
  people who share your taste — everyone's changes show up instantly, for
  everyone.
- **Control who's in charge.** Sessions can be open to anyone nearby, or
  invite-only. The person running the session decides who gets to vote, who
  gets to edit, and who gets to control playback.

## Why we're building it

Listening to music is personal, but a lot of the best musical moments happen
in a group — a party that shifts the moment someone drops the right song, a
road trip where the aux cord gets passed around all night. Most music apps
are built for one listener. Music Room is built for the room.

## Getting started

You need Node 22 or newer (the Docker image uses 24), npm and Docker (running).

```
git clone https://github.com/belmqadem/music-room.git && cd music-room
cp .env.example .env                    # then edit it, see below
cp mobile/.env.example mobile/.env      # EXPO_PUBLIC_API_URL: where the app finds the backend
make install                            # dependencies from the lock files + commit-message hook
make db-up                              # Postgres and Redis in Docker
make migrate                            # create the database tables
make dev                                # backend on http://localhost:3000 (API docs at /docs)
make dev-mobile                         # Expo dev server for the app
```

In `.env`, replace `JWT_ACCESS_SECRET` (the server refuses to start with the placeholder; generate one with
`openssl rand -base64 48`) and `POSTGRES_PASSWORD` (then update the same password in `DATABASE_URL`). Everything else
works as it is. With the default `MAIL_TRANSPORT=console`, the 6-digit verification codes are printed in the backend's
terminal instead of being emailed; see `.env.example` for real mail, Google and Facebook sign-in.

Other useful targets (`make help` lists them all): `make test-integration` (all backend tests, needs `db-up` and
`migrate`), `make lint`, `make typecheck`, `make format-check`, and `make loadtest-up` / `make loadtest` for the load
test (`backend/tests/load/README.md`).

Where to read more: `docs/api-contract.md` (the API), `docs/mobile-handoff.md` (what the app must do),
`docs/architecture-decisions.md`, `docs/security.md`, `docs/ramp-up-results.md`, and `file-structure.md`.

## Project status

This is a school project (42 Network), built by a team of two as a
full-stack, mobile-first application: a live backend, an API connecting it
to the app, and a mobile client people actually use during a session.

## Team

Built by two developers: one on the backend (accounts, sessions, permissions
and the two live features, Track Vote and Playlist Editor) and one on the mobile
app.
