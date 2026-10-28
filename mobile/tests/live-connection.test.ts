import type {
  EventQueueUpdate,
  QueueSnapshot,
  SubscribeAck,
  SubscribeRequest,
} from "@music-room/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveConnection,
  type EventSubscriber,
  type LiveSocket,
  type LiveStatus,
} from "@/sockets/live-connection";

// The live connection (ADR-034) against a fake socket that the test drives like the server would.

class FakeSocket implements LiveSocket {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  readonly emitted: { event: string; payload: SubscribeRequest }[] = [];
  /** subscribe acknowledgements not answered yet, in order. */
  readonly pendingAcks: ((answer: SubscribeAck) => void)[] = [];
  private readonly handlers = new Map<string, ((...args: never[]) => void)[]>();

  connect(): void {
    this.connectCalls += 1;
  }
  disconnect(): void {
    this.disconnectCalls += 1;
    this.connected = false;
  }
  on(event: string, handler: (...args: never[]) => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }
  emit(
    event: string,
    payload: SubscribeRequest,
    ack?: (answer: SubscribeAck) => void,
  ): void {
    this.emitted.push({ event, payload });
    if (ack) this.pendingAcks.push(ack);
  }

  // ---- the "server" side ----
  fire(event: string, ...args: unknown[]): void {
    (this.handlers.get(event) ?? []).forEach((h) =>
      (h as (...a: unknown[]) => void)(...args),
    );
  }
  acceptHandshake(): void {
    this.connected = true;
    this.fire("connect");
  }
  refuseHandshake(code: string): void {
    this.fire("connect_error", { message: code, data: { code } });
  }
  dropTransport(): void {
    this.connected = false;
    this.fire("disconnect", "transport close");
  }
  answerNext(answer: SubscribeAck): void {
    this.pendingAcks.shift()!(answer);
  }
  subscribes(): string[] {
    return this.emitted.filter((e) => e.event === "subscribe").map((e) => e.payload.id);
  }
}

function queue(version: number, eventId = "e1"): EventQueueUpdate {
  return { eventId, version, tracks: [] };
}

function recorder(): EventSubscriber & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    onState: (s) => log.push(`state v${s.version}`),
    onUpdate: (u) => log.push(`update v${u.version}`),
    onRefused: (code) => log.push(`refused ${code}`),
    onAccessLost: (reason) => log.push(`lost ${reason}`),
  };
}

function setup(refresh: () => Promise<boolean> = async () => true) {
  const sockets: FakeSocket[] = [];
  const refreshAccessToken = vi.fn(refresh);
  const live = createLiveConnection({
    createSocket: async () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    refreshAccessToken,
  });
  const statuses: LiveStatus[] = [];
  live.onStatus((s) => statuses.push(s));
  return { live, sockets, refreshAccessToken, statuses, socket: () => sockets[0]! };
}

