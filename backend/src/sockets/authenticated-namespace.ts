import type { ApiErrorCode, SubscribeAck, UnsubscribeAck } from "@music-room/shared";
import type pg from "pg";
import type { Logger } from "pino";
import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { HttpError } from "../http-error.js";
import { parseClientInfo, type ClientInfo } from "../middleware/client-info.js";
import { AccessTokenError, verifyAccessToken } from "../modules/auth/access-token.js";
import { accessOf, findEvent } from "../modules/track-vote/repository.js";
import { readQueueFor } from "../modules/track-vote/queue-service.js";
import { requireView, toHttpError } from "../modules/access/guards.js";
import { eventRoom } from "./realtime.js";

declare module "socket.io" {
  interface SocketData {
    userId: string;
    client: ClientInfo;
  }
}

export interface NamespaceDependencies {
  jwtSecret: string;
  logger: Logger;
  /** Where the permission checks and the queue snapshots come from. */
  pool: pg.Pool;
}

/** A socket may follow at most this many events at once. */
export const MAX_SUBSCRIPTIONS_PER_SOCKET = 25;

const subscriptionSchema = z.object({
  resource: z.enum(["event", "playlist"]),
  id: z.uuid(),
});

type Failure = { ok: false; error: { code: ApiErrorCode; message: string } };

function failure(code: ApiErrorCode, message: string): Failure {
  return { ok: false, error: { code, message } };
}

/** Any 404 is simply "not found" for a subscription: a hidden event looks like a missing one. */
function failureFrom(error: unknown, logger: Logger): Failure {
  if (error instanceof HttpError) {
    return failure(error.status === 404 ? "NOT_FOUND" : error.code, error.message);
  }
  logger.error({ err: error }, "socket subscription failed unexpectedly");
  return failure("INTERNAL_ERROR", "Something went wrong.");
}

const subscriptionCount = (socket: Socket): number =>
  [...socket.rooms].filter((room) => room.startsWith("event:")).length;

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

    // subscribe: follow the live queue of an event. The identity is the one from the
    // handshake; whatever the message claims about who is asking is never used.
    socket.on("subscribe", async (payload: unknown, callback: unknown) => {
      const ack: (reply: SubscribeAck) => void =
        typeof callback === "function"
          ? (callback as (reply: SubscribeAck) => void)
          : () => {};
      const parsed = subscriptionSchema.safeParse(payload);
      if (!parsed.success)
        return ack(failure("VALIDATION_ERROR", "Invalid subscription."));
      if (parsed.data.resource !== "event") {
        return ack(failure("NOT_FOUND", "Playlists cannot be followed live yet."));
      }

      const eventId = parsed.data.id;
      const room = eventRoom(eventId);
      if (
        !socket.rooms.has(room) &&
        subscriptionCount(socket) >= MAX_SUBSCRIPTIONS_PER_SOCKET
      ) {
        return ack(failure("RATE_LIMITED", "Too many subscriptions on this connection."));
      }
      try {
        // 1. May this user see the event? Asked BEFORE joining, so a stranger is never in the room.
        const event = await findEvent(deps.pool, eventId, userId);
        if (!event) throw toHttpError("event", "NOT_FOUND");
        const access = accessOf(event, userId);
        requireView("event", access.resource, access.subject);

        await socket.join(room);

        // 2. Asked again AFTER joining, and this is the one that counts: access removed
        // between the first look and the join would otherwise leave them in the room, and it
        // also reads the queue, so nothing that changes from now on can be missed.
        const snapshot = await readQueueFor(deps.pool, userId, eventId);
        deps.logger.info(
          { socketId: socket.id, userId, eventId, client },
          "socket subscribed",
        );
        ack({ ok: true, snapshot });
      } catch (error) {
        await socket.leave(room);
        deps.logger.info(
          { socketId: socket.id, userId, eventId, client },
          "socket subscription refused",
        );
        ack(failureFrom(error, deps.logger));
      }
    });

    socket.on("unsubscribe", async (payload: unknown, callback: unknown) => {
      const ack: (reply: UnsubscribeAck) => void =
        typeof callback === "function"
          ? (callback as (reply: UnsubscribeAck) => void)
          : () => {};
      const parsed = subscriptionSchema.safeParse(payload);
      if (!parsed.success)
        return ack(failure("VALIDATION_ERROR", "Invalid subscription."));
      if (parsed.data.resource === "event") await socket.leave(eventRoom(parsed.data.id));
      ack({ ok: true });
    });
    socket.on("disconnect", (reason) => {
      deps.logger.info({ socketId: socket.id, userId, reason }, "socket disconnected");
    });
  });
}
