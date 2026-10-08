// OpenAPI document served at /docs. Hand-written (not generated from comments)
// so the contract is explicit. Add each new route here as it is implemented.
export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Music Room API",
    version: "0.0.0",
    description: "REST API for Music Room (Track Vote and Playlist Editor).",
  },
  paths: {
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
