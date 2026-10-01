#!/usr/bin/env node
/* Scorecard: compare a work paper the tool generated with the reviewer's
 * corrected work paper, line by line, and print an accuracy percentage.
 *
 *   node scripts/scorecard.mjs <reviewer.xlsx> <tool.xlsx> [options]
 *
 * Options
 *   --sheets "Income Statement,Balance Sheet"   sheets to score (default: the
 *                                               financial and schedule tabs)
 *   --tol 1                                     absolute tolerance (default 1)
 *   --no-recalc                                 do not recalculate the tool
 *                                               workbook with LibreOffice
 *   --cols F,H                                  score these columns only (e.g.
 *                                               the current-year columns when
 *                                               no prior-year return was given)
 *   --lines                                     score form lines only (rows whose
 *                                               caption starts with a line number
 *                                               such as "17", "9a" or "b"): the
 *                                               totals a return reports, not the
 *                                               detail rows beneath them
 *   --json out.json                             also write the full result
 *
 * What counts as a "checked line": a row, on a scored sheet, where either
 * work paper holds a non-zero figure. Rows are paired by their caption text
 * (columns A–C), not their address, so rows a reviewer inserts do not shift
 * the comparison. A line matches when every figure on it agrees within the
 * tolerance (or 0.00001% of the reviewer's figure, whichever is larger). Text,
 * dates, line numbers and blank-versus-zero differences are not scored.
 *
 * The tool writes formulas without cached results, so a plain reader sees
 * them as empty. When LibreOffice (soffice) is on the PATH the tool workbook
 * is recalculated in a temporary folder first; without it only the figures
 * the tool wrote as values are compared, and the report says so.
 *
 * Client workbooks hold client data: the script reads local files only and
 * sends nothing anywhere. Keep client files out of the repository. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const DEFAULT_SHEETS = [
  "Income Statement", "Balance Sheet", "Retained Earnings", "Dividends",
  "Schedule E & E-1", "Sch - H", "Schedule I & I-1", "Schedule J",
  "Schedule M", "Schedule P", "Schedule Q", "Schedule R",
  "Worksheet A", "Worksheet B", "8992 Information",
];

function args(argv) {
  const out = { files: [], sheets: DEFAULT_SHEETS, tol: 1, recalc: true, json: null, cols: null, lines: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sheets") out.sheets = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--tol") out.tol = Number(argv[++i]);
    else if (a === "--no-recalc") out.recalc = false;
    else if (a === "--lines") out.lines = true;
    else if (a === "--json") out.json = argv[++i];
    else if (a === "--cols") out.cols = new Set(argv[++i].split(",").map((c) => c.trim().toUpperCase()).filter(Boolean));
    else out.files.push(a);
  }
  return out;
}

const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Read every sheet's cells: { sheetName: Map<"B12", {v, text}> }. */
async function readWorkbook(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const read = async (p) => (zip.file(p) ? zip.file(p).async("string") : "");
  const shared = [];
  const sst = await read("xl/sharedStrings.xml");
  for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) || []) {
    shared.push(unxml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  }
  const wbXml = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0]), t = /Target="([^"]+)"/.exec(m[0]);
    if (id && t) target[id[1]] = t[1].replace(/^\/?xl\//, "").replace(/^\//, "");
  }
  const sheets = {};
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unxml((/name="([^"]+)"/.exec(m[0]) || [])[1] || "");
    const rid = (/r:id="([^"]+)"/.exec(m[0]) || [])[1];
    if (!name || !rid || !target[rid]) continue;
    const xml = await read("xl/" + target[rid]);
    const cells = new Map();
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] || "";
      const ref = (/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1];
      if (!ref) continue;
      const t = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
      const v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
      const inline = (/<is>([\s\S]*?)<\/is>/.exec(body) || [])[1];
      if (t === "s" && v !== undefined) cells.set(ref, { text: shared[Number(v)] ?? "" });
      else if (t === "inlineStr" && inline) cells.set(ref, { text: unxml(inline.replace(/<[^>]+>/g, "")) });
      else if (t === "str" && v !== undefined) cells.set(ref, { text: unxml(v) });
      else if ((t === undefined || t === "n") && v !== undefined && v !== "" && isFinite(Number(v))) cells.set(ref, { v: Number(v) });
    }
    sheets[name] = cells;
  }
  return sheets;
}

