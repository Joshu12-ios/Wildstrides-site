"use strict";

const NUMBER_RE = /^\d{10,15}$/;
const CSP_MODES = ["off", "report-only", "enforce"];

// Returns a whole number, the fallback if unset, or NaN if the value is not a whole number.
function whole(value, fallback) {
  if (value === undefined || String(value).trim() === "") return fallback;
  return /^\d+$/.test(String(value).trim()) ? parseInt(value, 10) : NaN;
}

/**
 * Reads and validates settings. Throws ONE error listing everything that is wrong,
 * so a bad deploy fails immediately and visibly instead of breaking for a customer later.
 */
function load(env = process.env) {
  const errors = [];
  const nodeEnv = env.NODE_ENV || "development";
  const isProd = nodeEnv === "production";

  const whatsappNumber = String(env.WHATSAPP_NUMBER || "").replace(/\D/g, "");
  if (whatsappNumber && !NUMBER_RE.test(whatsappNumber)) {
    errors.push("WHATSAPP_NUMBER must be 10-15 digits in international format, e.g. 254712345678");
  }
  if (isProd && !whatsappNumber) errors.push("WHATSAPP_NUMBER is not set");

  const siteUrl = String(env.SITE_URL || "").trim().replace(/\/+$/, "");
  if (siteUrl && !/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(siteUrl)) {
    errors.push("SITE_URL must be just the address, e.g. https://wildstrides.co.ke (no path, no spaces)");
  }
  if (isProd && !/^https:\/\//.test(siteUrl)) {
    errors.push("SITE_URL must be your public https:// address in production");
  }

  const port = whole(env.PORT, 4000);
  if (!(port >= 1 && port <= 65535)) errors.push("PORT must be a number between 1 and 65535");

  const trust = whole(env.TRUST_PROXY, 1);
  if (Number.isNaN(trust)) errors.push("TRUST_PROXY must be a whole number (1 = one proxy in front, e.g. Render; 0 = none)");

  const cspMode = String(env.CSP_MODE || "enforce").toLowerCase();
  if (!CSP_MODES.includes(cspMode)) errors.push(`CSP_MODE must be one of: ${CSP_MODES.join(", ")}`);

  const rateLimitMax = whole(env.RATE_LIMIT_MAX, 1000);
  if (!(rateLimitMax >= 1)) errors.push("RATE_LIMIT_MAX must be a whole number of 1 or more");

  if (errors.length) throw new Error("Invalid configuration:\n  - " + errors.join("\n  - "));

  return Object.freeze({
    nodeEnv,
    isProd,
    port,
    whatsappNumber,
    siteUrl,
    trustProxy: trust === 0 ? false : trust,
    cspMode,
    rateLimitMax,
    logRequests: env.LOG_REQUESTS ? env.LOG_REQUESTS !== "false" : nodeEnv !== "test",
  });
}

module.exports = { load };
