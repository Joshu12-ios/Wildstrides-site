"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const { createApp } = require("../src/app");
const { load } = require("../src/config");

const ROOT = path.join(__dirname, "..");
const BASE_ENV = {
  NODE_ENV: "production",
  WHATSAPP_NUMBER: "254712345678",
  SITE_URL: "https://example.co.ke",
  LOG_REQUESTS: "false",
  CSP_MODE: "enforce",
};

async function start(overrides = {}, hooks) {
  const config = load({ ...BASE_ENV, ...overrides });
  const server = createApp(config, hooks).listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    config,
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

function rawGet(url, headers) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ res, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

describe("home page", () => {
  let s;
  before(async () => { s = await start(); });
  after(() => s.close());

  it("renders the real page with the configured WhatsApp number", async () => {
    const res = await fetch(s.url + "/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    const html = await res.text();
    assert.match(html, /^<!DOCTYPE html>/i);
    assert.match(html, /<title>WILDSTRIDES/);
    assert.ok(html.includes("254712345678"), "WhatsApp number missing from page");
    for (const bad of ["<%", "read-only source preview", "processPayment", 'id="cardNumber"', "Secure payments powered by Stripe", "Demo mode"]) {
      assert.ok(!html.includes(bad), `page contains "${bad}"`);
    }
  });

  it("shows the current year in the footer", async () => {
    const html = await (await fetch(s.url + "/")).text();
    assert.ok(html.includes(`© ${new Date().getFullYear()} WildStrides`));
  });

  it("answers HEAD requests without a body", async () => {
    const res = await fetch(s.url + "/", { method: "HEAD" });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "");
  });

  it("is compressed for browsers that accept gzip", async () => {
    const { res, body } = await rawGet(s.url + "/", { "accept-encoding": "gzip" });
    assert.equal(res.headers["content-encoding"], "gzip");
    assert.ok(body.length < 40000, `expected a small gzip body, got ${body.length} bytes`);
  });

  it("is never cached blindly", async () => {
    const res = await fetch(s.url + "/");
    assert.match(res.headers.get("cache-control"), /no-cache/);
  });
});

describe("security headers", () => {
  let s;
  before(async () => { s = await start(); });
  after(() => s.close());

  it("sets the protective headers and hides the framework", async () => {
    const res = await fetch(s.url + "/");
    assert.equal(res.headers.get("x-powered-by"), null);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("strict-transport-security"), /max-age=\d+/);
    assert.ok(res.headers.get("permissions-policy"));
    assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  });

  it("enforces a content-security policy that allows what the page needs", async () => {
    const csp = (await fetch(s.url + "/")).headers.get("content-security-policy");
    assert.ok(csp, "enforcing CSP header missing");
    for (const part of ["default-src 'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://images.unsplash.com", "frame-ancestors 'none'", "object-src 'none'", "upgrade-insecure-requests"]) {
      assert.ok(csp.includes(part), `CSP is missing: ${part}`);
    }
  });

  it("report-only mode never blocks anything", async () => {
    const r = await start({ CSP_MODE: "report-only" });
    const res = await fetch(r.url + "/");
    assert.equal(res.headers.get("content-security-policy"), null);
    assert.ok(res.headers.get("content-security-policy-report-only"));
    await r.close();
  });

  it("does not send HSTS outside production (keeps local http working)", async () => {
    const r = await start({ NODE_ENV: "development" });
    assert.equal((await fetch(r.url + "/")).headers.get("strict-transport-security"), null);
    await r.close();
  });
});

