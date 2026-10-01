/* Review insights: the checks that tell the preparer what is missing, how
 * sure the reading was, why a document produced nothing, what to fix first
 * and how the figures add up.
 *
 * Every one of them is a RULE over the entity as processing left it. None
 * books, moves or changes a figure: each returns review items, and the items
 * are advice. The wording is written for the preparer, in the way the AI
 * Mapping & Review Agent explains its findings, but nothing here needs a
 * model or a network, so it works offline and says the same thing every time.
 *
 * Pure and self-contained (no imports), because the shipped file carries this
 * module compiled as one block (dist sentinel EN9INSIGHTS) and both trees must
 * give the same answer.
 */

export type InsightItem = {
  id: string;
  level: "block" | "warn" | "info";
  category: "fx" | "mapping" | "carry-forward" | "related-party" | "source-gap" | "profile" | "consistency" | "process" | "tie-out" | "entity-scope";
  message: string;
  target?: string;
  source?: string;
  suggestedValue?: string | number;
  dismissed?: boolean;
};

type Pg = { page: number; kind: string };
type Cls = {
  fileId: string; fileName: string; kind: string; method?: string; pages?: Pg[];
  statementYear?: number | null; textRows?: number; textChars?: number; amountRows?: number;
  language?: string; entityName?: string | null; duplicateOf?: string | null;
};
type OcrWordLike = { text: string; bbox: number[]; conf: number };
type OcrPageLike = { page: number; status: string; confMean?: number | null; words?: OcrWordLike[] };
type FileLike = { id: string; name: string; ocr?: { pages: OcrPageLike[] } | null };
type Contribution = { docName?: string; label?: string; value?: number; field?: string };
type Holder = { name: string; eoy?: number | string; pct?: number };

export type InsightEntity = {
  name?: string;
  /** Other names the same company prints its papers under. */
  nameAliases?: string[];
  processedAt?: string | null;
  profile: Record<string, string | undefined>;
  ownership?: Record<string, string | undefined>;
  fx?: Record<string, string | undefined>;
  fxMeta?: Record<string, { source?: string; tag?: string } | undefined>;
  files?: FileLike[];
  docClasses?: Record<string, Cls>;
  lines: Record<string, { amount?: number | null; eoy?: number | null; boy?: number | null } | undefined>;
  contributions?: Record<string, Contribution[] | undefined>;
  unmatched?: { label: string; docName?: string }[];
  shareholders?: Holder[];
  usShareholders?: Holder[];
  detected?: Record<string, { sourceLabel?: string } | undefined>;
  /* src stores the figure as `value`; the shipped file keeps the row's
     `values` and `years` and picks the year when it reads them. */
  statedResults?: { label: string; value?: number; values?: number[]; years?: (number | null)[]; feed: string }[];
};

/** What the preparer chose before, on this machine. Suggestions only. */
export type ChoiceMemory = {
  docKind?: Record<string, { kind: string; count: number; example: string }>;
  fx?: Record<string, { rate: string; count: number; entity: string }>;
};

