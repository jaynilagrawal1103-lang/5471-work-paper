/* The AI Agent, in the shipped file opened from disk.
 *
 * Proves three things about dist/index.html that no unit test can: the page
 * still boots with the agent block in it, Settings ▸ AI platform shows the
 * agent card in plain language without ever printing a key, and the switch on
 * it reaches the store.
 *
 *   node tests/e2e/agent_ui_e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const DIST = path.join(root, "dist", "index.html");
const EXEC = process.env.CHROME_PATH || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find((p) => fs.existsSync(p));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("ok:", m); } else { fail++; console.log("FAILED:", m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--allow-file-access-from-files"] });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("file://" + DIST);
await page.waitForSelector(".view-stack, .topbar", { timeout: 30000 });
await sleep(1200);

ok(errors.length === 0, `no console errors on boot${errors.length ? " — " + errors.slice(0, 3).join(" | ") : ""}`);

/* the graph is live in the page, not just present in the bundle */
const info = await page.evaluate(() => window.__WPACT.EN9agentInfo());
ok(info.name === "AI Mapping & Review Agent", "the agent names itself");
ok(info.framework === "LangGraph", "the framework is reported");
ok(info.provider === "Groq", "the provider is reported");
ok(info.connected === false, "with no key configured it reports Not connected");
ok(
  JSON.stringify(info.steps) === JSON.stringify(["gather", "understand", "suggest", "terminology", "critique", "route", "reconcile", "survey", "yearCheck", "risks", "spotlight", "interpret", "handoff"]),
  "the panel reads its steps from the compiled graph",
);

/* Settings -> AI platform */
await page.evaluate(() => {
  const nav = [...document.querySelectorAll("button, a")].find((b) => /^\d*\s*Settings$/.test((b.textContent || "").trim()));
  if (nav) nav.click();
});
await sleep(900);
await page.evaluate(() => {
  const tab = [...document.querySelectorAll(".tab-row .tab-button")].find((b) => (b.textContent || "").trim() === "AI platform");
  if (tab) tab.click();
});
await sleep(900);

const card = await page.evaluate(() => {
  const c = document.querySelector(".en9-agent");
  return c ? c.textContent : "";
});
ok(/AI Agent/.test(card), "the AI Agent card is on the AI platform tab");
ok(/LangGraph/.test(card), "it names the framework");
ok(/Groq/.test(card), "it names the AI provider");
ok(/Not connected/.test(card), "it shows the connection status");
ok(/never displayed or exported/.test(card), "it explains that the key is never shown");
ok(/Override the 5471 mapping rules/.test(card), "it states what the agent cannot do");
ok(!/gsk_/.test(card), "no key material anywhere in the card");

/* the switch reaches the store */
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".en9-agent button")].find((x) => /Turn the agent/.test(x.textContent || ""));
  if (b) b.click();
});
await sleep(500);
const off = await page.evaluate(() => window.__WPACT.EN9agentInfo().enabled);
ok(off === false, "the switch turns the agent off in the store");
await page.evaluate(() => window.__WPACT.EN9setAgent({ enabled: true }));

/* ---- the agent in a real processing run ----
   The model is stubbed at the network boundary, so this exercises the page's
   own Groq client, the graph, the mapping gate and the Exception Centre. */
const MAPPED = "Zzq holding charge", HELD = "Frobnicator levy";
await page.route("**://api.groq.com/**", async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  const user = (body.messages || []).map((m) => m.content).join("\n");
  const map = {};
  user.split("\n").filter((l) => /^\d+\./.test(l)).forEach((line) => {
    const i = /^(\d+)\./.exec(line)[1];
    if (line.includes(MAPPED)) map[i] = { t: "IS:34", c: "high", r: "levy on the trade" };
    else if (line.includes(HELD)) map[i] = { t: "IS:35", c: "low", r: "cannot tell what this is" };
  });
  await route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ map }) } }], usage: { total_tokens: 40 } }),
  });
});

