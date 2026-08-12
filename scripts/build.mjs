/* Bundles the app and inlines every asset into one self-contained HTML file.
   No CDN, no runtime network access, no build server. */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist");
fs.mkdirSync(out, { recursive: true });

/* 1. Bundle the React application. */
await build({
  entryPoints: [path.join(root, "src/entry.tsx")],
  bundle: true,
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  define: {
    "process.env.NODE_ENV": '"production"',
    __API_BASE__: JSON.stringify(process.env.API_BASE || ""),
  },
  outfile: path.join(out, "bundle.js"),
  logLevel: "warning",
});

/* 2. Collect the inline assets. */
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const baseCss = read("src/styles/base.css");
const appCss = read("src/styles/workpaper.css");
const bundle = fs.readFileSync(path.join(out, "bundle.js"), "utf8");
const template = fs.readFileSync(path.join(root, "assets/master-template.xlsx")).toString("base64");

const jszipPath = path.join(root, "node_modules/jszip/dist/jszip.min.js");
if (!fs.existsSync(jszipPath)) {
  throw new Error("jszip not found — run: npm install");
}
// Strip the sourcemap comment; it is not needed inline.
const jszip = fs.readFileSync(jszipPath, "utf8").replace(/\/\/# sourceMappingURL=.*$/m, "");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>5471 Work Paper</title>
<!--
  Self-contained build. Loads with zero network requests.
  Optional outbound calls, only when the user clicks:
    Translation  api.mymemory.translated.net, lingva.ml, api.groq.com (key)
    Live FX      api.ofx.com, api.frankfurter.dev, open.er-api.com
  The work paper itself uses the bundled offline IRS/Treasury rate tables.
-->
<style>
/* System font stack keeps the page free of any font request. */
:root{
  --font-geist-sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --font-geist-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
${baseCss}
${appCss}
</style>
</head>
<body>
<div id="root"></div>
<script id="wp-template" type="application/octet-stream">${template}</script>
<script>${bundle}</script>
<!-- JSZip loads after the app: its setImmediate polyfill hooks MessageChannel,
     which the React scheduler also uses, so it must not run first. -->
<script>${jszip}</script>
</body>
</html>`;

const target = path.join(out, "index.html");
fs.writeFileSync(target, html);
fs.rmSync(path.join(out, "bundle.js"));
console.log(`built dist/index.html — ${(html.length / 1048576).toFixed(2)} MB`);
