"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { errorPage } = require("./errorPage");

const ROOT = path.join(__dirname, "..");

// What the page genuinely needs: its own inline script/styles, Google Fonts, Unsplash photos, data: favicon.
function cspDirectives(config) {
  const d = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'"],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com"],
    "img-src": ["'self'", "data:", "https://images.unsplash.com"],
    "connect-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  if (config.isProd && config.cspMode === "enforce") d["upgrade-insecure-requests"] = [];
  return d;
}

/**
 * Builds the Express app. It does NOT start listening, so tests can run it on any port.
 * `hooks.beforeErrorHandlers(app)` lets tests add routes (e.g. one that throws).
 */
function createApp(config, hooks = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.set("view engine", "ejs");
  app.set("views", path.join(ROOT, "views"));

  // Health check first: cheap, never rate limited, never logged.
  app.get("/health", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ status: "ok" });
  });

  app.use(
    helmet({
      contentSecurityPolicy:
        config.cspMode === "off"
          ? false
          : { useDefaults: false, reportOnly: config.cspMode === "report-only", directives: cspDirectives(config) },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      strictTransportSecurity: config.isProd ? { maxAge: 15552000, includeSubDomains: false } : false,
    })
  );
  app.use((_req, res, next) => {
    res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    next();
  });
  app.use(compression());
  if (config.logRequests) app.use(morgan(config.isProd ? "combined" : "dev", { skip: (req) => req.path === "/health" }));

  // Static files BEFORE the rate limiter: a single page view loads ~30 images, and mobile
  // networks share IP addresses, so limiting images would block real visitors.
  app.use(
    express.static(path.join(ROOT, "public"), {
      maxAge: config.isProd ? "1d" : 0,
      dotfiles: "ignore",
      index: false,
      redirect: false,
    })
  );

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: config.rateLimitMax,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (_req, res) => res.status(429).type("text/plain").send("Too many requests. Please try again shortly."),
    })
  );

  app.get("/favicon.ico", (_req, res) => res.status(204).end());

  app.get("/robots.txt", (_req, res) => {
    const lines = ["User-agent: *", "Allow: /"];
    if (config.siteUrl) lines.push(`Sitemap: ${config.siteUrl}/sitemap.xml`);
    res.type("text/plain").send(lines.join("\n") + "\n");
  });

  app.get("/sitemap.xml", (_req, res, next) => {
    if (!config.siteUrl) return next();
    res
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${config.siteUrl}/</loc></url>\n</urlset>\n`
      );
  });

  app.get("/", (_req, res) => {
    res.set("Cache-Control", "no-cache"); // always check for a fresh page; the browser can still reuse it if unchanged
    res.render("index", { whatsappNumber: config.whatsappNumber });
  });

  if (typeof hooks.beforeErrorHandlers === "function") hooks.beforeErrorHandlers(app);

  app.use((req, res) => {
    res.status(404);
    if (req.path.startsWith("/api/")) return res.json({ error: "Not found" });
    res.type("html").send(
      errorPage({
        status: 404,
        title: "Page not found",
        message: "That page doesn't exist, but the mountain is still right where you left it.",
        whatsappNumber: config.whatsappNumber,
      })
    );
  });

  // Never show stack traces or file paths to visitors; log them with a reference instead.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    const reference = crypto.randomBytes(4).toString("hex");
    if (status >= 500) console.error(`[error ${reference}] ${req.method} ${req.originalUrl}`, err);
    res.status(status);
    if (req.path.startsWith("/api/")) return res.json({ error: "Request failed", reference });
    res.type("html").send(
      errorPage({
        status,
        title: status >= 500 ? "Something went wrong" : "We couldn't process that request",
        message:
          status >= 500
            ? "Sorry, something went wrong on our side. Please try again in a moment, or message us directly."
            : "Please check the address and try again.",
        whatsappNumber: config.whatsappNumber,
        reference,
      })
    );
  });

  return app;
}

module.exports = { createApp };
