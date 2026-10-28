import type {
  AccessLost,
  EventQueueUpdate,
  PlaylistSnapshot,
  QueueSnapshot,
  SubscribeAck,
  SubscribeRequest,
} from "@music-room/shared";

// The one live connection of the app (Socket.io namespace /live, docs/api-contract.md "Real-time
// events", ADR-034). Screens subscribe to an event or a playlist; this module owns the socket:
// - it connects when the first screen subscribes and disconnects when the last one leaves; a new
//   socket is made each time, so a backend address changed in the settings is picked up;
// - the server forgets subscriptions on a disconnect, so after every (re)connect it subscribes again
//   and hands each screen the fresh state from the acknowledgement;
// - the token is checked only at the handshake: an expired one is refreshed once, then it reconnects.
// The socket is injected so all of this is tested without a server.

/** The part of a socket.io-client Socket used here. */
export interface LiveSocket {
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: (...args: never[]) => void): void;
  emit(
    event: string,
    payload: SubscribeRequest,
    ack?: (answer: SubscribeAck) => void,
  ): void;
}

export type LiveStatus = "idle" | "connecting" | "live" | "offline";

export interface Subscriber<Mine, Shared> {
  /** The state as I see it: from the subscribe acknowledgement, after every (re)connect. */
  onState(state: Mine): void;
  /** A change broadcast to everybody in the channel. */
  onUpdate(update: Shared): void;
  /** The server refused the subscription (NOT_FOUND, RATE_LIMITED, ...). */
  onRefused(code: string): void;
  /** Removed from the channel: no longer allowed to see it, or it was deleted. */
  onAccessLost(reason: AccessLost["reason"]): void;
}

export type EventSubscriber = Subscriber<EventQueueUpdate, QueueSnapshot>;
export type PlaylistSubscriber = Subscriber<PlaylistSnapshot, PlaylistSnapshot>;

export interface LiveConnectionDeps {
  /** A socket for the current backend address, not connected yet. */
  createSocket(): Promise<LiveSocket>;
  /** A new access token after TOKEN_EXPIRED; false when the session is over. May throw (offline). */
  refreshAccessToken(): Promise<boolean>;
}

type AnySubscriber = Subscriber<never, never>;
const keyOf = (r: SubscribeRequest) => `${r.resource}:${r.id}`;

