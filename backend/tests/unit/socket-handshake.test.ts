import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";
import request from "supertest";
import type { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "../../src/modules/auth/access-token.js";
import { attachSockets } from "../../src/sockets/index.js";

const SECRET = "s".repeat(32);
const USER_ID = "3f2b8c1e-5d7a-4c1b-9a3e-2b1f6d8e7c90";

let httpServer: HttpServer;
let io: Server;
let url: string;
let logLines: Record<string, unknown>[];
const opened: Socket[] = [];

beforeEach(async () => {
  logLines = [];
  const logger = pino(
    { level: "debug" },
    { write: (c: string) => logLines.push(JSON.parse(c)) },
  );
  httpServer = createServer();
  io = attachSockets(httpServer, {
    jwtSecret: SECRET,
    logger,
    allowedOrigins: ["http://localhost:8081"],
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}/live`;
});

afterEach(async () => {
  opened.splice(0).forEach((socket) => socket.close());
  await io.close(); // also closes the HTTP server
});

function open(
  auth: Record<string, unknown>,
  headers: Record<string, string> = {},
): Socket {
  const socket = connect(url, {
    auth,
    extraHeaders: headers,
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  opened.push(socket);
  return socket;
}

function outcome(socket: Socket): Promise<{ connected: true } | { code: unknown }> {
  return new Promise((resolve) => {
    socket.on("connect", () => resolve({ connected: true }));
    socket.on("connect_error", (error) =>
      resolve({ code: (error as Error & { data?: { code?: unknown } }).data?.code }),
    );
  });
}

describe("/live handshake", () => {
  it("accepts a valid access token", async () => {
    const token = await signAccessToken(USER_ID, SECRET);
    expect(await outcome(open({ token }))).toEqual({ connected: true });
  });

  it("refuses a connection with no token", async () => {
    expect(await outcome(open({}))).toEqual({ code: "UNAUTHENTICATED" });
  });

  it.each([123, "", "not.a.jwt", null])("refuses the token %j", async (token) => {
    expect(await outcome(open({ token }))).toEqual({ code: "UNAUTHENTICATED" });
  });

  it("refuses a token signed with another secret", async () => {
    const token = await signAccessToken(USER_ID, "x".repeat(32));
    expect(await outcome(open({ token }))).toEqual({ code: "UNAUTHENTICATED" });
  });

  it("tells the app to refresh when the token is expired", async () => {
    const token = await signAccessToken(USER_ID, SECRET, new Date(Date.now() - 3600_000));
    expect(await outcome(open({ token }))).toEqual({ code: "TOKEN_EXPIRED" });
  });

  it("logs platform, device and app version of the connection", async () => {
    const token = await signAccessToken(USER_ID, SECRET);
    await outcome(
      open(
        { token },
        { "X-Platform": "android", "X-Device": "Pixel 8", "X-App-Version": "2.0.1" },
      ),
    );

    expect(logLines.find((line) => line.msg === "socket connected")).toMatchObject({
      userId: USER_ID,
      client: { platform: "android", device: "Pixel 8", appVersion: "2.0.1" },
    });
  });

  it("logs refused handshakes without logging the token", async () => {
    const token = "secret.token.value";
    await outcome(open({ token }));

    expect(
      logLines.find((line) => line.msg === "socket handshake refused"),
    ).toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(JSON.stringify(logLines)).not.toContain(token);
  });
});

describe("/live browser origins (long-polling requests)", () => {
  const poll = (origin: string) =>
    request(httpServer).get("/socket.io/?EIO=4&transport=polling").set("Origin", origin);

  it("lets a listed web origin read the handshake response", async () => {
    const response = await poll("http://localhost:8081");

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:8081");
  });

  it("gives an unlisted origin no permission", async () => {
    const response = await poll("https://evil.example");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
