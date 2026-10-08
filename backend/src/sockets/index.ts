import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { registerAuthenticatedNamespace } from "./authenticated-namespace.js";

/** Attaches Socket.io to the HTTP server and registers the namespaces. */
export function attachSockets(httpServer: HttpServer): Server {
  const io = new Server(httpServer);
  registerAuthenticatedNamespace(io);
  return io;
}