const n = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
const fmt = (v: number) => (typeof v === "number" && isFinite(v) ? v : 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const pct = (v: number) => `${Math.round(v * 100)}%`;
const r2 = (v: number) => Math.round(v * 100) / 100;

const KIND_LABEL: Record<string, string> = {
  "cfc-financial-statements": "financial statements",
  "cfc-tax-return": "foreign tax return",
  "prior-year-us-return": "prior-year U.S. return (Form 5471)",
  "trial-balance": "trial balance / statement spreadsheet",
  "client-questionnaire": "client questionnaire",
  "related-party-ledger": "related-party ledger",
  "related-party-salary": "related-party salary schedule",
  "terms-and-conditions": "terms and conditions",
  unknown: "unidentified document",
};
const kindLabel = (k: string) => KIND_LABEL[k] || k;

/* ---------- 1. documents the work paper needs ---------- */

const STATEMENT_KINDS = new Set(["cfc-financial-statements", "trial-balance", "cfc-tax-return", "unknown"]);

export function missingDocuments(ent: InsightEntity): InsightItem[] {
  if (!ent.processedAt) return [];
  const out: InsightItem[] = [];
  const docs = Object.values(ent.docClasses || {}).filter((c) => !c.duplicateOf);
  /* "Found but not read" only for this year's statements of THIS company. A
     balance sheet attached inside the prior-year U.S. return, or the
     statements of a sister company in the same upload, is not a current
     statement this entity failed to read — the client still has to send it. */
  const me = ent.profile.legalName || ent.name || "";
  const ownStatements = docs.filter((c) => c.kind !== "prior-year-us-return"
    && !(c.entityName && me && !namesThisEntity(c.entityName, ent)));
  const pageKinds = new Set(ownStatements.flatMap((c) => (c.pages || []).map((p) => p.kind)));
  const lineKeys = Object.keys(ent.lines || {});
  const bsRead = lineKeys.some((k) => k.startsWith("BS:") && n(ent.lines[k]?.eoy) !== null);
  const isRead = lineKeys.some((k) => k.startsWith("IS:") && n(ent.lines[k]?.amount) !== null);
  const bsOpen = lineKeys.some((k) => k.startsWith("BS:") && n(ent.lines[k]?.boy) !== null);
  const hasPrior = docs.some((c) => c.kind === "prior-year-us-return");
  const tb = ownStatements.some((c) => c.kind === "trial-balance");
  const yearEnd = ent.profile.cyEnd || "the year end";

  if (!bsRead) {
    const seen = pageKinds.has("fs-balance-sheet") || tb;
    out.push({
      id: "doc-missing-balance-sheet", level: "warn", category: "source-gap",
      message: seen
        ? `A balance sheet was found in the documents, but no year-end balance could be read from it, so Schedule F (the balance sheet) cannot be completed. Check that page on the Documents tab (document type, OCR quality) or enter the balances by hand.`
        : `Balance Sheet is required because Schedule F (the balance sheet) cannot be completed without it. Ask the client for the balance sheet at ${yearEnd}.`,
    });
  }
  if (!isRead) {
    const seen = pageKinds.has("fs-pnl") || pageKinds.has("fs-trading") || tb;
    out.push({
      id: "doc-missing-pnl", level: "warn", category: "source-gap",
      message: seen
        ? `A profit and loss statement was found, but no income or expense could be read from it, so Schedule C (the income statement) and current-year E&P cannot be completed. Check that page on the Documents tab or enter the figures by hand.`
        : `Profit and Loss statement is required because Schedule C (the income statement) and current-year E&P (Schedules H and J) cannot be completed without it. Ask the client for the profit and loss statement for the year to ${yearEnd}.`,
    });
  }
  if (!hasPrior) {
    out.push({
      id: "doc-missing-prior-return", level: "warn", category: "source-gap",
      message: bsOpen
        ? `Prior-year Form 5471 is not among the documents. The opening balances were taken from the statements' own prior-year column, but Schedule J's opening E&P, the Reference ID, the filer categories and the shareholders are normally carried from it. Ask for last year's filed return, or confirm this is the first year this corporation is reported.`
        : `Prior-year Form 5471 is required for opening balances: Schedule F column (a), Schedule J's opening E&P and the carried details (Reference ID, shareholders, categories) cannot be filled from this year's statements alone. Ask for last year's filed return, or confirm this is the first year this corporation is reported.`,
    });
  }
  const holders = (ent.shareholders || []).length + (ent.usShareholders || []).length;
  const ownKnown = !!(ent.ownership && (ent.ownership.ownEnd || ent.ownership.ownStart));
  if (!holders && !ownKnown) {
    out.push({
      id: "doc-missing-ownership", level: "warn", category: "source-gap",
      message: "Ownership register is required because Schedule B (shareholders) and the ownership percentage cannot be verified without it. Ask for the share register or shareholder list at the year end.",
    });
  }
  return out;
}

/* ---------- 2. how sure the OCR reading was ---------- */

const FIGURE = /^[(\-]?[$€£]?\d[\d.,]*\)?%?$/;

export function ocrSummary(ent: InsightEntity): InsightItem[] {
  const out: InsightItem[] = [];
  for (const f of ent.files || []) {
    const pages = (f.ocr?.pages || []).filter((p) => p.status === "ocr" && (p.words || []).length);
    if (!pages.length) continue;
    const perPage = pages.map((p) => {
      const words = p.words || [];
      const confs = words.map((w) => w.conf).filter((c) => typeof c === "number");
      const mean = typeof p.confMean === "number" ? p.confMean : confs.reduce((a, b) => a + b, 0) / Math.max(1, confs.length);
      const figures = words.filter((w) => FIGURE.test(String(w.text || "").trim()) && /\d/.test(w.text));
      /* A table row is a line that carries a figure; its caption belongs to
         the same table, so every word on such a line counts. */
      const lineOf = (w: OcrWordLike) => Math.round(((w.bbox[1] || 0) + (w.bbox[3] || 0)) / 2 / 5);
      const tableLines = new Set(figures.map(lineOf));
      const table = words.filter((w) => tableLines.has(lineOf(w)));
      return {
        page: p.page, mean, figures,
        table,
        lowFigures: figures.filter((w) => w.conf < 0.9),
      };
    });
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const overall = avg(perPage.map((p) => p.mean));
    const figureConf = avg(perPage.flatMap((p) => p.figures.map((w) => w.conf)));
    const tableConf = avg(perPage.flatMap((p) => p.table.map((w) => w.conf)));
    const low = perPage.filter((p) => typeof p.mean === "number" && p.mean < 0.85);
    const lowFig = perPage.filter((p) => p.lowFigures.length);
    const parts = [
      `OCR confidence for ${f.name}: ${overall === null ? "n/a" : pct(overall)} overall`,
      tableConf === null ? "" : `tables ${pct(tableConf)}`,
      figureConf === null ? "" : `figures ${pct(figureConf)}`,
    ].filter(Boolean).join(" · ");
    const pageList = perPage.map((p) => `page ${p.page}: ${pct(p.mean)}${p.mean < 0.85 ? " — needs review" : ""}`).join(", ");
    out.push({
      id: `ocr-summary-${f.id}`, level: "info", category: "process", source: f.name,
      message: `${parts}. By page — ${pageList}.` +
        (lowFig.length ? ` Figures read below 90%: ${lowFig.map((p) => `page ${p.page} (${p.lowFigures.map((w) => w.text).slice(0, 4).join(", ")}${p.lowFigures.length > 4 ? ", …" : ""})`).join("; ")}.` : " Every figure was read at 90% or more."),
    });
    for (const p of low) {
      out.push({
        id: `ocr-page-low-${f.id}-p${p.page}`, level: "warn", category: "process", source: f.name,
        message: `Page ${p.page} of ${f.name} was read at ${pct(p.mean)} confidence — needs review. Check its figures against the scan before relying on them${p.figures.length ? ` (${p.figures.length} figure(s) on the page)` : ""}.`,
      });
    }
  }
  return out;
}

/* ---------- 3. why a document produced nothing ---------- */

const words = (s: string) => new Set(String(s || "").toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(inc|ltd|llc|srl|sa|sas|spa|the|de|del|la|el|limited|company)$/.test(w)));
/* A document names this entity when it names its legal name or any name the
   same company is known to print its papers under. */
