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
│   └── tests/                   # health.test.ts, unit/, load/ (README only for now)
│
├── mobile/                      # Expo + Expo Router + NativeWind
│   ├── .env.example             # EXPO_PUBLIC_API_URL (first-launch default)
│   └── src/
│       ├── app/                 # Expo Router routes (navigation lives here)
│       ├── api/                 # REST client + X-Platform/X-Device/X-App-Version headers
│       ├── settings/            # runtime-configurable backend URL
│       ├── sockets/  auth/      # stubs
│       └── features/            # track-vote/, playlist-editor/ (stubs)
│
├── shared/
│   └── types/                   # TS types mirrored from the API contract
│                                #   (type-only; imported as `@music-room/shared`)
└── docs/
    ├── api-contract.md          # A's contract, versioned as it evolves
    ├── security.md              # hazards + mitigations writeup
    ├── architecture-decisions.md # REST vs alt, JSON vs alt, stack justification
    ├── ramp-up-results.md
    └── ai-usage.md              # running log of AI-generated work
```