/** Lets the socket factory (async: it reads the backend address) finish. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("connecting and subscribing", () => {
  it("does not connect until a screen subscribes", () => {
    const { live, sockets } = setup();

    expect(sockets).toHaveLength(0);
    expect(live.getStatus()).toBe("idle");
  });

  it("connects on the first subscription, subscribes once connected, and hands over the state", async () => {
    const { live, socket, statuses } = setup();
    const screen = recorder();

    live.subscribeToEvent("e1", screen);

    await flush();
    expect(socket().connectCalls).toBe(1);
    expect(socket().subscribes()).toEqual([]); // not before the handshake

    socket().acceptHandshake();
    socket().answerNext({ ok: true, snapshot: queue(4) });

    expect(socket().emitted[0]).toEqual({
      event: "subscribe",
      payload: { resource: "event", id: "e1" },
    });
    expect(screen.log).toEqual(["state v4"]);
    expect(statuses).toEqual(["connecting", "live"]);
  });

  it("uses one socket for several events", async () => {
    const { live, sockets, socket } = setup();
    live.subscribeToEvent("e1", recorder());
    await flush();
    socket().acceptHandshake();

    live.subscribeToEvent("e2", recorder());

    expect(sockets).toHaveLength(1);
    expect(socket().subscribes()).toEqual(["e1", "e2"]);
  });

  it("gives a second screen on the same event the current state too", async () => {
    const { live, socket } = setup();
    const first = recorder();
    const second = recorder();
    live.subscribeToEvent("e1", first);
    await flush();
    socket().acceptHandshake();
    socket().answerNext({ ok: true, snapshot: queue(1) });

    live.subscribeToEvent("e1", second);
    socket().answerNext({ ok: true, snapshot: queue(2) });

    expect(second.log).toEqual(["state v2"]);
  });

  it("reports a refused subscription (NOT_FOUND: missing, or private and not allowed)", async () => {
    const { live, socket } = setup();
    const screen = recorder();
    live.subscribeToEvent("e1", screen);
    await flush();
    socket().acceptHandshake();

    socket().answerNext({ ok: false, error: { code: "NOT_FOUND", message: "x" } });

    expect(screen.log).toEqual(["refused NOT_FOUND"]);
  });

  it("drops an acknowledgement that arrives after the screen left", async () => {
    const { live, socket } = setup();
    const screen = recorder();
    const leave = live.subscribeToEvent("e1", screen);
    await flush();
    socket().acceptHandshake();
    leave();

    socket().answerNext({ ok: true, snapshot: queue(1) });

    expect(screen.log).toEqual([]);
  });
});

describe("updates from the server", () => {
  async function subscribed() {
    const ctx = setup();
    const e1 = recorder();
    const e2 = recorder();
    ctx.live.subscribeToEvent("e1", e1);
    ctx.live.subscribeToEvent("e2", e2);
    await flush();
    ctx.socket().acceptHandshake();
    return { ...ctx, e1, e2 };
  }

  it("routes each queue snapshot to the screens of that event only", async () => {
    const { socket, e1, e2 } = await subscribed();
    const snapshot: QueueSnapshot = { eventId: "e2", version: 9, tracks: [] };

    socket().fire("event:queue", snapshot);

    expect(e2.log).toEqual(["update v9"]);
    expect(e1.log).toEqual([]);
  });

  it("tells the screen when access is lost (uninvited, made private, or deleted)", async () => {
    const { socket, e1 } = await subscribed();

    socket().fire("event:access-lost", {
      resource: "event",
      id: "e1",
      reason: "deleted",
    });

    expect(e1.log).toEqual(["lost deleted"]);
  });

  it("does not confuse an event and a playlist with the same id", async () => {
    const { socket, e1 } = await subscribed();

    socket().fire("event:access-lost", {
      resource: "playlist",
      id: "e1",
      reason: "no_access",
    });
    socket().fire("playlist:updated", { playlistId: "e1", version: 3, tracks: [] });

    expect(e1.log).toEqual([]);
  });
});

describe("losing and getting back the connection", () => {
  it("subscribes again after a reconnect, since the server forgets subscriptions", async () => {
    const { live, socket, statuses } = setup();
    const screen = recorder();
    live.subscribeToEvent("e1", screen);
    await flush();
    socket().acceptHandshake();
    socket().answerNext({ ok: true, snapshot: queue(1) });

    socket().dropTransport();
    socket().acceptHandshake(); // socket.io reconnected by itself
    socket().answerNext({ ok: true, snapshot: queue(5) });

    expect(socket().subscribes()).toEqual(["e1", "e1"]);
    expect(screen.log).toEqual(["state v1", "state v5"]);
    expect(statuses).toEqual(["connecting", "live", "connecting", "live"]);
  });

  it("an expired token at the handshake: refreshes once, then connects again", async () => {
    const { live, socket, refreshAccessToken } = setup();
    live.subscribeToEvent("e1", recorder());
    await flush();

    socket().refuseHandshake("TOKEN_EXPIRED");
    await vi.waitFor(() => expect(socket().connectCalls).toBe(2));

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("a token refused again right after a refresh: stops (offline) instead of looping", async () => {
    const { live, socket, refreshAccessToken } = setup();
    live.subscribeToEvent("e1", recorder());
    await flush();

    socket().refuseHandshake("TOKEN_EXPIRED");
    await vi.waitFor(() => expect(socket().connectCalls).toBe(2));
    socket().refuseHandshake("TOKEN_EXPIRED");
    await Promise.resolve();

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(socket().connectCalls).toBe(2);
    expect(live.getStatus()).toBe("offline");
  });

  it("refreshes again on a later expiry, once a connection succeeded in between", async () => {
    const { live, socket, refreshAccessToken } = setup();
    live.subscribeToEvent("e1", recorder());
    await flush();
    socket().refuseHandshake("TOKEN_EXPIRED");
    await vi.waitFor(() => expect(socket().connectCalls).toBe(2));
    socket().acceptHandshake();

    socket().dropTransport();
    socket().refuseHandshake("TOKEN_EXPIRED"); // the next morning
    await vi.waitFor(() => expect(refreshAccessToken).toHaveBeenCalledTimes(2));
  });

  it("the session is over (refresh says no): offline, no reconnect", async () => {
    const { live, socket } = setup(async () => false);
    live.subscribeToEvent("e1", recorder());
    await flush();

    socket().refuseHandshake("TOKEN_EXPIRED");
    await vi.waitFor(() => expect(live.getStatus()).toBe("offline"));

    expect(socket().connectCalls).toBe(1);
  });

  it("the refresh fails (offline): offline, the error is logged, no reconnect", async () => {
    const { live, socket } = setup(async () => {
      throw new Error("network down");
    });
    live.subscribeToEvent("e1", recorder());
    await flush();

    socket().refuseHandshake("TOKEN_EXPIRED");
    await vi.waitFor(() => expect(live.getStatus()).toBe("offline"));

    expect(console.warn).toHaveBeenCalled();
    expect(socket().connectCalls).toBe(1);
  });

  it("UNAUTHENTICATED (no or bad token): offline without trying to refresh", async () => {
    const { live, socket, refreshAccessToken } = setup();
    live.subscribeToEvent("e1", recorder());
    await flush();

    socket().refuseHandshake("UNAUTHENTICATED");
    await Promise.resolve();

    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(live.getStatus()).toBe("offline");
  });

  it("a server that cannot be reached: still connecting (socket.io retries by itself)", async () => {
    const { live, socket, refreshAccessToken } = setup();
    live.subscribeToEvent("e1", recorder());
    await flush();

    socket().fire("connect_error", new Error("xhr poll error"));

    expect(live.getStatus()).toBe("connecting");
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("the socket cannot be made (backend address unreadable): offline, logged", async () => {
    const live = createLiveConnection({
      createSocket: async () => {
        throw new Error("storage failed");
      },
      refreshAccessToken: async () => true,
    });

    live.subscribeToEvent("e1", recorder());
    await flush();

    expect(live.getStatus()).toBe("offline");
    expect(console.warn).toHaveBeenCalled();
  });

  it("retry() after offline connects again", async () => {
    const { live, socket } = setup();
    live.subscribeToEvent("e1", recorder());
    await flush();
    socket().refuseHandshake("UNAUTHENTICATED");
    await Promise.resolve();

    live.retry();

    expect(live.getStatus()).toBe("connecting");
    expect(socket().connectCalls).toBe(2);
  });
});

describe("leaving", async () => {
  it("unsubscribes when the last screen of an event leaves, and disconnects when none is left", async () => {
    const { live, socket } = setup();
    const leaveA = live.subscribeToEvent("e1", recorder());
    await flush();
    const leaveB = live.subscribeToEvent("e1", recorder());
    socket().acceptHandshake();

    leaveA();
    expect(socket().emitted.filter((e) => e.event === "unsubscribe")).toHaveLength(0);

    leaveB();
    expect(socket().emitted.at(-1)).toEqual({
      event: "unsubscribe",
      payload: { resource: "event", id: "e1" },
    });
    expect(socket().disconnectCalls).toBe(1);
    expect(live.getStatus()).toBe("idle");
  });

  it("subscribing again after everything was closed makes a fresh socket (the backend address may have changed)", async () => {
    const { live, sockets } = setup();
    live.subscribeToEvent("e1", recorder());
    await flush();
    sockets[0]!.acceptHandshake();
    live.subscribeToEvent("e1", recorder()); // a second screen, then both leave
    live.shutdown();

    live.subscribeToEvent("e1", recorder());
    await flush();

    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.connectCalls).toBe(1);
  });

  it("everyone leaves while the socket is being made: it is never connected", async () => {
    const { live, sockets } = setup();

    live.subscribeToEvent("e1", recorder())();
    await flush();

    expect(sockets[0]!.connectCalls).toBe(0);
    expect(live.getStatus()).toBe("idle");
  });

  it("an old socket's late events are ignored once a new one replaced it", async () => {
    const { live, sockets } = setup();
    live.subscribeToEvent("e1", recorder());
    await flush();
    live.shutdown();
    const screen = recorder();
    live.subscribeToEvent("e1", screen);
    await flush();

    sockets[0]!.fire("event:queue", { eventId: "e1", version: 3, tracks: [] });

    expect(screen.log).toEqual([]);
  });

  it("shutdown (sign-out) drops everything; later updates reach nobody", async () => {
    const { live, socket } = setup();
    const screen = recorder();
    live.subscribeToEvent("e1", screen);
    await flush();
    socket().acceptHandshake();

    live.shutdown();
    socket().fire("event:queue", { eventId: "e1", version: 2, tracks: [] });

    expect(screen.log).toEqual([]);
    expect(socket().disconnectCalls).toBe(1);
    expect(live.getStatus()).toBe("idle");
  });
});