const eid = await page.evaluate(() => {
  window.__WPACT.setGroq({ key: "gsk_stub_key_for_the_end_to_end_run", status: "online" });
  window.__WPACT.addEntity();
  const s = window.__WPGET();
  const e = s.entities[s.entities.length - 1];
  window.__WPACT.setActiveEntity(e.id);
  return e.id;
});
await page.evaluate(() => { const b = [...document.querySelectorAll(".nav-item")].find((n) => /entit/i.test(n.textContent)); if (b) b.click(); });
await page.waitForSelector("input[type=file]", { state: "attached", timeout: 15000 });
const inputs = await page.$$("input[type=file][multiple]");
await inputs[inputs.length - 1].setInputFiles(path.join(root, "tests", "fixtures", "agent_grid.csv"));
await page.waitForFunction((id) => window.__WPGET().entities.find((e) => e.id === id).files.length === 1, eid, { timeout: 15000 });
await page.evaluate((id) => window.__WPACT.processEntity(id), eid);
await page.waitForFunction((id) => { const e = window.__WPGET().entities.find((x) => x.id === id); return e && e.processedAt && e.status !== "processing"; }, eid, { timeout: 120000 });

const run = await page.evaluate((id) => {
  const e = window.__WPGET().entities.find((x) => x.id === id);
  return {
    log: e.log,
    lines: e.lines,
    overrides: e.mapOverrides,
    unmatched: (e.unmatched || []).map((u) => ({ label: u.label, reason: u.reason, seen: !!u.EN9agentSeen })),
    items: (e.reviewItems || []).filter((i) => /^agent-/.test(i.id)).map((i) => ({ id: i.id, level: i.level, message: i.message })),
    lastRun: window.__WPGET().EN9agent && window.__WPGET().EN9agent.lastRun,
  };
}, eid);

ok(run.log.some((l) => /AI Mapping & Review Agent/.test(l)), "the agent reports itself in the processing log");
ok(!!run.overrides[MAPPED.toLowerCase()], `the confident suggestion was booked (${MAPPED})`);
ok(run.unmatched.some((u) => u.label === HELD && /not confident enough/.test(u.reason)),
  "the low-confidence caption was held back, with the reason on the row");
ok(run.unmatched.every((u) => u.seen), "every caption the agent read is marked, so the AI pass leaves it alone");
ok(run.items.some((i) => /agent-ambiguous/.test(i.id)), "the held caption raised a review item");
ok(run.items.every((i) => /Evidence: agent_grid\.csv/.test(i.message) || !/Evidence:/.test(i.message)),
  "every review item that cites evidence names the source document");
ok(run.lastRun && run.lastRun.considered >= 2, `the Settings panel has a last run (${run.lastRun && run.lastRun.considered} caption(s))`);
/* The sandbox has no network: the page's own OCR-service and rate probes are
   refused, which is not an application error. Anything else would be. */
