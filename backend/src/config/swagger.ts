// OpenAPI document served at /docs. Hand-written (not generated from comments)
// so the contract is explicit. Add each new route here as it is implemented.
export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Music Room API",
    version: "0.0.0",
    description: "REST API for Music Room (Track Vote and Playlist Editor).",
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      ApiError: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "details"],
            properties: {
              code: { type: "string", example: "VALIDATION_ERROR" },
              message: { type: "string" },
              details: { nullable: true },
            },
          },
        },
      },
      VoteLicense: {
        oneOf: [
          {
            type: "object",
            required: ["type"],
            properties: { type: { enum: ["everyone", "invited_only"] } },
          },
          {
            type: "object",
            required: [
              "type",
              "latitude",
              "longitude",
              "radiusMeters",
              "startsAt",
              "endsAt",
            ],
            properties: {
              type: { enum: ["location_time"] },
              latitude: { type: "number", minimum: -90, maximum: 90 },
              longitude: { type: "number", minimum: -180, maximum: 180 },
              radiusMeters: { type: "integer", minimum: 1, maximum: 100000 },
              startsAt: { type: "string", format: "date-time" },
              endsAt: {
                type: "string",
                format: "date-time",
                description: "Must be after startsAt.",
              },
            },
          },
        ],
      },
      MusicEvent: {
        type: "object",
        required: [
          "id",
          "name",
          "ownerId",
          "visibility",
          "voteLicense",
          "createdAt",
          "myPermissions",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          ownerId: { type: "string", format: "uuid" },
          visibility: { type: "string", enum: ["public", "private"] },
          voteLicense: { $ref: "#/components/schemas/VoteLicense" },
          createdAt: { type: "string", format: "date-time" },
          myPermissions: {
            type: "object",
            required: ["canView", "canAct", "canManage"],
            properties: {
              canView: { type: "boolean" },
              canAct: { type: "boolean" },
              canManage: { type: "boolean" },
            },
          },
        },
      },
      User: {
        type: "object",
        required: ["id", "displayName", "email", "linkedProviders", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          displayName: { type: "string" },
          email: { type: "string", nullable: true },
          linkedProviders: {
            type: "array",
            items: { type: "string", enum: ["google", "facebook"] },
          },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      AuthSession: {
        type: "object",
        required: ["accessToken", "refreshToken", "expiresIn", "user"],
        properties: {
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          expiresIn: {
            type: "integer",
            description: "Seconds until the access token expires",
            example: 900,
          },
          user: { $ref: "#/components/schemas/User" },
        },
      },
    },
  },
  paths: {
    "/api/v1/auth/register": {
      post: {
        summary: "Create an account with email and password",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password", "displayName"],
                additionalProperties: false,
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", description: "8 to 72 bytes (UTF-8)" },
                  displayName: { type: "string", minLength: 1, maxLength: 50 },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Account created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthSession" },
              },
            },
          },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description: "EMAIL_TAKEN",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "429": {
            description: "RATE_LIMITED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/auth/login": {
      post: {
        summary: "Log in with email and password",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                additionalProperties: false,
                properties: { email: { type: "string" }, password: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Logged in",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthSession" },
              },
            },
          },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description:
              "INVALID_CREDENTIALS (same answer for unknown email and wrong password)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "429": {
            description: "RATE_LIMITED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/auth/refresh": {
      post: {
        summary: "Exchange a refresh token for a new session (rotation)",
        description:
          "Consumes the presented refresh token and returns a new pair. Presenting a token that was already used revokes the whole session (strict reuse detection). No Authorization header is needed.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["refreshToken"],
                additionalProperties: false,
                properties: { refreshToken: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "New session",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthSession" },
              },
            },
          },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description:
              "INVALID_REFRESH_TOKEN (unknown, expired, revoked or already used)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "429": {
            description: "RATE_LIMITED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        summary: "Log out: revoke the session of the given refresh token",
        description:
          "Always answers 204, including for unknown tokens and tokens of another user (which are not revoked). The current access token stays valid until it expires.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["refreshToken"],
                additionalProperties: false,
                properties: { refreshToken: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "204": { description: "Session revoked (or nothing to revoke)" },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/users/me": {
      get: {
        summary: "The signed-in user",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "The user",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/User" } },
            },
          },
          "401": {
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/auth/oauth/{provider}": {
      post: {
        summary: "Sign up or log in with Google or Facebook",
        description:
          "The backend verifies the credential with the provider. A linked provider account logs in as its user; an unknown one creates a social-only account. No automatic linking by email: a matching verified email is EMAIL_TAKEN.",
        parameters: [
          {
            name: "provider",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["google", "facebook"] },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["credential"],
                additionalProperties: false,
                properties: {
                  credential: {
                    type: "string",
                    description:
                      "Google ID token or Facebook access token obtained by the app.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "A new session",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthSession" },
              },
            },
          },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description: "INVALID_PROVIDER_CREDENTIAL",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description: "EMAIL_TAKEN",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "429": {
            description: "RATE_LIMITED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "502": {
            description: "PROVIDER_UNAVAILABLE",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/users/me/providers/{provider}": {
      post: {
        summary: "Link a Google or Facebook account to the signed-in user",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "provider",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["google", "facebook"] },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["credential"],
                additionalProperties: false,
                properties: {
                  credential: {
                    type: "string",
                    description:
                      "Google ID token or Facebook access token obtained by the app.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "The user, with the provider linked",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/User" } },
            },
          },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description: "UNAUTHENTICATED, TOKEN_EXPIRED or INVALID_PROVIDER_CREDENTIAL",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description: "PROVIDER_ACCOUNT_LINKED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "429": {
            description: "RATE_LIMITED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "502": {
            description: "PROVIDER_UNAVAILABLE",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
      delete: {
        summary: "Unlink a provider from the signed-in user",
        description:
          "Refused with LAST_LOGIN_METHOD if it is the only way left to log in.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "provider",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["google", "facebook"] },
          },
        ],
        responses: {
          "200": {
            description: "The user, with the provider removed",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/User" } },
            },
          },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "The provider is not linked",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description: "LAST_LOGIN_METHOD",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/events": {
      post: {
        summary: "Create an event (the caller becomes its owner)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["name"],
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 100 },
                  visibility: { type: "string", enum: ["public", "private"] },
                  voteLicense: { $ref: "#/components/schemas/VoteLicense" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "The new event",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/MusicEvent" } },
            },
          },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
      get: {
        summary: "Events you can see, newest first",
        description:
          "Public events, your own, and private events you are invited to. Paginated with limit (1 to 100, default 20) and an opaque cursor.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: "cursor",
            in: "query",
            schema: { type: "string" },
            description: "nextCursor of the previous page.",
          },
        ],
        responses: {
          "200": {
            description: "A page of events",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "nextCursor"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/MusicEvent" },
                    },
                    nextCursor: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          "400": {
            description: "VALIDATION_ERROR (bad limit or cursor)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/events/{eventId}": {
      get: {
        summary: "One event",
        description:
          "A private event you may not see is 404, the same as an event that does not exist.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "eventId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "The event, with myPermissions (a UI hint)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/MusicEvent" } },
            },
          },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "EVENT_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
      patch: {
        summary: "Change name, visibility or vote license (owner only)",
        description:
          "At least one field. A new voteLicense replaces the whole license. Takes effect immediately.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "eventId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                minProperties: 1,
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 100 },
                  visibility: { type: "string", enum: ["public", "private"] },
                  voteLicense: { $ref: "#/components/schemas/VoteLicense" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "The updated event",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/MusicEvent" } },
            },
          },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "403": {
            description: "FORBIDDEN: you can see the event but are not its owner",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "EVENT_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
      delete: {
        summary: "Delete the event and its invitations (owner only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "eventId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "204": { description: "Deleted" },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "403": {
            description: "FORBIDDEN",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "EVENT_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/health": {
      get: {
        summary: "Liveness check",
        description:
          "Returns 200 if the process is up. Does not check Postgres or Redis.",
        responses: {
          "200": {
            description: "Service is alive",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: { status: { type: "string", example: "ok" } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