function recalculated(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scorecard-"));
  try {
    execFileSync("soffice", ["--headless", "--calc", "--convert-to", "xlsx", "--outdir", dir, file], { stdio: "ignore", timeout: 180000 });
    const out = path.join(dir, path.basename(file).replace(/\.[^.]+$/, "") + ".xlsx");
    return fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

const split = (ref) => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return { col: m[1], row: Number(m[2]) }; };

/** Rows of a sheet: { row, key, cells: Map<col, number>, caption }. The key is
    the row's text in columns A–E, so a row is found by what it says, not by
    where it sits: a reviewer who inserts four detail rows under line 17 moves
    every later line down, and an address-by-address comparison would then
    report the whole bottom of the schedule as wrong. */
function rowsOf(cells) {
  const byRow = new Map();
  for (const [ref, c] of cells) {
    const { col, row } = split(ref);
    if (!byRow.has(row)) byRow.set(row, { row, text: [], nums: new Map() });
    const r = byRow.get(row);
    if (c.text && c.text.trim() && col.length === 1 && col <= "C") r.text.push([col, c.text.trim()]);
    if (typeof c.v === "number") r.nums.set(col, c.v);
    // A form line number printed as a number in column A or B ("13", "17").
    if ((col === "A" || col === "B") && typeof c.v === "number" && Number.isInteger(c.v) && c.v > 0 && c.v < 30) r.lineNo = true;
  }
  const seen = new Map();
  return [...byRow.values()].sort((a, b) => a.row - b.row).map((r) => {
    const text = r.text.sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((t) => t[1]).join(" | ");
    const base = text.toLowerCase().replace(/\s+/g, " ");
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { row: r.row, key: base ? base + "#" + n : "", caption: text.slice(0, 70), nums: r.nums, lineNo: !!r.lineNo };
  });
}

/** Pair the two sheets' rows: rows with the same text first (longest common
    subsequence, so order is kept), then the rows left between two such
    anchors in order, then anything left over against nothing. */
function alignRows(a, b) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = a[i].key && a[i].key === b[j].key ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0, ga = [], gb = [];
  const flush = () => {
    const k = Math.max(ga.length, gb.length);
    for (let x = 0; x < k; x++) pairs.push([ga[x] || null, gb[x] || null]);
    ga = []; gb = [];
  };
  while (i < n && j < m) {
    if (a[i].key && a[i].key === b[j].key) { flush(); pairs.push([a[i], b[j]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) ga.push(a[i++]);
    else gb.push(b[j++]);
  }
  while (i < n) ga.push(a[i++]);
  while (j < m) gb.push(b[j++]);
  flush();
  return pairs;
}

/** A small whole number printed the same on both sides is a line number
    ("18", "19"), not a figure. */
const isLabelNumber = (x, y) => x === y && Number.isInteger(x) && x > 0 && x < 100;

const fmt = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v * 100) / 100));

