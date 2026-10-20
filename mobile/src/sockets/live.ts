import { io } from "socket.io-client";
import { buildClientHeaders } from "@/api/client-headers";
import { auth } from "@/auth";
import { getBackendUrl } from "@/settings/backend-url";
import { createLiveConnection } from "./live-connection";

// The app's live connection (ADR-034): `import { live } from "@/sockets/live"`.
export const live = createLiveConnection({
  createSocket: async () =>
    io(`${await getBackendUrl()}/live`, {
      autoConnect: false,
      // WebSocket only: in React Native it carries our logging headers in the handshake.
      transports: ["websocket"],
      // Read at every handshake, so a reconnect after a refresh sends the new token.
      auth: (send) => send({ token: auth.getAccessToken() }),
      // Platform, device and app version, logged by the backend like any request.
      extraHeaders: buildClientHeaders(),
    }),
  refreshAccessToken: () => auth.refreshAccessToken(),
});

// Signing out ends the live connection; signing back in lets a stopped one try again.
auth.subscribe(() => {
  const { status } = auth.getState();
  if (status === "signedOut") live.shutdown();
  else if (status === "signedIn") live.retry();
});
