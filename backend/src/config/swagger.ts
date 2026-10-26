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
      UserSummary: {
        type: "object",
        required: ["id", "displayName"],
        properties: {
          id: { type: "string", format: "uuid" },
          displayName: { type: "string" },
        },
      },
      Invitation: {
        type: "object",
        required: ["resourceId", "user", "invitedAt"],
        properties: {
          resourceId: { type: "string", format: "uuid" },
          user: { $ref: "#/components/schemas/UserSummary" },
          invitedAt: { type: "string", format: "date-time" },
        },
      },
      Track: {
        type: "object",
        required: ["providerTrackId", "title", "artist", "durationSeconds", "coverUrl"],
        properties: {
          providerTrackId: { type: "string", example: "3135556" },
          title: { type: "string" },
          artist: { type: "string" },
          durationSeconds: { type: "integer" },
          coverUrl: {
            type: "string",
            nullable: true,
            description: "https image on Deezer's own host, or null.",
          },
        },
      },
      EventTrack: {
        type: "object",
        required: [
          "id",
          "eventId",
          "track",
          "suggestedBy",
          "voteCount",
          "votedByMe",
          "status",
          "suggestedAt",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          eventId: { type: "string", format: "uuid" },
          track: { $ref: "#/components/schemas/Track" },
          suggestedBy: { type: "string", format: "uuid" },
          voteCount: { type: "integer", minimum: 0 },
          votedByMe: { type: "boolean" },
          status: { type: "string", enum: ["queued", "playing", "played"] },
          suggestedAt: { type: "string", format: "date-time" },
        },
      },
      EventQueueUpdate: {
        type: "object",
        required: ["eventId", "version", "tracks"],
        properties: {
          eventId: { type: "string", format: "uuid" },
          version: {
            type: "integer",
            description: "Ignore a snapshot whose version is not higher than yours.",
          },
          tracks: { type: "array", items: { $ref: "#/components/schemas/EventTrack" } },
        },
      },
      EditLicense: {
        oneOf: [
          {
            type: "object",
            required: ["type"],
            properties: { type: { enum: ["everyone"] } },
          },
          {
            type: "object",
            required: ["type"],
            properties: { type: { enum: ["invited_only"] } },
          },
        ],
      },
      Playlist: {
        type: "object",
        required: [
          "id",
          "name",
          "ownerId",
          "visibility",
          "editLicense",
          "createdAt",
          "myPermissions",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          ownerId: { type: "string", format: "uuid" },
          visibility: { type: "string", enum: ["public", "private"] },
          editLicense: { $ref: "#/components/schemas/EditLicense" },
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
      PlaylistSnapshot: {
        type: "object",
        required: ["playlistId", "version", "tracks"],
        properties: {
          playlistId: { type: "string", format: "uuid" },
          version: {
            type: "integer",
            description: "Ignore a snapshot whose version is not higher than yours.",
          },
          tracks: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "track", "addedBy", "addedAt"],
              properties: {
                id: {
                  type: "string",
                  format: "uuid",
                  description: "The entry, not the song: the same song can appear twice.",
                },
                track: { $ref: "#/components/schemas/Track" },
                addedBy: { type: "string", format: "uuid" },
                addedAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
      Profile: {
        type: "object",
        required: ["userId", "displayName", "publicInfo", "friendship"],
        description:
          "Only the blocks the caller may see are present: friendsInfo and musicPreferences for friends and the owner, privateInfo for the owner only. `friendship` says where the caller stands with the owner (ADR-042).",
        properties: {
          userId: { type: "string", format: "uuid" },
          displayName: { type: "string" },
          publicInfo: {
            type: "object",
            required: ["bio"],
            properties: { bio: { type: "string", nullable: true, maxLength: 280 } },
          },
          friendsInfo: {
            type: "object",
            required: ["fullName", "city"],
            properties: {
              fullName: { type: "string", nullable: true, maxLength: 80 },
              city: { type: "string", nullable: true, maxLength: 80 },
            },
          },
          musicPreferences: {
            type: "object",
            required: ["genres"],
            properties: {
              genres: {
                type: "array",
                maxItems: 10,
                items: { type: "string", maxLength: 30 },
              },
            },
          },
          privateInfo: {
            type: "object",
            required: ["phone", "birthDate"],
            properties: {
              phone: { type: "string", nullable: true, maxLength: 30 },
              birthDate: { type: "string", format: "date", nullable: true },
            },
          },
          friendship: {
            type: "object",
            nullable: true,
            required: ["id", "status", "direction"],
            description:
              "The pending request or friendship between the caller and the owner, from the caller's side; null when there is none, and on your own profile. `id` is what accept, decline and cancel take.",
            properties: {
              id: { type: "string", format: "uuid" },
              status: { type: "string", enum: ["pending", "accepted"] },
              direction: { type: "string", enum: ["incoming", "outgoing"] },
            },
          },
        },
      },
      UpdateProfileRequest: {
        type: "object",
        additionalProperties: false,
        description:
          "Absent = unchanged, null = clear. genres replaces the whole list. Unknown fields are rejected.",
        properties: {
          publicInfo: {
            type: "object",
            additionalProperties: false,
            properties: { bio: { type: "string", nullable: true, maxLength: 280 } },
          },
          friendsInfo: {
            type: "object",
            additionalProperties: false,
            properties: {
              fullName: { type: "string", nullable: true, maxLength: 80 },
              city: { type: "string", nullable: true, maxLength: 80 },
            },
          },
          privateInfo: {
            type: "object",
            additionalProperties: false,
            properties: {
              phone: { type: "string", nullable: true, maxLength: 30 },
              birthDate: { type: "string", format: "date", nullable: true },
            },
          },
          musicPreferences: {
            type: "object",
            additionalProperties: false,
            properties: {
              genres: {
                type: "array",
                maxItems: 10,
                items: { type: "string", maxLength: 30 },
              },
            },
          },
        },
      },
      Reauth: {
        description:
          "Proof that the caller owns the account, using a login method it ALREADY has (ADR-025): its password, or a fresh credential from a provider already linked to it.",
        oneOf: [
          {
            type: "object",
            required: ["method", "password"],
            additionalProperties: false,
            properties: {
              method: { type: "string", enum: ["password"] },
              password: { type: "string" },
            },
          },
          {
            type: "object",
            required: ["method", "provider", "credential"],
            additionalProperties: false,
            properties: {
              method: { type: "string", enum: ["provider"] },
              provider: { type: "string", enum: ["google", "facebook"] },
              credential: { type: "string" },
            },
          },
        ],
      },
      Friendship: {
        type: "object",
        required: ["id", "user", "status", "direction", "createdAt", "respondedAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          user: { $ref: "#/components/schemas/UserSummary" },
          status: { type: "string", enum: ["pending", "accepted"] },
          direction: {
            type: "string",
            enum: ["incoming", "outgoing"],
            description:
              "outgoing = the caller asked first; incoming = the other person did",
          },
          createdAt: { type: "string", format: "date-time" },
          respondedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      User: {
        type: "object",
        required: [
          "id",
          "displayName",
          "email",
          "emailVerified",
          "linkedProviders",
          "createdAt",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          displayName: { type: "string" },
          email: { type: "string", nullable: true },
          emailVerified: { type: "boolean" },
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
                  password: {
                    type: "string",
                    description:
                      "8 to 72 bytes (UTF-8), with a lowercase letter, an uppercase letter, a digit and a symbol",
                  },
                  displayName: { type: "string", minLength: 1, maxLength: 50 },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description:
              "Account created but not usable yet: a 6-digit code was emailed. Confirm it with POST /auth/verify-email, then log in.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: { email: { type: "string", format: "email" } },
                },
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
    "/api/v1/auth/verify-email": {
      post: {
        summary: "Confirm the email with the emailed code",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "code"],
                additionalProperties: false,
                properties: {
                  email: { type: "string", format: "email" },
                  code: {
                    type: "string",
                    pattern: "^\\d{6}$",
                    description: "The 6 digits from the email",
                  },
                },
              },
            },
          },
        },
        responses: {
          "204": { description: "Email confirmed; the user can now log in" },
          "400": {
            description:
              "VALIDATION_ERROR, or INVALID_CODE (wrong, expired, used up or unknown address: always the same answer)",
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
    "/api/v1/auth/resend-verification": {
      post: {
        summary: "Send a new confirmation code",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                additionalProperties: false,
                properties: {
                  email: { type: "string", format: "email" },
                },
              },
            },
          },
        },
        responses: {
          "204": {
            description:
              "Always the same answer: a code is sent only if an unconfirmed password account exists for this email, at most one per minute",
          },
          "400": {
            description: "VALIDATION_ERROR",
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
    "/api/v1/auth/forgot-password": {
      post: {
        summary: "Send a password reset code",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                additionalProperties: false,
                properties: {
                  email: { type: "string", format: "email" },
                },
              },
            },
          },
        },
        responses: {
          "204": {
            description:
              "Always the same answer: a code is sent only if a password account exists for this email, at most one per minute",
          },
          "400": {
            description: "VALIDATION_ERROR",
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
    "/api/v1/auth/reset-password": {
      post: {
        summary: "Set a new password with the emailed code",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "code", "newPassword"],
                additionalProperties: false,
                properties: {
                  email: { type: "string", format: "email" },
                  code: {
                    type: "string",
                    pattern: "^\\d{6}$",
                    description: "The 6 digits from the email",
                  },
                  newPassword: {
                    type: "string",
                    description:
                      "Same policy as register: 8 to 72 bytes with a lowercase letter, an uppercase letter, a digit and a symbol",
                  },
                },
              },
            },
          },
        },
        responses: {
          "204": {
            description:
              "Password changed, email confirmed, and every session of the user ended",
          },
          "400": {
            description:
              "VALIDATION_ERROR, or INVALID_CODE (wrong, expired, used up or unknown address: always the same answer)",
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
          "403": {
            description:
              "EMAIL_NOT_VERIFIED: the password is right but the email was never confirmed",
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
                required: ["credential", "reauth"],
                additionalProperties: false,
                properties: {
                  credential: {
                    type: "string",
                    description:
                      "Google ID token or Facebook access token of the account to link.",
                  },
                  reauth: { $ref: "#/components/schemas/Reauth" },
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
          "403": {
            description: "REAUTH_FAILED: wrong or unrelated proof of ownership",
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
          "Needs proof of ownership in the JSON body (reauth). Refused with LAST_LOGIN_METHOD if it is the only way left to log in.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["reauth"],
                additionalProperties: false,
                properties: { reauth: { $ref: "#/components/schemas/Reauth" } },
              },
            },
          },
        },
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
          "403": {
            description: "REAUTH_FAILED: wrong or unrelated proof of ownership",
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
    "/api/v1/events/{eventId}/invitations": {
      get: {
        summary: "Who is invited (owner only), newest invitation first",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "eventId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
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
            description: "A page",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "nextCursor"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Invitation" },
                    },
                    nextCursor: { type: "string", nullable: true },
                  },
                },
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
      post: {
        summary: "Invite a user (owner only); takes effect immediately",
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
                required: ["userId"],
                additionalProperties: false,
                properties: { userId: { type: "string", format: "uuid" } },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Invited",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Invitation" } },
            },
          },
          "400": {
            description: "VALIDATION_ERROR (also: inviting the owner)",
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
            description: "EVENT_NOT_FOUND, or NOT_FOUND for an unknown user",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description: "ALREADY_INVITED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/events/{eventId}/invitations/{userId}": {
      delete: {
        summary: "Remove an invitation (owner only); idempotent",
        description: "204 also when that user was not invited. Takes effect immediately.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "eventId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "204": { description: "Not invited any more" },
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
    "/api/v1/users/me/profile": {
      get: {
        summary: "Your own profile (all four blocks)",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "The profile",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Profile" } },
            },
          },
          "401": {
            description: "UNAUTHENTICATED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
      patch: {
        summary: "Change your own profile",
        description:
          "Only the fields sent change; null clears one. There is no user id: this can only ever edit the caller's profile.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateProfileRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "The updated profile",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Profile" } },
            },
          },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description: "UNAUTHENTICATED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/users/{userId}/profile": {
      get: {
        summary: "Someone's profile, only the blocks the caller may see",
        description:
          "Any signed-in user sees publicInfo; accepted friends also friendsInfo and musicPreferences; privateInfo only for the owner. Hidden blocks are omitted.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "The profile as the caller may see it",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Profile" } },
            },
          },
          "400": {
            description: "VALIDATION_ERROR (not a UUID)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "401": {
            description: "UNAUTHENTICATED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "USER_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/friends/requests": {
      post: {
        summary: "Send a friend request",
        description:
          "If the other person already asked you, the request is completed instead and the answer is 200 with status accepted. Rate limited.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["userId"],
                additionalProperties: false,
                properties: { userId: { type: "string", format: "uuid" } },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Request sent (pending)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Friendship" } },
            },
          },
          "200": {
            description: "The other person had already asked: now friends (accepted)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Friendship" } },
            },
          },
          "400": {
            description: "VALIDATION_ERROR (including a request to yourself)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "USER_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description: "FRIEND_REQUEST_EXISTS or ALREADY_FRIENDS",
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
      get: {
        summary: "Pending friend requests of the caller, in one direction",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "direction",
            in: "query",
            required: true,
            schema: { type: "string", enum: ["incoming", "outgoing"] },
          },
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
            description: "A page, newest first",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "nextCursor"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Friendship" },
                    },
                    nextCursor: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          "400": {
            description: "VALIDATION_ERROR",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/friends/requests/{requestId}/accept": {
      post: {
        summary: "Accept a friend request",
        description: "Only the person who RECEIVED the request can accept it.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "requestId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Now friends",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Friendship" } },
            },
          },
          "403": {
            description: "FORBIDDEN: you sent this request",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "FRIENDSHIP_NOT_FOUND (unknown, or not yours)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description: "ALREADY_FRIENDS",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/friends/requests/{requestId}": {
      delete: {
        summary: "Decline (addressee) or cancel (requester) a pending request",
        description:
          "Never removes an accepted friendship: use DELETE /friends/{userId} for that.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "requestId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "204": { description: "Removed" },
          "404": {
            description: "FRIENDSHIP_NOT_FOUND (unknown, not pending, or not yours)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/friends": {
      get: {
        summary: "The caller's friends, most recently accepted first",
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
            description: "A page",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "nextCursor"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Friendship" },
                    },
                    nextCursor: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/friends/{userId}": {
      delete: {
        summary: "Unfriend",
        description: "Either side can do it. Does not remove a pending request.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "204": { description: "No longer friends" },
          "404": {
            description: "FRIENDSHIP_NOT_FOUND (you are not friends with that user)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/users": {
      get: {
        summary: "Find users by display name (to invite them)",
        description:
          "Case-insensitive prefix match, at least 3 characters, never returns the caller. Only id and displayName are returned. Rate limited.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "query",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 3, maxLength: 50 },
          },
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
            description: "A page",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "nextCursor"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/UserSummary" },
                    },
                    nextCursor: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          "400": {
            description: "VALIDATION_ERROR (query too short, bad limit or cursor)",
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
          "429": {
            description: "RATE_LIMITED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/tracks/search": {
      get: {
        summary: "Search the music catalog (Deezer) for tracks to suggest",
        description:
          "One page of best matches, at most 25; nextCursor is always null. Rate limited because each search is a request to Deezer.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "query",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 2, maxLength: 100 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 25, default: 10 },
          },
        ],
        responses: {
          "200": {
            description: "Matching tracks",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "nextCursor"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Track" },
                    },
                    nextCursor: { type: "string", nullable: true },
                  },
                },
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
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
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
            description: "PROVIDER_UNAVAILABLE: the catalog could not be reached",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/events/{eventId}/tracks": {
      get: {
        summary: "The queue: playing track first, then queued tracks in ranking order",
        description:
          "Already ordered; do not re-sort. `version` grows with every change: ignore any snapshot whose version is not higher than the one you hold. Anyone who can see the event may read it.",
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
            description: "The queue",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EventQueueUpdate" },
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
      post: {
        summary: "Suggest a track (counts as your vote)",
        description:
          "Send only the catalog id; title, artist and cover come from the catalog. Needs the vote license; the catalog is not asked if you are refused. Rate limited.",
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
                required: ["providerTrackId"],
                properties: {
                  providerTrackId: { type: "string", example: "3135556" },
                  location: {
                    type: "object",
                    additionalProperties: false,
                    required: ["latitude", "longitude"],
                    properties: {
                      latitude: { type: "number", minimum: -90, maximum: 90 },
                      longitude: { type: "number", minimum: -180, maximum: 180 },
                      accuracyMeters: {
                        type: "number",
                        minimum: 0,
                        description: "Worse than 100 m counts as no usable location.",
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "The new queue entry",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/EventTrack" } },
            },
          },
          "400": {
            description: "VALIDATION_ERROR or LOCATION_REQUIRED",
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
            description: "NOT_INVITED, OUTSIDE_VOTING_AREA or OUTSIDE_VOTING_TIME",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "EVENT_NOT_FOUND or TRACK_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description:
              "TRACK_ALREADY_QUEUED: details holds the existing entry; vote for it instead",
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
    "/api/v1/events/{eventId}/tracks/{trackId}/vote": {
      put: {
        summary: "Vote for a queued track (idempotent)",
        description:
          "Repeating it changes nothing. The body is optional and only carries `location` for location_time events.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "eventId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "trackId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  location: {
                    type: "object",
                    additionalProperties: false,
                    required: ["latitude", "longitude"],
                    properties: {
                      latitude: { type: "number", minimum: -90, maximum: 90 },
                      longitude: { type: "number", minimum: -180, maximum: 180 },
                      accuracyMeters: {
                        type: "number",
                        minimum: 0,
                        description: "Worse than 100 m counts as no usable location.",
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "The entry with its new count",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/EventTrack" } },
            },
          },
          "400": {
            description: "VALIDATION_ERROR or LOCATION_REQUIRED",
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
            description: "NOT_INVITED, OUTSIDE_VOTING_AREA or OUTSIDE_VOTING_TIME",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "EVENT_NOT_FOUND or TRACK_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description: "TRACK_NOT_VOTABLE: the track is playing or played",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
      delete: {
        summary: "Withdraw your own vote (idempotent)",
        description:
          "Needs only that you can still see the event: no license and no location, so someone who left the area or lost an invitation can undo their vote.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "eventId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "trackId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "The entry with its new count",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/EventTrack" } },
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
            description: "EVENT_NOT_FOUND or TRACK_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description: "TRACK_NOT_VOTABLE: the track is playing or played",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/events/{eventId}/queue/advance": {
      post: {
        summary: "Move to the next track (owner only)",
        description:
          "The server picks the next track itself: most votes, then oldest suggestion. `currentTrackId` is the track the app believes is playing (null if none). If that is not the truth, nothing moves and the answer is 409 QUEUE_CHANGED, whose details hold the current queue: this makes a double tap harmless. With nothing playing and nothing queued it does nothing (200, version unchanged).",
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
                required: ["currentTrackId"],
                properties: {
                  currentTrackId: { type: "string", format: "uuid", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "The new queue",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EventQueueUpdate" },
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
          "409": {
            description: "QUEUE_CHANGED: nothing moved; details holds the current queue",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/playlists": {
      post: {
        summary: "Create a playlist (the caller becomes its owner)",
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
                  editLicense: { $ref: "#/components/schemas/EditLicense" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "The new playlist",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Playlist" } },
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
        summary: "Playlists you can see, newest first",
        description:
          "Public playlists, your own, and private ones you are invited to. Paginated with limit (1 to 100, default 20) and an opaque cursor.",
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
            description: "A page",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "nextCursor"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Playlist" },
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
    "/api/v1/playlists/{playlistId}": {
      get: {
        summary: "One playlist",
        description:
          "A private playlist you may not see is 404, the same as one that does not exist.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "playlistId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "The playlist, with myPermissions (a UI hint)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Playlist" } },
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
            description: "PLAYLIST_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
      patch: {
        summary: "Change name, visibility or edit license (owner only)",
        description:
          "At least one field. A new editLicense replaces the old one. Takes effect immediately.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "playlistId",
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
                  editLicense: { $ref: "#/components/schemas/EditLicense" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "The updated playlist",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Playlist" } },
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
            description: "FORBIDDEN: you can see the playlist but are not its owner",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "PLAYLIST_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
      delete: {
        summary: "Delete the playlist, its entries and its invitations (owner only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "playlistId",
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
            description: "PLAYLIST_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/playlists/{playlistId}/invitations": {
      get: {
        summary: "Who is invited (owner only), newest invitation first",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "playlistId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
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
            description: "A page",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "nextCursor"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Invitation" },
                    },
                    nextCursor: { type: "string", nullable: true },
                  },
                },
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
            description: "PLAYLIST_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
      post: {
        summary: "Invite a user (owner only); takes effect immediately",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "playlistId",
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
                required: ["userId"],
                additionalProperties: false,
                properties: { userId: { type: "string", format: "uuid" } },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Invited",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Invitation" } },
            },
          },
          "400": {
            description: "VALIDATION_ERROR (also: inviting the owner)",
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
            description: "PLAYLIST_NOT_FOUND, or NOT_FOUND for an unknown user",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description: "ALREADY_INVITED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/playlists/{playlistId}/invitations/{userId}": {
      delete: {
        summary: "Remove an invitation (owner only); idempotent",
        description: "204 also when that user was not invited. Takes effect immediately.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "playlistId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "204": { description: "Not invited any more" },
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
            description: "PLAYLIST_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/playlists/{playlistId}/tracks": {
      get: {
        summary: "The tracks in order, with the playlist's version",
        description:
          "Anyone who can see the playlist may read it. Positions are never exposed: the list is the order. Ignore any snapshot whose version is not higher than the one you hold.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "playlistId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "The ordered tracks",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PlaylistSnapshot" },
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
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "PLAYLIST_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
      post: {
        summary: "Add a track (at the end, or after an anchor)",
        description:
          "Send only the catalog id; title, artist and cover come from the catalog. Needs the edit license, and a refused request never reaches the catalog. At most 500 tracks. Rate limited.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "playlistId",
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
                required: ["providerTrackId"],
                properties: {
                  providerTrackId: { type: "string", example: "3135556" },
                  afterEntryId: {
                    type: "string",
                    format: "uuid",
                    description: "Omit to append.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "The new ordered tracks",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PlaylistSnapshot" },
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
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "403": {
            description: "NOT_INVITED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "PLAYLIST_NOT_FOUND or TRACK_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description: "ANCHOR_NOT_FOUND (refresh and retry) or PLAYLIST_FULL",
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
    "/api/v1/playlists/{playlistId}/tracks/{entryId}/move": {
      post: {
        summary: "Move an entry after another entry (or to the start)",
        description:
          "Expressed by intent, never by position. Moving an entry after itself, or to the place it already has, changes nothing: 200, same version.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "playlistId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "entryId",
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
                required: ["afterEntryId"],
                properties: {
                  afterEntryId: {
                    type: "string",
                    format: "uuid",
                    nullable: true,
                    description: "null moves it to the start.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "The new ordered tracks",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PlaylistSnapshot" },
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
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "403": {
            description: "NOT_INVITED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "PLAYLIST_NOT_FOUND or TRACK_NOT_FOUND (no such entry here)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "409": {
            description: "ANCHOR_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
        },
      },
    },
    "/api/v1/playlists/{playlistId}/tracks/{entryId}": {
      delete: {
        summary: "Remove an entry (idempotent)",
        description:
          "An entry that is already gone is not an error: 200, nothing changes, same version.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "playlistId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "entryId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "The new ordered tracks",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PlaylistSnapshot" },
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
            description: "UNAUTHENTICATED or TOKEN_EXPIRED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "403": {
            description: "NOT_INVITED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
            },
          },
          "404": {
            description: "PLAYLIST_NOT_FOUND",
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
