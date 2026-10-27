# Music Room — one entry point for common tasks. Run `make help`.
# Dependencies are installed from lockfiles (npm ci); nothing third-party is committed.

.DEFAULT_GOAL := help
.PHONY: help install dev dev-mobile theme icons db-up db-down loadtest-up loadtest-down loadtest migrate lint typecheck test test-integration format format-check clean

# Loads the root .env into the environment of a command (used by `migrate`).
LOAD_ENV = set -a; . ./.env; set +a;

help: ## List available targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

install: ## Install all dependencies (root, backend, mobile, shared) and enable git hooks
	npm ci
	npm ci --prefix backend
	npm ci --prefix mobile
	@# Enables the Conventional Commits check in .githooks/commit-msg
	git config core.hooksPath .githooks

dev: ## Run the backend in watch mode (needs `make db-up` and a .env)
	npm run dev --prefix backend

theme: ## Regenerate the mobile theme from design-tokens.json (+ design-tokens.extensions.json); `make test` fails if it is out of date
	node mobile/scripts/generate-theme.mjs

icons: ## Regenerate the app's icon files from mobile/assets/images/logo.png (check them before committing)
	node mobile/scripts/generate-icons.mjs

dev-mobile: ## Start the Expo dev server for the development build (interactive; Expo Go: `npx expo start --go` in mobile/)
	npm run start --prefix mobile

db-up: ## Start Postgres + Redis and wait until healthy
	docker compose up -d --wait

db-down: ## Stop Postgres + Redis (data volumes are kept)
	docker compose down

loadtest-up: ## Build and start the backend CONTAINER with fixed resources (BACKEND_CPUS / BACKEND_MEMORY in .env) plus Postgres + Redis, for load tests
	docker compose --profile loadtest up -d --build --wait

loadtest: ## Run the ramp-up load test against the container (needs loadtest-up + migrate). LOAD_STEPS, LOAD_HOLD_SECONDS, LOAD_OUT: see backend/tests/load/README.md
	$(LOAD_ENV) npm run loadtest --prefix backend

loadtest-down: ## Stop the load-test backend (Postgres + Redis keep running; use db-down to stop them)
	docker compose --profile loadtest stop backend

migrate: ## Apply pending database migrations (needs db-up)
	$(LOAD_ENV) npm run migrate --prefix backend -- up

lint: ## ESLint on backend + shared (root config) and mobile (Expo config)
	npx eslint .
	npm run lint --prefix mobile

typecheck: ## Type-check shared, backend and mobile
	npm run typecheck --prefix shared/types
	npm run typecheck --prefix backend
	npm run typecheck --prefix mobile

test: ## Run backend tests (database/Redis tests are skipped unless TEST_DATABASE_URL / TEST_REDIS_URL are set) and the app's logic tests
	npm run test --prefix backend
	npm run test --prefix mobile

test-integration: ## Run all backend tests incl. database + Redis tests (needs db-up + migrate; uses .env)
	$(LOAD_ENV) TEST_DATABASE_URL="$$DATABASE_URL" TEST_REDIS_URL="$$REDIS_URL" npm run test --prefix backend
	npm run test --prefix mobile

format: ## Format the whole repo with Prettier
	npx prettier --write .

format-check: ## Fail if any file is not Prettier-formatted (used by CI)
	npx prettier --check .

clean: ## Remove node_modules and build/test output (keeps .env and DB volumes)
	rm -rf node_modules backend/node_modules mobile/node_modules shared/types/node_modules
	rm -rf backend/dist backend/coverage mobile/dist mobile/.expo
