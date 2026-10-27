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

The team is two developers, split by layer:

- **belmqadem — backend, all three areas:**
  - **Core & Infra** — auth (email/password + OAuth), the session/room model,
    the shared visibility (public/private) and permission engine, API
    scaffolding + docs, security/logging middleware.
  - **Track Vote** — suggest/vote endpoints, ranking logic, concurrency
    handling for simultaneous votes.
  - **Playlist Editor** — real-time add/remove/reorder, concurrency handling
    for simultaneous edits.
- **kaouthar — mobile app (front end):** all screens and client code in
  `mobile/`, including the Track Vote and Playlist Editor screens.

The API contract (`shared/types/`, `docs/api-contract.md`) is the interface
between the two, so it is agreed jointly before either side builds on it.

Even with this split, the subject requires that **each developer can explain and
defend every decision in the repo**, not only their own layer. Walk each other
through your PRs.

Respect the ownership boundary in the file structure — keep each area's code in
its own module rather than intermixing (`backend/src/modules/*`,
`mobile/src/features/*`), so it's clear at a glance what belongs to what.

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

## Design system (mobile)

Before building or editing any screen or component, read DESIGN.md and
design-tokens.json. Use the theme generated from those tokens; never hardcode
colors, fonts, sizes or radii. If a needed value isn't a token, propose one.

## Copy and tone (mobile)

All user-facing text lives in one file, `mobile/src/copy.ts`, grouped by screen or feature, with
functions for text that takes values (`copy.tracks.votes(n)`). Screens and components import
`copy`; never write a user-facing string inline. Error codes from the backend are mapped to copy
on the mobile side (the `messages.ts` files); the backend's own messages are never shown.

**The voice.** The audience is young people: casual and relatable, like a friend talking, never a
corporate tool. Clarity always wins: jokes live in headlines and empty states; buttons, errors,
and permission or privacy text say exactly what happens.

- Short sentences, sentence case. No ALL CAPS in the words themselves, no long paragraphs.
- Talk to one person ("you"), never "users".
- Active voice: "You're in.", not "You have successfully joined."
- Buttons say what they do ("Create room", "Send code"), never "Submit" or "OK".
- An action keeps one name through its whole flow: "Add track" on the button, the sheet and any
  confirmation ("Track added").
- Errors are plain and specific, never apologetic or jokey: what went wrong, how to fix it.
- Light humor only in empty states and success moments, sparingly. No slang that dates quickly;
  "vibe" and "queue" are fine.
- No emoji unless the design already uses them.

**Vocabulary** (always these words, never a synonym):

- A Track Vote event is a **room** (the code and the API keep "event", ADR-038). The shared list
  is the **playlist**.
- Who can see it: **Public** / **Private** (the subject's words; "open" is not used for this).
- Who can vote in a room: **Everyone in the room**, **Invited people only**, **At the venue**.
  Who can edit a playlist: **Everyone who can see it**, **Invited people only**.
- The vote queue is **Up next** / **the queue**; voting is always **vote**. Adding is **Add track**
  (playlist) or **Suggest a track** (room).
- Profile tiers, where you choose who sees what (Edit profile): **Public**, **Friends only**,
  **Private**, **Music taste**. The profile itself names its sections by what they hold: **My bio**,
  **About me** (full name, city, phone, birth date), **My taste in music** on your own profile;
  **Bio**, **Music taste** on someone else's (their full name and city sit under their name).
- Friends: **Add friend**, **Cancel request**, **Accept** / **Decline**, **Unfriend**.
- Sign-in methods (Settings): **Link** / **Unlink**, **Linked** / **Not linked**; the proof step is
  **Confirm it's you**.
- The unique name people find you by is the **username** (the code and the API say `displayName`,
  ADR-046): **Pick your username** after sign-up, **Change username** in Settings.
- The two offers (ADR-048) are **Free** and **Premium**, on the **Plans** screen; switching is
  **Upgrade to Premium** / **Switch to Free**. Payment is simulated, and the text says so plainly.

**Rules for new text:**

- Any new screen, toast, error, empty state or notification follows this voice and vocabulary.
- Reuse the existing wording for the same action rather than inventing a new name for it.
- Permission, privacy and error text stays literal and precise: never make "Private" or
  "Invited people only" sound looser than the server's rule.
- A French or Arabic version would be another object of the same shape as `copy` (`Copy`).

## What "done" looks like for the mandatory part

Both Track Vote and Playlist Editor fully working, including their
visibility (public/private) and permission (open/restricted) modes, with
real-time updates, proper auth/authorization, logging, and load-test
results with justified server specs. The bonus part is not evaluated at all
unless the mandatory part is complete and fault-free — don't let bonus work
start before that's true.

## Git workflow

### Branches

- `main` is always stable and defense-ready. It only receives merges from
  `develop`, via PR.
- `develop` is the integration branch.
- Work happens on short-lived branches off `develop`.
- Naming: `<type>/<scope>-<short-description>`
  - types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`
  - scope = the module: `auth`, `access`, `track-vote`, `playlist-editor`,
    `mobile`, `shared`, `infra`
  - example: `feat/track-vote-ranking`

### Commits

Conventional Commits (`feat(track-vote): add ranking endpoint`), small and
focused. `make install` enables `.githooks/commit-msg`, which rejects other
formats.

### Pull requests

- Required for every merge into `develop` and `main`. No direct pushes to
  either.
- Reviewer: `@belmqadem` reviews every PR (the team is two developers, and
  `.github/CODEOWNERS` makes this automatic). kaouthar's PRs need belmqadem's
  approval. belmqadem cannot approve their own PRs (GitHub forbids it), so
  those merge through the ruleset's pull-request-only bypass: CI must still
  pass and the PR is still required. Discuss them with kaouthar and run
  `/code-review` first. The review is part of the learning, not a formality.
- Squash-merge into `develop`; merge-commit into `main`.
- Delete branches after merge.
- Rebase your branch on `develop` before opening a PR.
- Never force-push shared branches.
- Fill in `.github/PULL_REQUEST_TEMPLATE.md`, including the **AI usage**
  section, and add a row to `docs/ai-usage.md`.
- CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck and tests
  on every PR; it must be green.

### Contract changes

Changes to `shared/types/` or `docs/api-contract.md` need review from **both**
developers, since two people build against them. Because the code owner is a
single person, ask the other developer for a comment or approval on the PR
yourself; GitHub will not enforce it.

### Ownership

`.github/CODEOWNERS` lists `@belmqadem` for every path, so they are the single
required reviewer, including for kaouthar's mobile PRs. Who authors what (backend
vs. mobile) is the split described above, not enforced by CODEOWNERS.

### GitHub branch protection (manual, repo Settings → Branches)

Apply to both `main` and `develop`:

- [ ] Require a pull request before merging
- [ ] Require at least 1 approval
- [ ] Dismiss stale approvals when new commits are pushed
- [ ] Require review from Code Owners
- [ ] Require status checks to pass (select the `check` job from CI) and require
      branches to be up to date
- [ ] Require conversation resolution before merging
- [ ] Block force pushes
- [ ] Block branch deletion
- [ ] Bypass list: only the repo admin (belmqadem), mode **pull request only**
      (never direct pushes), so their own PRs can merge once CI is green

Merge methods (Settings → General → Pull Requests):

- [ ] `develop`: squash merging allowed. `main`: merge commits allowed (a ruleset
      can restrict the method per branch).
- [ ] Automatically delete head branches