const namesThisEntity = (name: string, ent: InsightEntity) => {
  const mine = [ent.profile.legalName || ent.name || "", ...(ent.nameAliases || [])].filter(Boolean);
  return !mine.length || mine.some((m) => sameCompany(name, m));
};
const sameCompany = (a: string, b: string) => {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return true;
  let hit = 0;
  for (const w of x) if (y.has(w)) hit++;
  return hit / Math.min(x.size, y.size) >= 0.5;
};

export function documentDiagnosis(ent: InsightEntity): InsightItem[] {
  if (!ent.processedAt) return [];
  const out: InsightItem[] = [];
  const booked = new Map<string, number>();
  for (const list of Object.values(ent.contributions || {})) for (const c of list || []) {
    if (c.docName) booked.set(c.docName, (booked.get(c.docName) || 0) + 1);
  }
  const cy = Number((/(\d{2,4})\s*$/.exec(ent.profile.cyEnd || "") || [])[1]) || null;
  const cyYear = cy === null ? null : cy < 100 ? 2000 + cy : cy;
  const me = ent.profile.legalName || ent.name || "";
  /* The work paper year's own statements, already booked. When they are in,
     a prior-year file left unused is not a missing document: their
     comparative column already supplied the opening balances. */
  const cyDoc = cyYear === null ? undefined : Object.values(ent.docClasses || {}).find((d) =>
    !d.duplicateOf && d.statementYear === cyYear && STATEMENT_KINDS.has(d.kind) && d.kind !== "unknown" && booked.get(d.fileName));
  for (const c of Object.values(ent.docClasses || {})) {
    if (c.duplicateOf || !STATEMENT_KINDS.has(c.kind)) continue;
    if (booked.get(c.fileName)) continue;
    // A document naming another company feeds that company's entity.
    if (c.entityName && me && !namesThisEntity(c.entityName, ent)) continue;
    const file = (ent.files || []).find((f) => f.id === c.fileId || f.name === c.fileName);
    const ocrPages = (file?.ocr?.pages || []).filter((p) => p.status === "ocr" && typeof p.confMean === "number");
    const ocrMean = ocrPages.length ? ocrPages.reduce((a, p) => a + (p.confMean as number), 0) / ocrPages.length : null;
    const unmatched = (ent.unmatched || []).filter((u) => u.docName === c.fileName);
    const kinds = new Set((c.pages || []).map((p) => p.kind));
    let why = "", next = "", need = "";
    if ((c.textRows || 0) === 0 || (c.textChars || 0) < 40) {
      why = file?.ocr ? "OCR ran but read no usable text from it" : "it has no text layer — it is a scanned image";
      next = file?.ocr ? "Upload a clearer scan or a digital copy." : "Run it through OCR on the Documents tab, then process again.";
      need = "a readable (digital or clearly scanned) copy of the same document";
    } else if (ocrMean !== null && ocrMean < 0.8) {
      why = `OCR read it at only ${pct(ocrMean)} confidence, too unsure to map`;
      next = "Check the scan quality; upload a clearer scan or the original digital file.";
      need = "a clearer copy of the same document";
    } else if (c.kind === "cfc-tax-return" || kinds.has("tax-form")) {
      why = "it is a foreign tax return, not a set of financial statements — only its income and expense boxes can be used";
      next = "Keep it for Schedule E (tax), and ask for the financial statements for the balance sheet.";
      need = "the financial statements (balance sheet and profit and loss) for the same year";
    } else if (cyDoc && cyYear && c.statementYear === cyYear - 1) {
      why = `it reports on ${c.statementYear}, the prior year; the ${cyYear} figures and the ${c.statementYear} opening column come from the comparative statements in ${cyDoc.fileName}`;
      next = "Nothing to upload for this year. Keep it as reference, or set its document type on the Documents tab if its own figures are needed.";
      need = `none for ${cyYear} — last year's Form 5471, if one was filed, for Schedule J's opening E&P`;
    } else if (c.statementYear && cyYear && c.statementYear !== cyYear) {
      why = `it reports on ${c.statementYear}, not the work paper year ${cyYear}`;
      next = `Upload the ${cyYear} statements, or change the work paper year if ${c.statementYear} is the year being prepared.`;
      need = `the ${cyYear} financial statements`;
    } else if (unmatched.length) {
      const foreign = c.language && !/^english$/i.test(c.language);
      why = `${unmatched.length} caption(s) were read but none matched a work paper line (for example "${unmatched[0].label}")${foreign ? `; the document is in ${c.language}` : ""}`;
      next = foreign
        ? "Translate the captions on Mapping & adjustments (or let the AI mapping pass suggest lines), then assign them."
        : "Assign the captions on Mapping & adjustments, or let the AI mapping pass suggest lines.";
      need = "nothing more — the figures are there; they need a line each";
    } else if (c.kind === "unknown") {
      why = (c.amountRows || 0) > 0
        ? "figures were read, but the document names no statement the rules know (balance sheet, profit and loss, trial balance)"
        : "no caption on it carries an amount — the labels or the figures are missing";
      next = "Set the document type on the Documents tab if it is a statement; otherwise it is reference material and can stay as it is.";
      need = "the balance sheet and profit and loss, if this is not them";
    } else {
      why = "its pages were read, but none of them is a balance sheet or profit and loss the rules could book";
      next = "Check the page types on the Documents tab; set the right one and process again.";
      need = "the balance sheet and profit and loss, if this document is something else";
    }
    out.push({
      id: `doc-diagnosis-${c.fileId}`, level: "warn", category: "source-gap", source: c.fileName,
      message: `Nothing was booked from ${c.fileName} (${kindLabel(c.kind)}). Why: ${why}. Next step: ${next} Document needed: ${need}.`,
    });
  }
  return out;
}

