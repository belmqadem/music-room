# Architecture Decisions

Each decision must be defensible in detail at the defense. Copy the template for new ones.

## Template

```
### ADR-NNN: <title>
- Status: proposed | accepted | superseded by ADR-NNN
- Date: YYYY-MM-DD
- Deciders: <names>
- Context: what problem, what constraints?
- Options considered: A (pros/cons), B (pros/cons)
- Decision: what we chose
- Consequences: what gets easier, what gets harder, what we revisit
```

## Decisions

TODO: record each of these (scaffold choices are listed so they are not forgotten).

- REST vs alternative (GraphQL, gRPC)
- JSON vs alternative
- Stack: Node + Express 5 + TypeScript, Postgres, Redis, Socket.io, Expo Router
- No npm workspaces; shared types consumed type-only through a path alias
- node-pg-migrate with a raw `pg` driver (no ORM)
- Vitest + supertest
- pino logger; zod env validation; hand-written OpenAPI
- Zero-dependency commit-msg git hook
- Concurrency strategy: simultaneous votes
- Concurrency strategy: simultaneous playlist edits
- Load-test tool
