import type { Server as HttpServer } from "node:http";
import type pg from "pg";
import type { Logger } from "pino";
import { Server } from "socket.io";
import type { RealtimeEvents } from "../realtime-events.js";
import { registerAuthenticatedNamespace } from "./authenticated-namespace.js";
import { createRealtimeHub } from "./realtime.js";

export interface SocketDependencies {
  jwtSecret: string;
  logger: Logger;
  pool: pg.Pool;
  /** Browser origins allowed to open a socket (web client). Default: none. */
  allowedOrigins?: string[];
}

/**
 * Builds the Socket.io server and the hub that feeds it, WITHOUT attaching it to an HTTP
 * server yet. The order matters: the app needs `events` (so its services can announce
 * changes), and the HTTP server needs the app, so the socket server is attached last.
 *
 * The origin list only affects the HTTP long-polling requests browsers make; browsers do
 * not apply CORS to WebSockets. That is safe here because the handshake is authenticated
 * with a token in the payload, not a cookie, so a hostile page has nothing to ride on.
 */
export function createRealtime(deps: SocketDependencies): {
  io: Server;
  events: RealtimeEvents;
} {
  const io = new Server({ cors: { origin: deps.allowedOrigins ?? [] } });
  registerAuthenticatedNamespace(io, deps);
  return { io, events: createRealtimeHub({ io, pool: deps.pool, logger: deps.logger }) };
}

/** Convenience for tests that only need sockets: build and attach in one go. */
export function attachSockets(httpServer: HttpServer, deps: SocketDependencies): Server {
  const { io } = createRealtime(deps);
  io.attach(httpServer);
  return io;
}