/* ---------- 4. how Schedule C adds up ---------- */

const OD_ROWS = [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58];

export function calculationExplanation(ent: InsightEntity): InsightItem[] {
  const L = ent.lines || {};
  if (!Object.keys(L).some((k) => k.startsWith("IS:"))) return [];
  const amt = (r: number) => n(L[`IS:${r}`]?.amount) ?? 0;
  const sum = (rows: number[]) => r2(rows.reduce((a, r) => a + amt(r), 0));
  const receipts = amt(7), returns = amt(8), cogs = sum([10, 11, 12]);
  const gross = r2(receipts - returns - cogs);
  const other = sum([14, 15, 16, 17, 18, 19, 20, 22, 23, 24]);
  const income = r2(gross + other);
  const deductions = r2(sum([26, 27, 28, 29, 30, 31, 32]) + sum(OD_ROWS));
  const beforeTax = r2(income - deductions + amt(61));
  const tax = r2(amt(62) + amt(63));
  const net = r2(beforeTax - tax);
  const steps = [
    `Gross receipts ${fmt(receipts)}`,
    returns ? `− returns ${fmt(returns)}` : "",
    cogs ? `− cost of goods sold ${fmt(cogs)}` : "",
    `= gross profit ${fmt(gross)}`,
    other ? `+ other income ${fmt(other)} = total income ${fmt(income)}` : "",
    `− deductions ${fmt(deductions)}`,
    amt(61) ? `+ unusual items ${fmt(amt(61))}` : "",
    `= income before tax ${fmt(beforeTax)}`,
    tax ? `− income tax ${fmt(tax)}` : "",
    `= net income ${fmt(net)}`,
  ].filter(Boolean).join(" ");
  const cyNum = Number((/(\d{2,4})\s*$/.exec(ent.profile.cyEnd || "") || [])[1]) || null;
  const cyYear = cyNum === null ? null : cyNum < 100 ? 2000 + cyNum : cyNum;
  const statedValue = (x: NonNullable<InsightEntity["statedResults"]>[number]): number | null => {
    if (n(x.value) !== null) return x.value as number;
    const vals = x.values || [];
    const at = cyYear !== null && x.years ? x.years.indexOf(cyYear) : -1;
    if (at >= 0) return n(vals[at]);
    return vals.length === 1 ? n(vals[0]) : null;
  };
  const stated = (ent.statedResults || []).find((x) => x.feed === "is" && statedValue(x) !== null);
  const sv = stated ? statedValue(stated) : null;
  const tie = stated && sv !== null
    ? Math.abs(sv - net) <= Math.max(1, Math.abs(sv) * 0.001)
      ? ` It agrees with the statement's own "${stated.label}" ${fmt(sv)}.`
      : ` The statement's own "${stated.label}" is ${fmt(sv)} — ${fmt(r2(sv - net))} apart; see the tie-out item.`
    : "";
  return [{
    id: "calc-explain", level: "info", category: "consistency",
    message: `How Schedule C adds up (functional currency): ${steps}.${tie} Current-year E&P (Schedule H line 1 and Schedule J) starts from this net income.`,
  }];
}

