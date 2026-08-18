#!/usr/bin/env node
/* Re-injects the EN9 enhancement layer (layer-src/) into dist/index.html.
   Run this AFTER every `npm run build:app`, because the build regenerates
   dist/index.html from src/ and removes the injected layer. */
import { readFileSync, writeFileSync } from "node:fs";

const dist = "dist/index.html";
let s = readFileSync(dist, "utf8");
const theme = readFileSync("layer-src/theme.css", "utf8");
const css = readFileSync("layer-src/enhance.css", "utf8");
const js = readFileSync("layer-src/enhance.js", "utf8");
if (js.includes("</script>") || (theme + css).includes("</style>"))
  throw new Error("layer sources must not contain closing tags");

const put = (id, tag, body) => {
  const re = new RegExp(`<${tag} id="${id}">[\\s\\S]*?</${tag}>`);
  const block = `<${tag} id="${id}">${body}</${tag}>`;
  if (re.test(s)) s = s.replace(re, block);
  else if (tag === "style") s = s.replace("</style>", `</style>\n${block}`); // after app css
  else s = s.replace("</body>", `${block}\n</body>`);
};
put("en9-theme", "style", theme);
put("en9-css", "style", css);
put("en9-js", "script", js);
writeFileSync(dist, s);
console.log("EN9 layer injected into", dist);
