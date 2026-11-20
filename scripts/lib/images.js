"use strict";
const fs = require("node:fs");
const path = require("node:path");

/** Compares the images the page asks for with the files actually in public/images (exact names, case-sensitive). */
function checkImages(root) {
  const page = fs.readFileSync(path.join(root, "views", "index.ejs"), "utf8");
  const dir = path.join(root, "public", "images");
  const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith(".")) : [];

  const refs = [...new Set([...page.matchAll(/(?:url\(\s*['"]?|src=["'])(images\/[^'")\s]+)/g)].map((m) => m[1]))];
  const missing = [];
  const wrongCase = [];
  for (const ref of refs) {
    const name = path.basename(ref);
    if (onDisk.includes(name)) continue;
    const near = onDisk.find((f) => f.toLowerCase() === name.toLowerCase());
    if (near) wrongCase.push({ ref, actual: near });
    else missing.push(ref);
  }
  const unused = onDisk.filter((f) => !refs.some((r) => path.basename(r) === f));
  const hotlinks = [...new Set([...page.matchAll(/https:\/\/images\.unsplash\.com\/[^'")\s]+/g)].map((m) => m[0]))];
  return { dir, refs, missing, wrongCase, unused, hotlinks };
}

module.exports = { checkImages };