export function createLiveConnection(deps: LiveConnectionDeps) {
  let socket: LiveSocket | null = null;
  let opening = false;
  let status: LiveStatus = "idle";
  // One refresh per failed handshake: a token refused again right after a refresh stops the loop.
  let refreshedSinceLastConnect = false;
  const channels = new Map<
    string,
    { request: SubscribeRequest; subscribers: Set<AnySubscriber> }
  >();
  const statusListeners = new Set<(status: LiveStatus) => void>();

  function setStatus(next: LiveStatus): void {
    if (next === status) return;
    status = next;
    statusListeners.forEach((listener) => listener(next));
  }

  function sendSubscribe(request: SubscribeRequest): void {
    socket?.emit("subscribe", request, (answer) => {
      const channel = channels.get(keyOf(request));
      if (!channel) return; // left while the answer was on its way
      channel.subscribers.forEach((s) =>
        answer.ok ? s.onState(answer.snapshot as never) : s.onRefused(answer.error.code),
      );
    });
  }

  function deliver(request: SubscribeRequest, notify: (s: AnySubscriber) => void): void {
    channels.get(keyOf(request))?.subscribers.forEach(notify);
  }

  function ensureOpen(): void {
    if (socket || opening) return;
    opening = true;
    setStatus("connecting");
    deps.createSocket().then(
      (created) => {
        opening = false;
        if (channels.size === 0) {
          setStatus("idle"); // everyone left while the socket was being made
          return;
        }
        listen(created);
        socket = created;
        created.connect();
      },
      (error: unknown) => {
        opening = false;
        console.warn("Could not create the live connection:", error);
        setStatus("offline");
      },
    );
  }

  function listen(created: LiveSocket): void {
    // A closed socket can still fire (its own "disconnect"): only the current one counts.
    const isCurrent = () => created === socket;
    created.on("connect", () => {
      if (!isCurrent()) return;
      refreshedSinceLastConnect = false;
      setStatus("live");
      channels.forEach(({ request }) => sendSubscribe(request));
    });
    created.on("disconnect", () => {
      // socket.io reconnects by itself after a lost transport; subscriptions are sent again then.
      if (isCurrent() && channels.size > 0) setStatus("connecting");
    });
    created.on("connect_error", (error: { data?: { code?: string } }) => {
      if (isCurrent()) void handleRefusedHandshake(error?.data?.code);
    });
    created.on("event:queue", (snapshot: QueueSnapshot) => {
      if (!isCurrent()) return;
      deliver({ resource: "event", id: snapshot.eventId }, (s) =>
        s.onUpdate(snapshot as never),
      );
    });
    created.on("playlist:updated", (snapshot: PlaylistSnapshot) => {
      if (!isCurrent()) return;
      deliver({ resource: "playlist", id: snapshot.playlistId }, (s) =>
        s.onUpdate(snapshot as never),
      );
    });
    created.on("event:access-lost", (lost: AccessLost) => {
      if (!isCurrent()) return;
      deliver({ resource: lost.resource, id: lost.id }, (s) =>
        s.onAccessLost(lost.reason),
      );
    });
  }

  async function handleRefusedHandshake(code: string | undefined): Promise<void> {
    // Not a refused token (server down, network): socket.io keeps retrying on its own.
    if (code !== "TOKEN_EXPIRED" && code !== "UNAUTHENTICATED") {
      setStatus("connecting");
      return;
    }
    // A refused handshake is not retried by socket.io: this decides whether to try again.
    if (code === "UNAUTHENTICATED" || refreshedSinceLastConnect) {
      setStatus("offline");
      return;
    }
    refreshedSinceLastConnect = true;
    try {
      if (!(await deps.refreshAccessToken())) {
        setStatus("offline"); // the session is over
        return;
      }
    } catch (error) {
      console.warn("Could not refresh the token for the live connection:", error);
      setStatus("offline");
      return;
    }
    if (channels.size > 0) socket?.connect(); // the handshake reads the new token
  }

  function subscribe(request: SubscribeRequest, subscriber: AnySubscriber): () => void {
    const key = keyOf(request);
    const channel = channels.get(key) ?? {
      request,
      subscribers: new Set<AnySubscriber>(),
    };
    channel.subscribers.add(subscriber);
    channels.set(key, channel);

    if (socket?.connected) {
      // Also for a channel already joined: the acknowledgement brings this subscriber up to date.
      sendSubscribe(request);
    } else if (socket && status === "offline") {
      setStatus("connecting");
      socket.connect();
    } else {
      ensureOpen(); // nothing to do if a socket is already on its way
    }

    return () => {
      channel.subscribers.delete(subscriber);
      if (channel.subscribers.size > 0) return;
      channels.delete(key);
      if (socket?.connected) socket.emit("unsubscribe", request);
      if (channels.size === 0) close();
    };
  }

  function close(): void {
    const closing = socket;
    socket = null;
    closing?.disconnect();
    setStatus("idle");
  }

  return {
    subscribeToEvent(eventId: string, subscriber: EventSubscriber): () => void {
      return subscribe({ resource: "event", id: eventId }, subscriber as AnySubscriber);
    },
    subscribeToPlaylist(playlistId: string, subscriber: PlaylistSubscriber): () => void {
      return subscribe(
        { resource: "playlist", id: playlistId },
        subscriber as AnySubscriber,
      );
    },
    getStatus: (): LiveStatus => status,
    onStatus(listener: (status: LiveStatus) => void): () => void {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    /** After an "offline" status (refused, signed back in): try again with the current token. */
    retry(): void {
      if (socket && channels.size > 0 && !socket.connected) {
        refreshedSinceLastConnect = false;
        setStatus("connecting");
        socket.connect();
      }
    },
    /** On sign-out: drop every subscription and the socket. */
    shutdown(): void {
      channels.clear();
      close();
    },
  };
}

export type LiveConnection = ReturnType<typeof createLiveConnection>;
