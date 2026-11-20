"use strict";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Small self-contained error page (no external files, so it works even when everything else is broken). */
function errorPage({ status, title, message, whatsappNumber, reference }) {
  const wa = whatsappNumber
    ? `<a class="b" href="https://wa.me/${esc(whatsappNumber)}">Message us on WhatsApp</a>`
    : "";
  const ref = reference ? `<p class="r">Reference: ${esc(reference)}</p>` : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex"><title>${esc(status)} | WildStrides Kenya</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1A0F08;color:#F5EDD8;font-family:Georgia,serif;text-align:center;padding:24px}
h1{font-size:64px;margin:0;color:#D4A853}h2{font-weight:400;margin:8px 0 16px}p{max-width:460px;margin:0 auto 24px;line-height:1.6;color:#E8D5A3}
.b{display:inline-block;margin:6px;padding:14px 28px;background:#C4612B;color:#FDFAF4;text-decoration:none;font:700 12px sans-serif;letter-spacing:2px;text-transform:uppercase}
.r{font-size:12px;opacity:.6}
</style></head><body><main>
<h1>${esc(status)}</h1><h2>${esc(title)}</h2><p>${esc(message)}</p>
<a class="b" href="/">Back to WildStrides</a>${wa}${ref}
</main></body></html>`;
}

module.exports = { errorPage };
