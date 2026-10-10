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
