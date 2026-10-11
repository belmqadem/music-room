import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import {
  registerAuthenticatedNamespace,
  type NamespaceDependencies,
} from "./authenticated-namespace.js";

/** Attaches Socket.io to the HTTP server and registers the namespaces. */
export function attachSockets(
  httpServer: HttpServer,
  deps: NamespaceDependencies,
): Server {
  const io = new Server(httpServer);
  registerAuthenticatedNamespace(io, deps);
  return io;
}