/* ---------- 5. why the ownership answers are what they are ---------- */

const CORPORATE = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|pty|gmbh|ag|s\.?a\.?|s\.?r\.?l|b\.?v|n\.?v|holdings?|trust|fund|group|lp)\b\.?/i;

export function ownershipExplanation(ent: InsightEntity): InsightItem[] {
  const o = ent.ownership || {};
  if (!o.ownEnd && !o.cfc && !o.tenPct) return [];
  const src = (k: string) => ent.detected?.[k]?.sourceLabel;
  const us = ent.usShareholders || [];
  const holders = ent.shareholders || [];
  const parts: string[] = [];
  if (o.ownEnd) parts.push(`Ownership ${o.ownEnd}% at year end${src("ownEnd") ? ` (from ${src("ownEnd")})` : ""}.`);
  if (us.length) parts.push(`U.S. shareholders: ${us.map((h) => `${h.name}${typeof h.pct === "number" ? ` ${h.pct}%` : ""}`).join(", ")}.`);
  if (o.cfc) parts.push(`CFC: ${o.cfc}${src("cfc") ? ` — ${src("cfc")}` : ""}.`);
  if (o.tenPct) {
    const corp = holders.filter((h) => CORPORATE.test(h.name));
    parts.push(o.tenPct === "No" && holders.length && !corp.length
      ? `10% corporate shareholder: No — every Schedule B holder is a person (${holders.map((h) => h.name).join(", ")}). Answer Yes only if a corporation (or trust) holds 10% or more; confirm, because reviewers answer this question differently.`
      : `10% corporate shareholder: ${o.tenPct}${corp.length ? ` — ${corp.map((h) => h.name).join(", ")} is a company` : ""}.`);
  }
  if (!parts.length) return [];
  return [{ id: "ownership-basis", level: "info", category: "profile", message: `Why the ownership answers read as they do: ${parts.join(" ")}` }];
}

