import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import {
  registerAuthenticatedNamespace,
  type NamespaceDependencies,
} from "./authenticated-namespace.js";

export interface SocketDependencies extends NamespaceDependencies {
  /** Browser origins allowed to open a socket (web client). Default: none. */
  allowedOrigins?: string[];
}

/**
 * Attaches Socket.io to the HTTP server and registers the namespaces.
 * The origin list only affects the HTTP long-polling requests browsers make;
 * browsers do not apply CORS to WebSockets. That is safe here because the
 * handshake is authenticated with a token in the payload, not a cookie, so a
 * hostile page has nothing to ride on.
 */
export function attachSockets(httpServer: HttpServer, deps: SocketDependencies): Server {
  const io = new Server(httpServer, { cors: { origin: deps.allowedOrigins ?? [] } });
  registerAuthenticatedNamespace(io, deps);
  return io;
}
