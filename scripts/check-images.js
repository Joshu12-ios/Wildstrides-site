"use strict";
/** npm run check:images : lists images the page needs that are missing or have the wrong letter case. */
const path = require("node:path");
const { checkImages } = require("./lib/images");

const r = checkImages(path.join(__dirname, ".."));
console.log(`\nChecking ${r.refs.length} image(s) in ${r.dir}\n`);
for (const ref of r.refs) {
  const bad = r.missing.includes(ref) ? "MISSING   " : r.wrongCase.find((w) => w.ref === ref) ? "WRONG CASE" : null;
  const w = r.wrongCase.find((x) => x.ref === ref);
  console.log(bad ? `  ${bad} ${ref}${w ? `   (file on disk is "${w.actual}")` : ""}` : `  ok         ${ref}`);
}
if (r.unused.length) console.log(`\nIn the folder but not used by the page: ${r.unused.join(", ")}`);
if (r.hotlinks.length) console.log(`\n${r.hotlinks.length} photo(s) are loaded from images.unsplash.com (they work, but depend on a third party).`);
const bad = r.missing.length + r.wrongCase.length;
console.log(bad ? `\n${bad} problem(s): these show as broken images online. Linux hosts are case-sensitive.` : "\nAll local images found.");
process.exit(bad ? 1 : 0);