/* ---------- 6. what the preparer chose before (suggestions only) ---------- */

/** A file's name reduced to the words that say what it is: dates, numbers,
    client names in the usual "Client.date.time.MISC." prefix and the
    extension go. */
export function fileSignature(name: string): string {
  let base = String(name || "").toLowerCase();
  /* "Client_Name.8_20_2025.10_38_33AM.MISC.Balance_Sheet.pdf" — the portal's
     prefix names the client and the upload time, not the document. */
  const misc = base.lastIndexOf(".misc.");
  if (misc >= 0) base = base.slice(misc + 6);
  return base
    .replace(/\.(pdf|xlsx?|xlsm|csv|tsv|docx?|txt)+$/g, "")
    .replace(/\(ocr\)/g, " ")
    .replace(/[^a-zà-ÿ]+/g, " ")
    .split(" ").filter((w) => w.length > 2 && !/^(misc|copy|final|signed|updated|pm|am|v\d*)$/.test(w))
    .slice(-6).join(" ").trim();
}

export function memorySuggestions(ent: InsightEntity, memory: ChoiceMemory | null | undefined): InsightItem[] {
  if (!memory) return [];
  const out: InsightItem[] = [];
  for (const c of Object.values(ent.docClasses || {})) {
    if (c.method === "user" || c.duplicateOf) continue;
    const m = memory.docKind?.[fileSignature(c.fileName)];
    if (m && m.kind !== c.kind) {
      out.push({
        id: `memory-doctype-${c.fileId}`, level: "info", category: "process", source: c.fileName,
        message: `Suggestion: you set a document like this one ("${m.example}") to ${kindLabel(m.kind)} ${m.count} time(s) before. ${c.fileName} was read as ${kindLabel(c.kind)}. If it is the same kind of document, change its type on the Documents tab — nothing was changed automatically.`,
      });
    }
  }
  const ccy = (ent.profile.currency || "").toUpperCase();
  const yr = (/(\d{2})\s*$/.exec(ent.profile.cyEnd || "") || [])[1];
  const m = ccy && yr ? memory.fx?.[`${ccy}|20${yr}`] : undefined;
  if (m && String(ent.fx?.avgRate || "") !== m.rate) {
    const now = ent.fx?.avgRate ? `this work paper uses ${ent.fx.avgRate}${ent.fxMeta?.avgRate?.tag ? ` (${ent.fxMeta.avgRate.tag})` : ""}` : "this work paper has no average rate yet";
    out.push({
      id: `memory-fx-${ccy}`, level: "info", category: "fx", target: "Basic Information!C59", suggestedValue: m.rate,
      message: `Suggestion: you entered the ${ccy} average rate for 20${yr} as ${m.rate} on ${m.entity}; ${now}. Use your rate if it is your firm's source — nothing was changed automatically.`,
    });
  }
  return out;
}

/** Everything the per-entity rules above say, in one call. */
export function entityInsights(ent: InsightEntity, memory?: ChoiceMemory | null): InsightItem[] {
  /* Each check stands alone: one that cannot read an unusual entity says
     nothing, and the others still speak. */
  const safe = (f: () => InsightItem[]): InsightItem[] => { try { return f(); } catch { return []; } };
  return [
    ...safe(() => missingDocuments(ent)),
    ...safe(() => ocrSummary(ent)),
    ...safe(() => documentDiagnosis(ent)),
    ...safe(() => calculationExplanation(ent)),
    ...safe(() => ownershipExplanation(ent)),
    ...safe(() => memorySuggestions(ent, memory)),
  ];
}

