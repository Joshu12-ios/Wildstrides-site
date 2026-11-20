"use strict";
/**
 * npm run smoke -- https://yourdomain.co.ke [254712345678]
 * Run right AFTER every deploy. Checks the LIVE site from the outside.
 */
const target = (process.argv[2] || "").replace(/\/+$/, "");
const number = (process.argv[3] || "").replace(/\D/g, "");
if (!/^https?:\/\/[^\s/]+$/.test(target)) {
  console.error("Usage: npm run smoke -- https://yourdomain.co.ke [whatsapp-number]");
  process.exit(2);
}
const fails = [];
const warns = [];
const ok = (m) => console.log("  ok     " + m);
const bad = (m) => { fails.push(m); console.log("  FAIL   " + m); };
const warn = (m) => { warns.push(m); console.log("  warn   " + m); };

async function get(url, opts) {
  const t = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), ...opts });
  return { res, ms: Date.now() - t };
}

(async () => {
  console.log(`\nSmoke test: ${target}\n`);
  try {
    const { res, ms } = await get(target + "/");
    const html = await res.text();
    res.status === 200 ? ok("home page loads (HTTP 200)") : bad(`home page returned HTTP ${res.status}`);
    /text\/html/.test(res.headers.get("content-type") || "") ? ok("served as HTML") : bad("home page is not served as HTML");
    html.includes("WILDSTRIDES") ? ok("it is the WildStrides page") : bad("page does not look like the WildStrides site");
    if (/read-only source preview|<%/.test(html)) bad("the page shows source code or raw template tags");
    if (number) html.includes(number) ? ok("WhatsApp number is correct in the page") : bad(`WhatsApp number ${number} not found in the page`);
    ms < 3000 ? ok(`responded in ${ms} ms`) : warn(`slow response (${ms} ms); a sleeping free-tier server can do this`);
    res.headers.get("x-powered-by") ? warn("X-Powered-By header is exposed") : ok("no X-Powered-By header");
    res.headers.get("x-content-type-options") === "nosniff" ? ok("security headers present") : bad("security headers missing");
    if (target.startsWith("https://")) {
      res.headers.get("strict-transport-security") ? ok("HSTS enabled") : bad("HSTS header missing (is NODE_ENV=production set?)");
    } else warn("site is not on https");
  } catch (e) { bad("home page unreachable: " + e.message); }

  try { const { res } = await get(target + "/health"); res.status === 200 ? ok("/health answers") : bad(`/health returned ${res.status}`); }
  catch (e) { bad("/health unreachable: " + e.message); }

  try { const { res } = await get(target + "/robots.txt"); res.status === 200 ? ok("robots.txt present") : warn(`robots.txt returned ${res.status}`); }
  catch { warn("robots.txt unreachable"); }

  try { const { res } = await get(target + "/definitely-not-a-page-" + Date.now()); res.status === 404 ? ok("unknown pages give a proper 404") : bad(`unknown page returned ${res.status}`); }
  catch (e) { bad("404 check failed: " + e.message); }

  if (target.startsWith("https://")) {
    try {
      const { res } = await get(target.replace("https://", "http://") + "/", { redirect: "manual" });
      const loc = res.headers.get("location") || "";
      [301, 302, 307, 308].includes(res.status) && loc.startsWith("https://") ? ok("http:// redirects to https://") : warn(`http:// did not redirect to https (status ${res.status})`);
    } catch { warn("could not test the http -> https redirect"); }
  }

  console.log(fails.length ? `\n${fails.length} problem(s). Roll back the deploy if the site is broken.\n` : `\nSmoke test passed${warns.length ? ` with ${warns.length} warning(s)` : ""}.\n`);
  process.exit(fails.length ? 1 : 0);
})();
