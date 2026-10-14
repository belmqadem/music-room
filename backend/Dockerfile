# The backend as a container, for the load tests (docs/ramp-up-results.md) and as a model for
# deployment. Build from the REPOSITORY ROOT:  docker build -f backend/Dockerfile .
# (the shared types live outside backend/). Resource limits are set by docker-compose.yml,
# not here, so the same image can be measured with different specs.

FROM node:24-slim AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
RUN npm ci --prefix backend
COPY tsconfig.base.json ./
COPY shared/types shared/types
COPY backend backend
RUN npm run build --prefix backend

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
# Production dependencies only. bcrypt ships a prebuilt binary, so no compiler is needed.
RUN npm ci --omit=dev
COPY --from=build /app/backend/dist ./dist
# Not root: a bug in the server must not own the container.
USER node
EXPOSE 3000
CMD ["node", "dist/backend/src/server.js"]
