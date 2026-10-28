import type { RequestHandler } from "express";

// SECURITY (ADR-027): response headers that tell a browser not to guess or embed what we send.
// The API only returns JSON, so a few headers are enough; they are set by hand (no extra
// dependency) so each one can be explained.
//
//  - X-Content-Type-Options: nosniff        the browser must not treat a JSON answer as a script
//  - Referrer-Policy: no-referrer           links followed from a response leak no address
//  - Content-Security-Policy                nothing in an API answer may load or run anything or be framed
//  - Strict-Transport-Security              only over https (see below)
//
// The Swagger UI at /docs needs scripts and styles, so it gets the first two headers only.
const DOCS_PATH = /^\/docs(\/|$)/;

export const securityHeaders: RequestHandler = (req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  if (!DOCS_PATH.test(req.path)) {
    res.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  }
  // HSTS makes a browser refuse plain http for this host from then on. It is only meaningful
  // (and only honoured) over https, so it is sent only when the request arrived over https:
  // behind a TLS proxy that means TRUST_PROXY is set and the proxy sends X-Forwarded-Proto.
  if (req.secure) {
    res.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
};
