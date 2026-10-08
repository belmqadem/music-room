music-room/
├── Makefile
├── .env.example
├── .gitignore
├── docker-compose.yml # postgres + redis for local dev
│
├── backend/
│
├── mobile/
│
├── shared/
│ └── types/ # TS types/interfaces mirrored from the API contract
│ # (single source of truth so backend & mobile don't drift)
└── docs/
├── api-contract.md # A's contract, versioned as it evolves
├── security.md # hazards + mitigations writeup
├── architecture-decisions.md # REST vs alt, JSON vs alt, stack justification
└── ramp-up-results.md