describe("health, robots, sitemap, favicon", () => {
  let s;
  before(async () => { s = await start(); });
  after(() => s.close());

  it("/health is ok and never cached", async () => {
    const res = await fetch(s.url + "/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("robots.txt points to the sitemap on the real domain", async () => {
    const txt = await (await fetch(s.url + "/robots.txt")).text();
    assert.match(txt, /User-agent: \*/);
    assert.match(txt, /Sitemap: https:\/\/example\.co\.ke\/sitemap\.xml/);
  });

  it("sitemap.xml lists the home page", async () => {
    const res = await fetch(s.url + "/sitemap.xml");
    assert.match(res.headers.get("content-type"), /xml/);
    assert.match(await res.text(), /<loc>https:\/\/example\.co\.ke\/<\/loc>/);
  });

  it("favicon.ico answers quietly", async () => {
    assert.equal((await fetch(s.url + "/favicon.ico")).status, 204);
  });
});

describe("static files and path safety", () => {
  let s;
  const asset = path.join(ROOT, "public", "__test-asset.txt");
  before(async () => { fs.writeFileSync(asset, "hello-asset"); s = await start(); });
  after(async () => { fs.rmSync(asset, { force: true }); await s.close(); });

  it("serves files from public/", async () => {
    const res = await fetch(s.url + "/__test-asset.txt");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "hello-asset");
    assert.match(res.headers.get("cache-control"), /max-age=86400/);
  });

  it("never exposes source, settings or the page template", async () => {
    for (const p of ["/server.js", "/package.json", "/.env", "/views/index.ejs", "/src/config.js", "/test/app.test.js", "/node_modules/express/package.json"]) {
      const res = await fetch(s.url + p);
      assert.equal(res.status, 404, `${p} should be 404, got ${res.status}`);
    }
  });

  it("blocks path-traversal attempts", async () => {
    for (const p of ["/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/package.json", "/images/..%2f..%2fserver.js", "/....//....//package.json"]) {
      const res = await fetch(s.url + p);
      const body = await res.text();
      assert.notEqual(res.status, 200, `${p} returned 200`);
      assert.ok(!body.includes("wildstrides-site") && !body.includes("require("), `${p} leaked file content`);
    }
  });

  it("answers a malformed address with a client error, never a crash", async () => {
    for (const p of ["/%", "/%E0%A4%A", "/%zz"]) {
      const { res } = await rawGet(s.url + p, {});
      assert.ok(res.statusCode === 400 || res.statusCode === 404, `${p} returned ${res.statusCode}`);
    }
    assert.equal((await fetch(s.url + "/health")).status, 200, "server must still be alive");
  });
});

describe("errors", () => {
  let s;
  before(async () => {
    s = await start({}, {
      beforeErrorHandlers: (app) => app.get("/__boom", () => { throw new Error("secret detail at /srv/app/db.js:42"); }),
    });
  });
  after(() => s.close());

  it("shows a friendly 404 page, with a WhatsApp link", async () => {
    const res = await fetch(s.url + "/nope");
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.match(html, /Page not found/);
    assert.ok(html.includes("wa.me/254712345678"));
  });

  it("answers unknown /api/ paths with JSON", async () => {
    const res = await fetch(s.url + "/api/anything");
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Not found" });
  });

  it("treats POST to the home page as not found, not an error", async () => {
    assert.equal((await fetch(s.url + "/", { method: "POST" })).status, 404);
  });

  it("never leaks internals on a 500, and keeps running", async () => {
    const orig = console.error;
    console.error = () => {}; // the server logs the real error; keep test output clean
    try {
      const res = await fetch(s.url + "/__boom");
      const html = await res.text();
      assert.equal(res.status, 500);
      assert.match(html, /Something went wrong/);
      assert.match(html, /Reference: [0-9a-f]{8}/);
      for (const leak of ["secret detail", "db.js", "/srv/app", "at Object", "node_modules"]) assert.ok(!html.includes(leak), `leaked: ${leak}`);
    } finally { console.error = orig; }
    assert.equal((await fetch(s.url + "/health")).status, 200, "server must still be alive");
  });
});

describe("rate limiting", () => {
  let s;
  const asset = path.join(ROOT, "public", "__rate-asset.txt");
  before(async () => { fs.writeFileSync(asset, "x"); s = await start({ RATE_LIMIT_MAX: "3" }); });
  after(async () => { fs.rmSync(asset, { force: true }); await s.close(); });

  it("limits page requests but never images, files or the health check", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await fetch(s.url + "/__rate-asset.txt")).status, 200);
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(s.url + "/")).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    assert.equal((await fetch(s.url + "/health")).status, 200);
    assert.equal((await fetch(s.url + "/__rate-asset.txt")).status, 200);
    const limited = await fetch(s.url + "/");
    assert.match(await limited.text(), /Too many requests/);
  });
});