async function main() {
  const o = args(process.argv.slice(2));
  if (o.files.length !== 2) {
    console.error("usage: node scripts/scorecard.mjs <reviewer.xlsx> <tool.xlsx> [--sheets a,b] [--tol 1] [--no-recalc] [--json out.json]");
    process.exit(2);
  }
  const [refFile, toolFile] = o.files;
  let toolPath = toolFile, recalc = "not requested";
  if (o.recalc) {
    const r = recalculated(toolFile);
    if (r) { toolPath = r; recalc = "recalculated with LibreOffice"; }
    else recalc = "LibreOffice not available — formula results the tool did not cache are not compared";
  }
  const ref = await readWorkbook(refFile);
  const tool = await readWorkbook(toolPath);
  const result = { reviewer: path.basename(refFile), tool: path.basename(toolFile), recalc, sheets: [], checked: 0, matched: 0, mismatches: [] };
  for (const name of o.sheets) {
    const a = ref[name], b = tool[name];
    if (!a || !b) { result.sheets.push({ name, missing: !a ? "reviewer" : "tool" }); continue; }
    let checked = 0, matched = 0;
    const LINE_ROW = /^(\d{1,2}\s?[a-d]?|[a-d])\s*\|/i;
    for (const [ra, rb] of alignRows(rowsOf(a), rowsOf(b))) {
      if (o.lines && !(ra && ra.lineNo) && !(rb && rb.lineNo) && !LINE_ROW.test((ra && ra.caption) || (rb && rb.caption) || "")) continue;
      const cols = new Set([...(ra ? ra.nums.keys() : []), ...(rb ? rb.nums.keys() : [])]);
      let figures = 0, ok = true;
      const diffs = [];
      for (const col of cols) {
        if (o.cols && !o.cols.has(col)) continue;
        const xv = ra && ra.nums.has(col) ? ra.nums.get(col) : 0, yv = rb && rb.nums.has(col) ? rb.nums.get(col) : 0;
        if (Math.abs(xv) < 0.005 && Math.abs(yv) < 0.005) continue;
        if (isLabelNumber(xv, yv)) continue;
        figures++;
        if (Math.abs(xv - yv) > Math.max(o.tol, Math.abs(xv) * 1e-7)) { ok = false; diffs.push({ col, reviewer: xv, tool: yv }); }
      }
      if (!figures) continue;
      checked++;
      if (ok) matched++;
      else result.mismatches.push({
        sheet: name, reviewerRow: ra ? ra.row : null, toolRow: rb ? rb.row : null,
        caption: (ra && ra.caption) || (rb && rb.caption) || "", toolCaption: rb && ra && rb.caption !== ra.caption ? rb.caption : undefined, diffs,
      });
    }
    result.sheets.push({ name, checked, matched, pct: checked ? Math.round((matched / checked) * 1000) / 10 : null });
    result.checked += checked;
    result.matched += matched;
  }
  result.pct = result.checked ? Math.round((result.matched / result.checked) * 1000) / 10 : null;

  console.log(`Scorecard — ${result.tool} against ${result.reviewer} (${recalc}${o.cols ? `; columns ${[...o.cols].join(", ")} only` : ""}${o.lines ? "; form lines only" : ""})`);
  for (const s of result.sheets) {
    if (s.missing) console.log(`  ${s.name.padEnd(20)} not in the ${s.missing}'s workbook`);
    else if (s.checked) console.log(`  ${s.name.padEnd(20)} ${String(s.matched).padStart(4)} of ${String(s.checked).padEnd(4)} ${s.pct}%`);
  }
  console.log(`  ${"Overall".padEnd(20)} ${String(result.matched).padStart(4)} of ${String(result.checked).padEnd(4)} ${result.pct}%`);
  if (result.mismatches.length) {
    console.log("\nLines that differ (sheet · reviewer row / tool row · caption · column: reviewer → tool):");
    for (const m of result.mismatches) {
      const d = m.diffs.slice(0, 3).map((x) => `${x.col}: ${fmt(x.reviewer)} → ${fmt(x.tool)}`).join("; ");
      console.log(`  ${m.sheet} · ${m.reviewerRow ?? "—"}/${m.toolRow ?? "—"} · ${m.caption}${m.toolCaption ? ` [tool: ${m.toolCaption}]` : ""} · ${d}`);
    }
  }
  if (o.json) fs.writeFileSync(o.json, JSON.stringify(result, null, 1));
}

main().catch((e) => { console.error(e && e.stack || String(e)); process.exit(1); });
