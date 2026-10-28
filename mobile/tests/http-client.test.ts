import { describe, expect, it } from "vitest";
import { isRequestError, RequestError } from "@/api/api-error";
import { createHttpClient } from "@/api/http-client";
import {
  CLIENT_HEADERS,
  createFakeBackend,
  fail,
  networkDown,
  ok,
} from "./helpers/fakes";

function client(
  backend = createFakeBackend(),
  extra: { timeoutMs?: number; baseUrl?: () => Promise<string> } = {},
) {
  return {
    backend,
    http: createHttpClient({
      fetch: backend.fetch,
      getBaseUrl: extra.baseUrl ?? (async () => "http://backend.test"),
      getClientHeaders: () => CLIENT_HEADERS,
      timeoutMs: extra.timeoutMs ?? 1000,
    }),
  };
}

async function caught(promise: Promise<unknown>): Promise<RequestError> {
  try {
    await promise;
  } catch (error) {
    expect(isRequestError(error)).toBe(true);
    return error as RequestError;
  }
  throw new Error("expected the call to fail");
}

describe("http client", () => {
  it("sends the client headers on every call, the bearer token only when given", async () => {
    const { http, backend } = client();
    backend.on("GET /a", ok({}));

    await http.send("GET", "/a");
    await http.send("GET", "/a", { accessToken: "tok" });

    expect(backend.requests[0]!.headers).toMatchObject({
      "x-platform": "ios",
      "x-device": "test-phone",
      "x-app-version": "1.2.3",
    });
    expect(backend.requests[0]!.headers["authorization"]).toBeUndefined();
    expect(backend.requests[1]!.headers["authorization"]).toBe("Bearer tok");
  });

  it("sends JSON with a content type only when there is a body", async () => {
    const { http, backend } = client();
    backend.on("POST /b", ok());
    backend.on("GET /b", ok({}));

    await http.send("POST", "/b", { body: { a: 1 } });
    await http.send("GET", "/b");

    expect(backend.requests[0]!.headers["content-type"]).toBe("application/json");
    expect(backend.requests[0]!.body).toEqual({ a: 1 });
    expect(backend.requests[1]!.headers["content-type"]).toBeUndefined();
  });

  it("puts the query in the URL, encoded, and leaves out undefined values", async () => {
    const { http, backend } = client();
    backend.on("GET /events", ok({ items: [] }));
    const seen: string[] = [];
    const spy = createHttpClient({
      fetch: (async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return backend.fetch(input);
      }) as typeof fetch,
      getBaseUrl: async () => "http://backend.test",
      getClientHeaders: () => ({}),
    });

    await spy.send("GET", "/events", {
      query: { limit: 20, cursor: "a b&c", skip: undefined },
    });
    void http;

    expect(seen[0]).toBe("http://backend.test/api/v1/events?limit=20&cursor=a%20b%26c");
  });

  it("returns the JSON body, and undefined for an empty answer (204)", async () => {
    const { http, backend } = client();
    backend.on("GET /json", ok({ hello: "world" }));
    backend.on("POST /empty", ok());

    expect(await http.send("GET", "/json")).toEqual({ hello: "world" });
    expect(await http.send("POST", "/empty")).toBeUndefined();
  });

  it("turns the backend's error body into a RequestError with its code, message and details", async () => {
    const { http, backend } = client();
    backend.on(
      "POST /x",
      fail(400, "VALIDATION_ERROR", "Invalid request.", [
        { path: "email", message: "bad" },
      ]),
    );

    const error = await caught(http.send("POST", "/x"));

    expect(error).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
    expect(error.details).toEqual([{ path: "email", message: "bad" }]);
  });

  it("keeps the status when the error is not in the contract's shape (a gateway page, say)", async () => {
    const { http, backend } = client();
    backend.on("GET /x", { status: 502, body: { oops: true } });

    const error = await caught(http.send("GET", "/x"));

    expect(error).toMatchObject({ status: 502, code: "INVALID_RESPONSE" });
  });

  it("refuses a successful answer that is not JSON", async () => {
    const backend = createFakeBackend();
    const http = createHttpClient({
      fetch: (async () =>
        new Response("<html>hi</html>", { status: 200 })) as typeof fetch,
      getBaseUrl: async () => "http://backend.test",
      getClientHeaders: () => ({}),
    });
    void backend;

    expect(await caught(http.send("GET", "/x"))).toMatchObject({
      status: 200,
      code: "INVALID_RESPONSE",
    });
  });

  it("reports an unreachable server as NETWORK_ERROR with status 0", async () => {
    const { http, backend } = client();
    backend.on("GET /x", networkDown());

    expect(await caught(http.send("GET", "/x"))).toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });
  });

  it("gives up after the timeout, as NETWORK_ERROR", async () => {
    const http = createHttpClient({
      fetch: ((_: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as typeof fetch,
      getBaseUrl: async () => "http://backend.test",
      getClientHeaders: () => ({}),
      timeoutMs: 20,
    });

    expect(await caught(http.send("GET", "/slow"))).toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });
  });

  it("reads the backend address on every call, so a change in settings applies at once", async () => {
    let base = "http://one.test";
    const seen: string[] = [];
    const http = createHttpClient({
      fetch: (async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
      getBaseUrl: async () => base,
      getClientHeaders: () => ({}),
    });

    await http.send("GET", "/a");
    base = "http://two.test";
    await http.send("GET", "/a");

    expect(seen).toEqual(["http://one.test/api/v1/a", "http://two.test/api/v1/a"]);
  });

  it("a failing base-URL lookup is a NETWORK_ERROR too, not an unhandled crash", async () => {
    const { http } = client(createFakeBackend(), {
      baseUrl: async () => {
        throw new Error("storage broke");
      },
    });

    expect(await caught(http.send("GET", "/a"))).toMatchObject({ code: "NETWORK_ERROR" });
  });
});