describe("configuration", () => {
  const prod = { NODE_ENV: "production", WHATSAPP_NUMBER: "254712345678", SITE_URL: "https://x.co.ke" };

  it("accepts a complete production setup", () => {
    const c = load(prod);
    assert.equal(c.isProd, true);
    assert.equal(c.port, 4000);
    assert.equal(c.trustProxy, 1);
    assert.equal(c.cspMode, "enforce");
  });
  it("cleans up a number typed with spaces, dashes and +", () => {
    assert.equal(load({ ...prod, WHATSAPP_NUMBER: "+254 712-345-678" }).whatsappNumber, "254712345678");
  });
  it("refuses production without the WhatsApp number", () => {
    assert.throws(() => load({ ...prod, WHATSAPP_NUMBER: "" }), /WHATSAPP_NUMBER is not set/);
  });
  it("refuses a number that is too short", () => {
    assert.throws(() => load({ ...prod, WHATSAPP_NUMBER: "0712345" }), /10-15 digits/);
  });
  it("refuses production without an https SITE_URL", () => {
    assert.throws(() => load({ ...prod, SITE_URL: "" }), /SITE_URL/);
    assert.throws(() => load({ ...prod, SITE_URL: "http://x.co.ke" }), /https/);
    assert.throws(() => load({ ...prod, SITE_URL: "https://x.co.ke/path" }), /SITE_URL/);
  });
  it("strips a trailing slash from SITE_URL", () => {
    assert.equal(load({ ...prod, SITE_URL: "https://x.co.ke/" }).siteUrl, "https://x.co.ke");
  });
  it("rejects bad numbers for PORT, TRUST_PROXY, CSP_MODE and RATE_LIMIT_MAX", () => {
    assert.throws(() => load({ ...prod, PORT: "abc" }), /PORT/);
    assert.throws(() => load({ ...prod, PORT: "70000" }), /PORT/);
    assert.throws(() => load({ ...prod, TRUST_PROXY: "true" }), /TRUST_PROXY/);
    assert.throws(() => load({ ...prod, CSP_MODE: "loud" }), /CSP_MODE/);
    assert.throws(() => load({ ...prod, RATE_LIMIT_MAX: "0" }), /RATE_LIMIT_MAX/);
  });
  it("reports every problem at once", () => {
    assert.throws(() => load({ NODE_ENV: "production", PORT: "x" }), (e) => /WHATSAPP_NUMBER/.test(e.message) && /SITE_URL/.test(e.message) && /PORT/.test(e.message));
  });
  it("runs in development with no settings at all", () => {
    const c = load({});
    assert.equal(c.isProd, false);
    assert.equal(c.whatsappNumber, "");
  });
  it("TRUST_PROXY=0 means no proxy", () => {
    assert.equal(load({ ...prod, TRUST_PROXY: "0" }).trustProxy, false);
  });
});

describe("running as a real process", () => {
  // Start from the real environment (Windows needs SystemRoot etc.) but remove anything that could change the result.
  const run = (env) => {
    const clean = { ...process.env };
    for (const k of ["NODE_ENV", "PORT", "WHATSAPP_NUMBER", "SITE_URL", "CSP_MODE", "TRUST_PROXY", "RATE_LIMIT_MAX", "LOG_REQUESTS"]) delete clean[k];
    return spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: { ...clean, ENV_FILE: path.join(ROOT, ".no-such-env-file"), ...env },
    });
  };

  it("refuses to start with bad production settings and says why", async () => {
    const child = run({ NODE_ENV: "production" });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    const [code] = await once(child, "exit");
    assert.equal(code, 1);
    assert.match(err, /WHATSAPP_NUMBER is not set/);
  });

  it("explains a port that is already in use", async () => {
    const taken = http.createServer().listen(0, "0.0.0.0");
    await once(taken, "listening");
    const port = taken.address().port;
    const child = run({ PORT: String(port) });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    const [code] = await once(child, "exit");
    taken.close();
    assert.equal(code, 1);
    assert.match(err, /already in use/);
  });

  it("shuts down cleanly on SIGTERM (what a host sends on every deploy)", { skip: process.platform === "win32" }, async () => {
    const port = 4300 + Math.floor(Math.random() * 500);
    const child = run({ PORT: String(port), WHATSAPP_NUMBER: "254712345678" });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("server did not start")), 8000);
      child.stdout.on("data", (d) => { if (String(d).includes("running on port")) { clearTimeout(t); resolve(); } });
      child.on("exit", () => reject(new Error("server exited early")));
    });
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    child.removeAllListeners("exit");
    child.kill("SIGTERM");
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
  });
});