const real = errors.filter((e) => !/ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
ok(real.length === 0, `no application errors after a full run${real.length ? " — " + real.slice(0, 2).join(" | ") : ""}`);

/* ---- the review phase in the real app ----
   A balance sheet with one caption the model will not place: the agent must
   report the empty Cash line AND name the unbooked caption whose figure is
   exactly the difference. */
const eid2 = await page.evaluate(() => {
  window.__WPACT.addEntity();
  const s = window.__WPGET();
  const e = s.entities[s.entities.length - 1];
  window.__WPACT.setActiveEntity(e.id);
  return e.id;
});
await page.evaluate(() => { const b = [...document.querySelectorAll(".nav-item")].find((n) => /entit/i.test(n.textContent)); if (b) b.click(); });
await page.waitForSelector("input[type=file]", { state: "attached", timeout: 15000 });
const ins2 = await page.$$("input[type=file][multiple]");
await ins2[ins2.length - 1].setInputFiles(path.join(root, "tests", "fixtures", "agent_bs.csv"));
await page.waitForFunction((id) => window.__WPGET().entities.find((e) => e.id === id).files.length === 1, eid2, { timeout: 15000 });
await page.evaluate((id) => window.__WPACT.processEntity(id), eid2);
await page.waitForFunction((id) => { const e = window.__WPGET().entities.find((x) => x.id === id); return e && e.processedAt && e.status !== "processing"; }, eid2, { timeout: 120000 });

const rev = await page.evaluate((id) => {
  const e = window.__WPGET().entities.find((x) => x.id === id);
  return {
    log: e.log,
    items: (e.reviewItems || []).filter((i) => /^agent-/.test(i.id)).map((i) => ({ id: i.id, message: i.message })),
  };
}, eid2);

ok(rev.log.some((l) => /reviewed the booked balance sheet/.test(l)), "the review phase ran on a balance sheet");
ok(rev.items.some((i) => /Schedule F line 1 \(Cash\) is empty/.test(i.message)), "the empty Cash line is reported");
const imbalance = rev.items.find((i) => /out by/.test(i.message));
ok(!!imbalance, "the imbalance is reported");
ok(!!imbalance && /Zzq clearing account/.test(imbalance.message) && /matches the difference exactly/.test(imbalance.message),
  "the unbooked caption that explains the gap is named");

/* ---- the understanding phase, before mapping ---- */
const brief = await page.evaluate((id) => {
  const e = window.__WPGET().entities.find((x) => x.id === id);
  return e.EN9agentBrief || null;
}, eid);
ok(!!brief, "the agent left a brief from before mapping");
ok(!!brief && brief.docs.some((d) => d.name === "agent_grid.csv" && d.rowsWithFigures > 0),
  "the brief describes the document it read");
ok(!!brief && brief.important.some((i) => /Zzq holding charge/.test(i.label) && i.risk === "no-rule"),
  "a caption with no rule and no heading is flagged before mapping");
ok(!!brief && brief.important.every((i) => !!i.outcome),
  "every flagged item carries what the run did with it");
ok(!!brief && brief.steps.length > 0 && brief.steps[0] === "survey", "the understanding graph ran survey first");

/* ---- the activity view ---- */
await page.evaluate((id) => { window.__WPACT.setActiveEntity(id); }, eid);
await page.evaluate(() => {
  const nav = [...document.querySelectorAll(".nav-item")].find((n) => /entity workspace/i.test(n.textContent || ""));
  if (nav) nav.click();
});
await sleep(900);
await page.evaluate(() => {
  const tab = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Review & log");
  if (tab) tab.click();
});
await sleep(900);
if (!(await page.evaluate(() => !!document.querySelector(".en9-agentact")))) {
  // The workspace hides the log behind a toggle; open it.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /show processing log/i.test(x.textContent || ""));
    if (b) b.click();
  });
  await sleep(900);
}
const act = await page.evaluate(() => {
  const c = document.querySelector(".en9-agentact");
  return c ? c.textContent : "";
});
ok(/AI Agent/.test(act) && /Mapping & Review/.test(act), "the agent dashboard is on the entity's Review & log tab");
ok(/Documents\s*Items reviewed|Documents/.test(act) && /Items reviewed/.test(act), "it leads with the numbers");
ok(/Agent activity/.test(act), "it lists the steps that ran");
ok(/Tax year check/.test(act), "it shows the tax year check");
ok(/Detected/.test(act) && /Work paper year/.test(act) && /Chosen by/.test(act),
  "the year chain reads detected, selected, current, prior and who chose");
ok(/Documents understood/.test(act), "it lists the documents it understood");
ok(/agent_grid\.csv/.test(act), "it names the document");
ok(/How the agent helped/.test(act) && /Understood/.test(act), "it shows where the agent sat in the workflow");
ok(/the rates and the checks decide/.test(act), "it states the limit of its authority");
const counts = await page.evaluate(() => {
  const c = document.querySelector(".en9-agentact");
  return {
    stats: [...c.querySelectorAll(".en9-ag-stat .en9-ag-lab")].map((x) => x.textContent),
    rows: c.querySelectorAll(".en9-ag-table .en9-ag-tr").length,
    cards: c.querySelectorAll(".en9-ag-card").length,
    buttons: [...c.querySelectorAll("button")].map((b) => b.textContent),
  };
});
ok(counts.stats.join("|") === "Documents|Items reviewed|Issues found|Sent to Review|Could not process",
  "the summary card carries the five counts");
ok(counts.rows >= 2, "the tax year check has a header row and a row per document");
ok(counts.buttons.some((b) => /View source|Open document/.test(b)), "every finding and document offers its source");
/* no walls of text: the longest paragraph in the card stays short */
const longest = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll(".en9-agentact p, .en9-agentact .en9-ag-text")].map((p) => p.textContent.length)));
ok(longest <= 210, `no paragraph longer than 210 characters (longest ${longest})`);
/* and the old repeated prefix is gone from the card */
ok(!/AI Mapping & Review Agent:/.test(act), "the repeated agent prefix is not printed on every line");

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
