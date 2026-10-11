import type { Server } from "socket.io";
import type { Logger } from "pino";
import { parseClientInfo, type ClientInfo } from "../middleware/client-info.js";
import { AccessTokenError, verifyAccessToken } from "../modules/auth/access-token.js";

declare module "socket.io" {
  interface SocketData {
    userId: string;
    client: ClientInfo;
  }
}

export interface NamespaceDependencies {
  jwtSecret: string;
  logger: Logger;
}

/**
 * The "/live" namespace carries real-time room events (votes, playlist edits).
 * AUTHENTICATION happens once, at the handshake: `auth: { token }` must be a
 * valid access token, otherwise the connection is refused BEFORE it is
 * established. Failing closed: any problem other than a verified token refuses.
 *
 * Known limit (decided): the token is not re-checked after the handshake, so a
 * socket stays valid after the 15-minute token expires. Authorization is not
 * done here: each `subscribe` must re-check the user's rights on its resource.
 */
export function registerAuthenticatedNamespace(
  io: Server,
  deps: NamespaceDependencies,
): void {
  const live = io.of("/live");

  live.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth["token"];
    const client = parseClientInfo((name) => {
      const value = socket.handshake.headers[name];
      return typeof value === "string" ? value : undefined;
    });
    try {
      if (typeof token !== "string" || token === "")
        throw new AccessTokenError("invalid");
      const { userId } = await verifyAccessToken(token, deps.jwtSecret);
      socket.data.userId = userId;
      socket.data.client = client;
      next();
    } catch (error) {
      if (!(error instanceof AccessTokenError)) {
        deps.logger.error({ err: error }, "socket handshake failed unexpectedly");
        next(Object.assign(new Error("internal"), { data: { code: "INTERNAL_ERROR" } }));
        return;
      }
      // Same codes as REST, so the app handles both the same way: refresh on TOKEN_EXPIRED.
      const code = error.reason === "expired" ? "TOKEN_EXPIRED" : "UNAUTHENTICATED";
      deps.logger.warn({ code, client }, "socket handshake refused");
      next(Object.assign(new Error("unauthorized"), { data: { code } }));
    }
  });

  live.on("connection", (socket) => {
    const { userId, client } = socket.data;
    deps.logger.info({ socketId: socket.id, userId, client }, "socket connected");
    socket.on("disconnect", (reason) => {
      deps.logger.info({ socketId: socket.id, userId, reason }, "socket disconnected");
    });
  });
}