/* ---------- 7. what to fix first, and what reconciles ---------- */

const CATEGORY_WEIGHT: Record<string, number> = {
  "tie-out": 30, "source-gap": 25, fx: 20, consistency: 15, mapping: 10, "entity-scope": 10, profile: 5, "carry-forward": 5, "related-party": 5, process: 0,
};
const firstSentence = (s: string) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  const cut = t.search(/(?<=[.!?])\s/);
  const one = cut > 0 ? t.slice(0, cut) : t;
  return one.length > 160 ? one.slice(0, 157) + "…" : one;
};

const RECONCILIATIONS: { name: string; fails: (id: string) => boolean; applies: (ent: InsightEntity) => boolean }[] = [
  { name: "Schedule F balances at the year end", fails: (id) => id === "EN9-tie-bs-eoy", applies: (e) => Object.keys(e.lines).some((k) => k.startsWith("BS:") && n(e.lines[k]?.eoy) !== null) },
  { name: "Schedule F balances at the start of the year", fails: (id) => id === "EN9-tie-bs-boy", applies: (e) => Object.keys(e.lines).some((k) => k.startsWith("BS:") && n(e.lines[k]?.boy) !== null) },
  { name: "Schedule C agrees with the profit and loss bottom line", fails: (id) => id === "pnl-net-income-tie" || id === "EN9-tie-pnl", applies: (e) => (e.statedResults || []).some((s) => s.feed === "is") },
  { name: "the profit and loss and the balance sheet report the same result", fails: (id) => id === "pnl-bs-result-differ", applies: (e) => (e.statedResults || []).length > 0 },
  { name: "retained earnings roll forward", fails: (id) => id === "re-books-not-rolling" || id === "re-rollforward", applies: (e) => n(e.lines["BS:61"]?.eoy) !== null },
  { name: "opening balances agree with the prior-year return", fails: (id) => id.startsWith("cf-boy-"), applies: (e) => Object.values(e.docClasses || {}).some((c) => c.kind === "prior-year-us-return") },
  { name: "no figure is counted twice across documents or pages", fails: (id) => id.startsWith("dup-doc-") || id.startsWith("echo-page-"), applies: () => true },
];

export function summarizeReview(ent: InsightEntity, items: InsightItem[]): InsightItem[] {
  if (!ent.processedAt) return [];
  const out: InsightItem[] = [];
  const open = items.filter((i) => i && !i.dismissed && i.level !== "info" && i.id !== "review-priorities" && i.id !== "reconciliation-summary");
  if (open.length) {
    const score = (i: InsightItem) => (i.level === "block" ? 100 : 50) + (CATEGORY_WEIGHT[i.category] ?? 0) + (/\d{1,3}(?:,\d{3})+|\d{4,}/.test(i.message) ? 5 : 0);
    const ranked = open.map((i, k) => ({ i, k, s: score(i) })).sort((a, b) => b.s - a.s || a.k - b.k).slice(0, 5);
    out.push({
      id: "review-priorities", level: "info", category: "process",
      message: `Fix these first (${open.length} open item(s), ranked by what blocks the work paper and what moves figures): ` +
        ranked.map((x, k) => `${k + 1}. ${x.i.level === "block" ? "[Blocking] " : ""}${firstSentence(x.i.message)}`).join(" "),
    });
  }
  const ids = items.filter((i) => i && !i.dismissed).map((i) => String(i.id || ""));
  const checks = RECONCILIATIONS.filter((r) => r.applies(ent)).map((r) => `${ids.some(r.fails) ? "✗" : "✓"} ${r.name}`);
  if (checks.length) {
    out.push({
      id: "reconciliation-summary", level: "info", category: "tie-out",
      message: `Reconciliation across the documents: ${checks.join(" · ")}.${checks.some((c) => c.startsWith("✗")) ? " Each ✗ has its own item in the Exception Center." : ""}`,
    });
  }
  return out;
}
