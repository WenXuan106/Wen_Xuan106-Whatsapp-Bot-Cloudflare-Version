// Worker entry point. Replaces index.js's Express app + app.listen().
// Every request either serves a static file from public/ (via the
// [assets] binding in wrangler.toml) or is routed to the single
// WhatsAppSession Durable Object instance that holds the live connection.

export { WhatsAppSession } from "./session.js";

// One fixed DO id = one WhatsApp session for this whole deployment. If you
// ever want multiple independent bot accounts under one Worker, derive the
// id from something in the request instead (e.g. a path segment or auth
// token) — idFromName() below always resolves to the same instance.
const SESSION_NAME = "primary";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const id = env.WA_SESSION.idFromName(SESSION_NAME);
      const stub = env.WA_SESSION.get(id);
      return stub.fetch(request);
    }

    // Static pairing site (public/index.html, app.js, style.css).
    return env.ASSETS.fetch(request);
  },
};
