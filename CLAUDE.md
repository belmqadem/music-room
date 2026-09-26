@AGENTS.md

# CLAUDE.md

Guidance for Claude (or any AI assistant) working in this repository.

## Project context

Music Room is a 42 Network school project: a mobile app for collaborative,
real-time music sessions (live track voting and a shared, real-time
playlist editor), backed by a REST API and a database.

This is a graded academic project with a strict rule from the subject itself:
**the team must be able to explain and defend every decision in this repo,
in detail, without leaning on AI to do so.** Concretely, that means:

- Don't generate whole modules, architectures, or algorithms wholesale and
  hand them back unexplained. Prefer generating a first pass, then walking
  through _why_ it's structured that way, so the person reviewing it actually
  understands it.
- When there's a real design decision (concurrency strategy, auth flow,
  REST vs. an alternative, JSON vs. an alternative), surface the trade-offs
  rather than silently picking one — the team needs to be able to justify
  the choice at defense.
- Flag security-relevant code explicitly (auth, permission checks, token
  handling) rather than folding it in silently, since this is graded.
- If asked to change something that would remove or weaken an
  authorization/permission check, ask first — these are graded requirements,
  not incidental code.

## Team split

split by ownership:

- **Core & Infra** — auth (email/password + OAuth), the session/room model,
  the shared visibility (public/private) and permission engine, API
  scaffolding + docs, security/logging middleware.
- **Track Vote** — suggest/vote endpoints, ranking logic, concurrency
  handling for simultaneous votes, related mobile screens.
- **Playlist Editor** — real-time add/remove/reorder, concurrency handling
  for simultaneous edits, related mobile screens.

Respect this ownership boundary in the file structure — keep each area's
code in its own module rather than intermixing, so it's clear at a glance
who owns what.

## Non-negotiable constraints

- Backend is the single source of truth. The mobile app is a client only —
  no authoritative state lives on-device.
- Every endpoint needs both an authentication check (who is this) and an
  authorization check (do they have rights to _this_ resource) — never
  assume the second follows from the first.
- No committed third-party libraries in the repo; dependencies install via
  the Makefile from a clean clone.
- No secrets, keys, or credentials in the repo, ever — `.env` only, and it
  must be gitignored from the first commit.
- Every mobile-triggered action must produce a backend log entry with
  platform, device, and app version.
- Concurrency (simultaneous votes, simultaneous playlist edits) needs an
  explicit, intentional resolution strategy — not an implicit "it usually
  works."

## What "done" looks like for the mandatory part

Both Track Vote and Playlist Editor fully working, including their
visibility (public/private) and permission (open/restricted) modes, with
real-time updates, proper auth/authorization, logging, and load-test
results with justified server specs. The bonus part is not evaluated at all
unless the mandatory part is complete and fault-free — don't let bonus work
start before that's true.
