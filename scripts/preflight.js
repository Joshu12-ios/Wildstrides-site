"use strict";
/**
 * npm run preflight : run before EVERY deploy. Answers: "if I deploy this now, will it work?"
 * It checks your settings as production, renders the page, boots the server and hits it.
 */
require("dotenv").config({ quiet: true, path: process.env.ENV_FILE || undefined });
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { load } = require("../src/config");
const { createApp } = require("../src/app");
const { checkImages } = require("./lib/images");

const ROOT = path.join(__dirname, "..");
const fails = [];
const warns = [];
const ok = (m) => console.log("  ok     " + m);
const fail = (m) => { fails.push(m); console.log("  FAIL   " + m); };
const warn = (m) => { warns.push(m); console.log("  warn   " + m); };

(async () => {
  console.log("\nWildStrides preflight (settings are checked as NODE_ENV=production)\n");

  const major = parseInt(process.versions.node.split(".")[0], 10);
  major >= 20 ? ok(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} is too old (need 20 or newer)`);

  // 1. Settings
  let config = null;
  try {
    config = load({ ...process.env, NODE_ENV: "production" });
    ok("settings are valid for production");
    if (config.cspMode !== "enforce") warn(`CSP_MODE is "${config.cspMode}" (the protective setting is "enforce")`);
  } catch (e) {
    e.message.split("\n").slice(1).forEach((l) => fail(l.replace(/^\s*-\s*/, "")));
  }

  // 2. The page file itself
  const pagePath = path.join(ROOT, "views", "index.ejs");
  const page = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, "utf8") : "";
  if (!page) fail("views/index.ejs is missing or empty");
  const wrongMarkers = [
    ["read-only source preview", "views/index.ejs is a code-viewer page, not the website"],
    ["processPayment", "old demo payment code is still in the page"],
    ['id="cardNumber"', "a card-number field is still in the page"],
    ["Secure payments powered by Stripe", "the page still claims Stripe payments"],
    ["Demo mode", "demo-mode text is still in the page"],
  ];
  for (const [needle, why] of wrongMarkers) if (page.includes(needle)) fail(why);
  if (page && !page.trimStart().toLowerCase().startsWith("<!doctype html>")) fail("views/index.ejs does not start with <!DOCTYPE html>");

  // 3. Boot the real app and hit it
  try {
    const cfg = config ? { ...config, logRequests: false } : load({ NODE_ENV: "test", WHATSAPP_NUMBER: "254700000000" });
    const server = createApp(cfg).listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(base + "/");
    const html = await home.text();
    home.status === 200 ? ok("home page renders (HTTP 200)") : fail(`home page returned HTTP ${home.status}`);
    if (html.includes("<%")) fail("the page still contains raw template tags (<% ... %>)");
    if (cfg.whatsappNumber && !html.includes(cfg.whatsappNumber)) fail("WHATSAPP_NUMBER does not appear in the rendered page");
    else ok("WhatsApp number is in the page");
    const health = await fetch(base + "/health");
    health.status === 200 ? ok("/health answers") : fail("/health did not answer");
    const nf = await fetch(base + "/no-such-page");
    nf.status === 404 ? ok("unknown pages return a proper 404") : fail(`unknown page returned HTTP ${nf.status}`);
    server.closeAllConnections();
    server.close();
  } catch (e) {
    fail("could not start the app: " + e.message.split("\n")[0]);
  }

  // 4. Images
  if (page) {
    const img = checkImages(ROOT);
    img.missing.forEach((m) => fail(`image missing: ${m}`));
    img.wrongCase.forEach((w) => fail(`image has the wrong letter case: ${w.ref} (file is "${w.actual}")`));
    if (!img.missing.length && !img.wrongCase.length) ok(`all ${img.refs.length} local images are present`);
    if (img.hotlinks.length) warn(`${img.hotlinks.length} photo(s) load from images.unsplash.com (works, but self-hosting is more reliable)`);

    // 5. Content that needs a human decision
    const deadText = [...page.matchAll(/<a>([^<]+)<\/a>/g)].map((m) => m[1].trim()).filter((t) => !/^[📞✉]/u.test(t));
    const deadHash = (page.match(/href="#"/g) || []).length;
    if (deadText.length || deadHash) warn(`links that go nowhere: ${[...new Set(deadText)].join(", ")}${deadHash ? ` + ${deadHash} link(s) pointing to "#" (social icons and logos)` : ""}`);
    if (config) {
      const shown = [...page.matchAll(/\+254[\d ]{9,13}/g)].map((m) => m[0].replace(/\D/g, ""));
      const other = [...new Set(shown)].filter((n) => n !== config.whatsappNumber);
      if (other.length) warn(`the page shows phone number(s) ${other.join(", ")} that differ from WHATSAPP_NUMBER (${config.whatsappNumber})`);
    }
  }

  console.log("\nConfirm these are TRUE before launch (the page states them as fact):");
  for (const [re, label] of [
    [/Licensed by/i, '"Licensed by Kenya Tourism Board & Kenya Wildlife Service"'],
    [/KWS-certified/i, '"KWS-certified guides"'],
    [/Mt\. Kenya Trust/i, 'the donation to the "Mt. Kenya Trust"'],
    [/#1/, '"#1 Mt. Kenya Adventure Co."'],
    [/class="testimonial-card"/, "the testimonials are from real customers"],
    [/class="partner-card"/, "the featured partners are real and agreed to be listed"],
    [/30\+ days/i, "the 30-day full-refund policy (put it in your Terms)"],
  ]) if (page && re.test(page)) console.log("   -  " + label);

  console.log(fails.length ? `\n${fails.length} problem(s). DO NOT DEPLOY until these are fixed.\n` : `\nPreflight passed${warns.length ? ` with ${warns.length} warning(s)` : ""}.\n`);
  process.exit(fails.length ? 1 : 0);
})();
