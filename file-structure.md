# File structure

```
music-room/
├── Makefile                     # install, dev, db-up/down, migrate, lint, typecheck, test, format, clean
├── .env.example                 # root env: docker-compose + backend (copy to .env)
├── .gitignore
├── docker-compose.yml           # postgres + redis for local dev (healthchecks, named volumes)
├── package.json                 # root dev tooling only (eslint, prettier, typescript)
├── eslint.config.mjs  .prettierrc  tsconfig.base.json
├── .githooks/commit-msg         # Conventional Commits check (enabled by `make install`)
├── .github/                     # ci.yml, CODEOWNERS, PULL_REQUEST_TEMPLATE.md
├── DESIGN.md  design-tokens.json  # mobile design system: usage rules + the tokens exported from Stitch (unchanged)
├── design-tokens.extensions.json # tokens we add on top of the export (text.placeholder)
│
├── backend/                     # Node + Express 5 + TypeScript (strict)
│   ├── src/
│   │   ├── app.ts               # exports the Express app (no listen)
│   │   ├── server.ts            # entry point: env, DB/Redis, listen, Socket.io
│   │   ├── config/              # env validation, logger, OpenAPI document
│   │   ├── db/                  # postgres.ts, redis.ts, migrations/, models/
│   │   ├── middleware/          # authenticate, client-info, request-logger, rate-limit, error-handler
│   │   ├── sockets/             # Socket.io attach + authenticated /live namespace
│   │   └── modules/             # auth, users, access, track-vote, playlist-editor, logging
│   │                            #   each: controller/service/repository/schema/routes
│   ├── scripts/                 # generate-theme.mjs (design tokens -> theme)
│   └── tests/                   # health.test.ts, unit/, load/ (README only for now)
│
├── mobile/                      # Expo + Expo Router + NativeWind
│   ├── .env.example             # EXPO_PUBLIC_API_URL (first-launch default)
│   └── src/
│       ├── app/                 # Expo Router routes, thin re-exports of the screens: (auth)/ and (app)/ groups, (app)/(tabs)/
│       ├── api/                 # http-client (headers, JSON, errors), api-error; catalog search shared by both features (catalog-api, track-search, search-query)
│       ├── settings/            # runtime-configurable backend URL, SettingsScreen
│       ├── auth/                # auth-controller (session, refresh), token storage, useAuth; screens/ (welcome, sign-up, verify, sign-in, reset); forms/ (validation, messages, handoff); social/ (Google, Facebook)
│       ├── components/          # shared UI: Text, Button, Input, Card, Badge, Screen, ChoiceGroup, TrackRow, TrackPickRow (+ their pure *-styles.ts rules)
│       ├── theme/               # GENERATED from the tokens (make theme): colors, radius, typography, fonts, theme.generated.css
│       ├── sockets/             # the one live connection (/live): live-connection (tested logic) + live (the instance)
│       ├── dev/                 # TEMP: component gallery (/gallery) + temp-flags.ts, remove before release
│       └── features/            # profile/; track-vote/ (events list, event screen, queue-state, event-api); playlist-editor/ (placeholders)
│   └── tests/                   # vitest tests of the app's logic (api client, auth, queue state, live connection); screens are not tested here
│
├── shared/
│   └── types/                   # TS types mirrored from the API contract
│                                #   (type-only; imported as `@music-room/shared`)
└── docs/
    ├── api-contract.md          # A's contract, versioned as it evolves
    ├── mobile-handoff.md        # what the app must do, per screen and rule (for the mobile developer)
    ├── security.md              # hazards + mitigations writeup
    ├── architecture-decisions.md # REST vs alt, JSON vs alt, stack justification
    ├── ramp-up-results.md
    └── ai-usage.md              # running log of AI-generated work
```
