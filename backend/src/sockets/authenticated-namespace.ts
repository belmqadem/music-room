import type { Server } from "socket.io";

/**
 * SECURITY PLACEHOLDER: the "/live" namespace will carry real-time room events
 * (votes, playlist edits). It FAILS CLOSED: until the Core & Infra owner
 * implements token verification here, every connection is refused.
 * No event handlers are registered yet.
 */
export function registerAuthenticatedNamespace(io: Server): void {
  io.of("/live").use((_socket, next) => {
    // TODO(auth): verify the access token from socket.handshake.auth, attach the user.
    next(new Error("unauthorized"));
  });
}
