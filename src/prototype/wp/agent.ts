/* The AI Mapping & Review Agent.
 *
 * Where it sits:
 *
 *   documents -> OCR/extraction -> translation -> [ AGENT ] -> 5471 rules and
 *   mapping -> validation -> review / exceptions -> work paper
 *
 * The agent runs on what the earlier stages already produced — the cached
 * extraction, the section banners, the translations — and never re-reads a
 * document. It ends at a list of SUGGESTIONS. It books nothing: the store
 * hands every suggestion to `manualApply`, the same gate a preparer's own
 * assignment passes, and the existing rules, FX policy, calculations and
 * validations decide the outcome. Anything the agent is not confident about,
 * or that contradicts itself or the document, is routed to the Review /
 * Exception Centre instead.
 *
 * The graph is built with the LangGraph state-graph API (see `agentGraph.ts`
 * for why that runtime is local). This module is pure: the model client and
 * the log sink arrive through the graph config, so the whole agent can be run
 * in a test with no network.
 */

import { StateGraph, START, END, append, last, type RunConfig } from "./agentGraph";
import { parseMap, norm1, ok as aiOk, askResume, maxTokensFor, type Proposal } from "./aiMapping";

export const AGENT_NAME = "AI Mapping & Review Agent";
export const AGENT_FRAMEWORK = "LangGraph";
export const AGENT_PROVIDER = "Groq";

/** What the panel tells a non-technical reader. Kept here, beside the graph
    that has to honour it, rather than in the view. */
export const AGENT_CAN = [
  "Read the documents you already uploaded and work out what each caption means in accounting terms",
  "Suggest which work paper line a caption belongs on",
  "Point out information that is missing, contradictory or could be read two ways",
  "Check that translated captions use consistent English wording",
  "Show the document, page and figures behind every suggestion, with how sure it is",
];
export const AGENT_CANNOT = [
  "Change a figure in the work paper — amounts always come from your documents",
  "Override the 5471 mapping rules, the exchange rates or any calculation",
  "Decide a final value or sign anything off",
  "Skip a validation — everything it suggests goes through the same checks as your own entries",
];

/* ---------- what the agent works on ---------- */

export type AgentRow = {
  key: string;                       // normalised caption, the store's row key
  label: string;
  /** Set when the structure pass dropped this row before mapping, with its
      reason. The agent reads these too — a figure dropped as a subtotal that
      is not one is invisible everywhere else. */
  dropped?: string;
  /** Whether a keyword rule claims the caption. The agent uses it to tell an
      item that will simply be mapped from one that will fall through. */
  ruleMatched?: boolean;
  english?: string;                  // the translation stage's output, when there is one
  values: Array<number | null>;
  years: Array<number | null>;
  section?: string;                  // the banner the caption printed under
  docName?: string;
  docKind?: string;
  page?: number | null;
};

export type AgentEvidence = {
  doc: string;
  page: number | null;
  caption: string;
  english?: string;
  section?: string;
  amounts: string;
};

export type AgentSuggestion = {
  key: string;
  caption: string;
  target: string | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
  evidence: AgentEvidence;
  status: "suggested" | "accepted" | "exception";
  /** Why it was routed to the Exception Centre, in the preparer's words. */
  issue?: string;
};

export type AgentFinding = {
  kind: "missing" | "conflict" | "ambiguous" | "terminology" | "balance" | "period" | "failure" | "unused";
  key?: string;
  caption?: string;
  message: string;
  evidence?: AgentEvidence;
};

/** What the books look like after the deterministic rules and the agent's own
    accepted suggestions have been booked. The review phase reads this; the
    mapping phase leaves it empty. */
export type BookFacts = {
  cyEnd?: string;
  /** The provenance line behind `cyEnd` — the word "assumed" in it is the
      difference between a date read from a document and one invented. */
  cyEndSource?: string;
  statementPeriodEnd?: string | null;
  statementDoc?: string;
  assetsEoy: number;
  liabEquityEoy: number;
  equityEoy: number;
  /** Target ids that carry a figure. */
  filled: string[];
  /** What the understanding phase said mattered, and what the pipeline did
      with each one. The review phase closes the loop: an important item that
      was neither booked nor left visible in Review was silently ignored, and
      silently ignoring something is the one outcome the agent must not allow. */
  important?: AgentImportant[];
  bookedKeys?: string[];
  unmatchedKeys?: string[];
  /** Everything the agent could not do earlier in the run. */
  failures?: AgentFailure[];
};

/* ---------- what the agent learns BEFORE mapping ---------- */

/** One document, as the agent understands it. */
export type DocBrief = {
  docId: string;
  name: string;
  kind: string;
  pages: number;
  statementYear: number | null;
  periodEnd: string | null;
  periodStart?: string | null;
  /** What this document is FOR, once its year is known against the year the
      work paper is being prepared for. */
  role?: "current-year" | "prior-year-input" | "comparative" | "reference" | "unclear";
  /** The work paper year this document supports. */
  supportsYear?: number | null;
  match?: "match" | "mismatch" | "unclear" | "unchecked";
  rowsRead: number;
  rowsWithFigures: number;
  rowsDropped: number;
  sections: string[];
  language: string;
  ocr?: boolean;
  /** Whether this kind of document is expected to produce line items at all.
      A prior-year return and a client questionnaire feed the carry-forward and
      the profile; reading no line items from them is correct, not a failure. */
  feedsLineItems?: boolean;
};

/** Something the document says that the rules alone would let past. */
export type AgentImportant = {
  key: string;
  label: string;
  doc: string;
  page: number | null;
  section?: string;
  figures: string;
  /** Why the agent thinks it matters, in the preparer's words. */
  why: string;
  risk: "dropped-as-structure" | "no-rule" | "untranslated" | "ocr-flagged";
  /** Filled after mapping: was it actually used? */
  outcome?: "booked" | "unmatched" | "unused";
};

/** The agent could not do something. Never silent: every one of these reaches
    the Exception Centre and the activity view with what, where, why and what
    the preparer has to do about it. */
export type AgentFailure = {
  stage: "understand" | "translate" | "suggest" | "review";
  what: string;
  doc?: string;
  page?: number | null;
  reason: string;
  action: string;
};

/** Everything the understanding phase produced, kept on the entity so the
    activity view, the review phase and the log all read the same record. */
export type AgentBrief = {
  at: string;
  requiredYear?: number | null;
  yearSource?: "selected" | "documents" | "none";
  detectedYears?: number[];
  yearReason?: string;
  docs: DocBrief[];
  language: string;
  important: AgentImportant[];
  failures: AgentFailure[];
  notes: string[];
  steps: string[];
  translated: number;
};

export type AgentState = {
  /** "map" produces suggestions; "review" reads the booked result back. One
      graph, two entry points — the router at START picks. */
  phase: "map" | "review" | "understand";
  facts: BookFacts | null;
  docs: DocBrief[];
  important: AgentImportant[];
  failures: AgentFailure[];
  /** The year the work paper is being prepared for, so every document can be
      placed against it before anything is mapped. */
  requiredYear: number | null;
  /** Who chose that year, and every year the documents themselves state — so
      the card can show the chain rather than a bare number. */
  yearSource: "selected" | "documents" | "none";
  detectedYears: number[];
  rows: AgentRow[];
  catalogue: string;                 // the legal target list, built by the store from IS_LINES/BS_LINES
  targets: string[];                 // every valid target id, for the invalid-id check
  occupied: string[];                // lines the deterministic rules already booked
  haveModel: boolean;
  suggestions: AgentSuggestion[];
  findings: AgentFinding[];
  notes: string[];
  failure: string | null;
  considered: number;
};

export type AgentDeps = {
  /** One model request. The store passes its Groq client, so the agent uses
      the key already configured — it has no key handling of its own. */
  ask: (messages: Array<{ role: string; content: string }>, jsonMode: boolean, opts: { maxTokens: number; timeoutMs: number }) => Promise<string>;
  timeoutMs: number;
};

const amountsOf = (row: AgentRow): string => {
  const parts = (row.values || []).map((v, i) => {
    const year = row.years && row.years[i] != null ? `${row.years[i]}: ` : "";
    return `${year}${v === null || v === undefined ? "—" : v}`;
  });
  return parts.length ? parts.join(" · ") : "no figure printed";
};

export const evidenceOf = (row: AgentRow): AgentEvidence => ({
  doc: row.docName || "document",
  page: row.page ?? null,
  caption: row.label,
  english: row.english,
  section: row.section,
  amounts: amountsOf(row),
});

/** One line of evidence, in the wording the review row and the log use. */
export const citeEvidence = (e: AgentEvidence): string =>
  `${e.doc}${e.page ? ` p.${e.page}` : ""} · “${e.caption}”${e.english && e.english !== e.caption ? ` (English: ${e.english})` : ""}${e.section ? ` · under the “${e.section}” banner` : ""} · ${e.amounts}`;

const isTranslated = (row: AgentRow) => !!(row.english && row.english !== row.label);

/* ---------- the nodes ---------- */

/** Take stock of what the earlier stages cached. No network, no re-extraction:
    this is the whole point of running after OCR and translation rather than
    beside them. */
const gather = (state: AgentState) => {
  const docs = new Set(state.rows.map((r) => r.docName || "document"));
  const translated = state.rows.filter(isTranslated).length;
  return {
    notes: [
      `Agent: reviewing ${state.rows.length} caption(s) the rules could not place, from ${docs.size} cached document(s)` +
      `${translated ? ` · ${translated} already translated` : ""} — nothing is re-read or re-extracted`,
    ],
  };
};

/** Read the accounting context out of the cached evidence before asking the
    model anything: which side of the accounts the caption printed on, and
    whether it carries a figure at all. A caption with no figure cannot be
    booked however well it is understood, so it is a finding, not a mapping. */
const understand = (state: AgentState) => {
  const findings: AgentFinding[] = [];
  for (const row of state.rows) {
    const hasFigure = (row.values || []).some((v) => typeof v === "number" && isFinite(v as number));
    if (!hasFigure) {
      findings.push({
        kind: "missing", key: row.key, caption: row.label,
        message: `“${row.label}” carries no figure in the document, so there is nothing to book against it. Check whether a column was missed when the page was read.`,
        evidence: evidenceOf(row),
      });
    }
  }
  const sides = state.rows.filter((r) => r.section).length;
  return {
    findings,
    notes: [`Agent: ${sides} of ${state.rows.length} caption(s) carry a section banner that fixes which side of the accounts they belong to`],
  };
};

const SYSTEM = "You are an accountant mapping foreign statutory financial statements onto a US Form 5471 work paper. You explain your reasoning from the document, and you say when you are unsure. Reply with JSON only.";

const rowLine = (row: AgentRow, i: number, rich: boolean): string => {
  const english = isTranslated(row) ? ` | English: ${row.english}` : "";
  if (!rich) return `${i}. ${row.label}${english}${row.section ? ` [section: ${row.section}]` : ""}`;
  return `${i}. ${row.label}${english} | amounts: ${amountsOf(row)} | from: ${row.docName || "document"}${row.page ? " p." + row.page : ""}${row.docKind ? ` (${row.docKind})` : ""}${row.section ? ` | printed under the “${row.section}” banner — only map to that side` : ""}`;
};

/** Ask the model to place the captions, in two passes: captions alone first,
    then the amounts, source and banner for whatever came back unresolved or
    unsure. Batching, the per-minute token budget and every kind of retry are
    the existing `askResume` machinery — the agent does not reimplement them. */
const suggestNode = async (state: AgentState, config: RunConfig) => {
  const deps = config.configurable as unknown as AgentDeps;
  const answers = new Map<string, Proposal>();
  const notes: string[] = [];
  let failure: string | null = null;
  let considered = 0;

  const run = async (rows: AgentRow[], rich: boolean) => {
    const send = async (batch: AgentRow[]) => {
      considered += batch.length;
      const preamble = rich
        ? "These captions were not resolved on the first attempt. Use the amounts, the source document and the section banner as extra evidence, and pick the closest reasonable line — an \"Other income\" or \"Other deduction\" line is a valid answer for an item that fits nowhere else. Only use null when the caption is a subtotal, a total, or not a financial line at all.\n\n"
        : "";
      const body = batch.map((r, i) => rowLine(r, i, rich)).join("\n");
      return parseMap(await deps.ask([
        { role: "system", content: SYSTEM },
        { role: "user", content: `${preamble}Worked examples (same schema): "Creditors" -> {"t":"BS:46","c":"high","r":"trade payables"} · "Salaries and social security" -> {"t":"IS:26","c":"high","r":"personnel cost"} · "Depreciation of tangible fixed assets" -> {"t":"IS:30","c":"high","r":"depreciation"} · "Total operating costs" -> {"t":null,"c":"high","r":"subtotal"} · "Result before taxation" -> {"t":null,"c":"high","r":"subtotal"}\n\nAvailable targets:\n${state.catalogue}\n\nCaptions to place:\n${body}\n\nReturn JSON only: {"map":{"<index>":{"t":"<target id or null>","c":"high|medium|low","r":"<short reason drawn from the caption, max 12 words>"}}}. Use null for t when no target fits. c is your confidence that the mapping is correct.` },
      ], true, { maxTokens: maxTokensFor(batch.length), timeoutMs: 2 * deps.timeoutMs }));
    };
    const stopped = await askResume(
      rows, send,
      (batch, map) => batch.forEach((row, i) => {
        const p = norm1((map as Record<string, unknown>)[String(i)]);
        if (p && p.t) answers.set(row.key, p);
      }),
      (m) => notes.push(m),
    );
    if (stopped) failure = stopped.message || String(stopped);
  };

  await run(state.rows, false);
  const retry = state.rows.filter((r) => {
    const p = answers.get(r.key);
    return !p || !p.t || !aiOk(p);
  });
  if (retry.length && !failure) await run(retry, true);

  const suggestions: AgentSuggestion[] = [];
  for (const row of state.rows) {
    const p = answers.get(row.key);
    if (!p || !p.t) continue;
    suggestions.push({
      key: row.key, caption: row.label, target: p.t, confidence: p.c,
      rationale: p.r || "", evidence: evidenceOf(row), status: "suggested",
    });
  }
  return { suggestions, notes, failure, considered };
};

/** Check the translated captions against the mapping the agent just proposed.
    Translation happens before the agent, so a caption that reached the wrong
    English word reaches the wrong line — and the mistake is invisible on the
    face of the work paper. Findings only: nothing here changes a mapping. */
const terminologyNode = async (state: AgentState, config: RunConfig) => {
  const deps = config.configurable as unknown as AgentDeps;
  const rows = state.rows.filter(isTranslated);
  const byKey = new Map(state.suggestions.map((s) => [s.key, s]));
  const body = rows.map((r, i) => {
    const s = byKey.get(r.key);
    return `${i}. original: ${r.label} | English used: ${r.english} | proposed line: ${s?.target ? s.target : "none"}`;
  }).join("\n");

  const findings: AgentFinding[] = [];
  try {
    const raw = await deps.ask([
      { role: "system", content: SYSTEM },
      { role: "user", content: `Each line below is a financial-statement caption, the English translation this tool is using, and the work paper line proposed for it.\n\n${body}\n\nFlag only entries where the English is wrong for accounting purposes, is ambiguous, or uses a term inconsistent with the others in the list. Return JSON only: {"map":{"<index>":{"t":"<better English term, or null if the English is fine>","c":"high|medium|low","r":"<what is wrong, max 16 words>"}}}. Return an empty map when every translation is sound.` },
    ], true, { maxTokens: maxTokensFor(rows.length), timeoutMs: 2 * deps.timeoutMs });
    const map = parseMap(raw);
    rows.forEach((row, i) => {
      const p = norm1((map as Record<string, unknown>)[String(i)]);
      if (!p || !p.t || !p.r) return;
      findings.push({
        kind: "terminology", key: row.key, caption: row.label,
        message: `“${row.label}” is being read as “${row.english}”. The agent reads it as “${p.t}” — ${p.r}. Check the caption before the line is relied on; the figure itself is unchanged.`,
        evidence: evidenceOf(row),
      });
    });
  } catch (err) {
    return { notes: [`Agent: the terminology check did not run — ${(err as Error)?.message || String(err)}`] };
  }
  return {
    findings,
    notes: [`Agent: checked the English of ${rows.length} translated caption(s)${findings.length ? ` · ${findings.length} queried` : " · all consistent"}`],
  };
};

/** Everything the agent can tell WITHOUT the model: two captions sent to one
    line, a line the rules already filled, an id that does not exist, and an
    answer the model itself was unsure of. Deterministic, so it runs whether or
    not a key is configured. */
const critique = (state: AgentState) => {
  const findings: AgentFinding[] = [];
  const valid = new Set(state.targets);
  const occupied = new Set(state.occupied);
  const perTarget = new Map<string, AgentSuggestion[]>();
  for (const s of state.suggestions) {
    if (!s.target) continue;
    (perTarget.get(s.target) || perTarget.set(s.target, []).get(s.target)!).push(s);
  }

  for (const s of state.suggestions) {
    if (!s.target) continue;
    if (!valid.has(s.target)) {
      findings.push({
        kind: "conflict", key: s.key, caption: s.caption,
        message: `The agent named a work paper line that does not exist (${s.target}) for “${s.caption}”. Assign it yourself on Mapping & adjustments.`,
        evidence: s.evidence,
      });
      continue;
    }
    const sharing = perTarget.get(s.target) || [];
    if (sharing.length > 1) {
      findings.push({
        kind: "conflict", key: s.key, caption: s.caption,
        message: `${sharing.length} captions were proposed for the same line (${s.target}): ${sharing.map((x) => `“${x.caption}”`).join(", ")}. They may all belong there, or one may be a subtotal of the others — confirm before filing.`,
        evidence: s.evidence,
      });
    }
    if (occupied.has(s.target) && s.confidence !== "high") {
      findings.push({
        kind: "ambiguous", key: s.key, caption: s.caption,
        message: `“${s.caption}” would be added to ${s.target}, which the mapping rules already filled from another caption. The agent is only ${s.confidence}ly confident — check the line is not double-counted.`,
        evidence: s.evidence,
      });
    }
    if (s.confidence === "low") {
      findings.push({
        kind: "ambiguous", key: s.key, caption: s.caption,
        message: `“${s.caption}” could not be placed with confidence${s.rationale ? ` — the agent's reading was: ${s.rationale}` : ""}. It is left for you to assign on Mapping & adjustments.`,
        evidence: s.evidence,
      });
    }
  }
  return { findings };
};

/** The last node decides what leaves the agent, and nothing here books
    anything: `accepted` means "worth offering to the mapping gate", which
    then applies its own rules, and `exception` means "goes to the Review /
    Exception Centre with its evidence". A low-confidence answer is never
    offered — an unplaced caption the preparer can see beats a placed one
    nobody checked. */
const route = (state: AgentState) => {
  const conflicted = new Set(state.findings.filter((f) => f.kind === "conflict" && f.key).map((f) => f.key!));
  const suggestions = state.suggestions.map((s): AgentSuggestion => {
    if (!s.target) return { ...s, status: "exception", issue: "the agent could not name a line for it" };
    if (conflicted.has(s.key)) return { ...s, status: "exception", issue: "the agent's answer conflicts with another caption or with the line catalogue" };
    if (s.confidence === "low") return { ...s, status: "exception", issue: "the agent was not confident enough to offer it" };
    return { ...s, status: "accepted" };
  });
  const accepted = suggestions.filter((s) => s.status === "accepted").length;
  return {
    suggestions: suggestions as AgentSuggestion[],
    notes: [`Agent: ${accepted} suggestion(s) offered to the 5471 mapping rules · ${suggestions.length - accepted} sent to Review & exceptions · ${state.findings.length} finding(s) raised`],
  };
};

/* ---------- the understanding phase, before any mapping ---------- */

/* A caption that names a period, a total or a note reference is structure; one
   that names money is data. These decide what the agent calls IMPORTANT, and
   they are deliberately conservative: a false alarm costs the preparer a look,
   a missed one is a figure nobody ever sees. */
const TOTAL_LIKE = /^(total|sub-?total|net|gross|balance)\b|^\s*total\b/i;

const figuresText = (row: AgentRow) => amountsOf(row);

/** Read the shape of the documents before anything is mapped. Deterministic
    and free: kinds, pages, languages, how much of each document carried a
    figure, and how much the structure pass dropped. */
const survey = (state: AgentState) => {
  const docs = state.docs;
  const langs = new Map<string, number>();
  for (const d of docs) langs.set(d.language, (langs.get(d.language) || 0) + d.rowsRead);
  const language = [...langs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "English";
  const notes = [
    `Agent: read ${docs.length} document(s) before mapping — ${docs.map((d) => `${d.name} (${d.kind}, ${d.pages} page(s), ${d.rowsWithFigures} figure(s)${d.rowsDropped ? `, ${d.rowsDropped} dropped as structure` : ""}${d.ocr ? ", OCR" : ""})`).join("; ")}`,
    `Agent: document language read as ${language}`,
  ];
  const failures: AgentFailure[] = [];
  for (const d of docs) {
    if (d.rowsRead === 0 && d.feedsLineItems) {
      failures.push({
        stage: "understand", what: `${d.name} produced no readable line items`, doc: d.name,
        reason: d.ocr ? "the page was recognised by OCR but no caption/figure pairs came out of it" : "no caption/figure pairs could be read from any page",
        action: "Open the document and check it is the right file; if it is a scan, run it through the OCR card on the Documents tab.",
      });
    }
  }
  return { docs, notes, failures };
};

/** The tax-year check, before anything is mapped.
 *
 * A work paper is for ONE year. A document that reports on another year is
 * either the prior-year input the carry-forward needs, or it is reference
 * material — and using it as this year's figures is the error nobody sees on
 * the face of the work paper. Every document is placed against the year the
 * work paper is being prepared for, and one that cannot be placed is said so
 * rather than used.
 */
const yearCheck = (state: AgentState) => {
  const required = state.requiredYear;
  const failures: AgentFailure[] = [];
  const docs = state.docs.map((d): DocBrief => {
    if (!d.feedsLineItems && d.kind !== "prior-year-us-return") {
      return { ...d, role: "reference", supportsYear: required, match: "unchecked" };
    }
    if (d.kind === "prior-year-us-return") {
      const ok = required !== null && d.statementYear === required - 1;
      if (d.statementYear === null) {
        failures.push({
          stage: "understand", what: `the year of ${d.name} could not be read`, doc: d.name,
          reason: "the return does not state a year the reader could find, so the opening balances it carries cannot be placed",
          action: "Open the return, check which year it is for, and confirm the opening figures on Schedule F before generating.",
        });
      } else if (required !== null && !ok) {
        failures.push({
          stage: "understand", what: `${d.name} is a ${d.statementYear} return, but this work paper opens ${required - 1}`,
          doc: d.name,
          reason: `the opening column of a ${required} work paper is the close of ${required - 1}; this return closes at the end of ${d.statementYear}`,
          action: `Supply the ${required - 1} Form 5471, or enter the opening figures yourself. Nothing was carried forward from it.`,
        });
      }
      return {
        ...d, role: "prior-year-input", supportsYear: required,
        match: d.statementYear === null ? "unclear" : ok ? "match" : "mismatch",
      };
    }
    if (d.statementYear === null) {
      failures.push({
        stage: "understand", what: `the year of ${d.name} could not be read`, doc: d.name,
        reason: "no heading on it states a year or a period end, so which work paper year it belongs to is unknown",
        action: "Check the document's own heading. If it is this year's, its figures are being mapped on the strength of the other documents alone — confirm them.",
      });
      return { ...d, role: "unclear", supportsYear: null, match: "unclear" };
    }
    if (required === null) return { ...d, role: "current-year", supportsYear: d.statementYear, match: "unchecked" };
    if (d.statementYear === required) return { ...d, role: "current-year", supportsYear: required, match: "match" };
    if (d.statementYear === required - 1) return { ...d, role: "prior-year-input", supportsYear: required, match: "match" };
    /* A document one year AHEAD is not a stray: a set of accounts always
       prints the year before beside its own, so next year's statements are
       where this year's closing column comes from. Only that column is used,
       and saying "remove it" would throw away the evidence. */
    if (d.statementYear === required + 1) {
      return { ...d, role: "comparative", supportsYear: required, match: "match" };
    }
    failures.push({
      stage: "understand", what: `${d.name} reports on ${d.statementYear}, not ${required}`, doc: d.name,
      reason: `this work paper is for ${required}; a ${d.statementYear} document is neither the current year nor the prior year it opens from`,
      action: "Remove it, or set the engagement year to the year its figures belong to. Its figures are otherwise mapped into the wrong year.",
    });
    return { ...d, role: "reference", supportsYear: d.statementYear, match: "mismatch" };
  });

  /* The opening column has to come from somewhere. When nothing in the pile
     reports on the year before the one being prepared, the work paper opens
     blank — and that is a fact about the evidence, not an error to hide. */
  if (required !== null && !docs.some((d) => d.role === "prior-year-input")) {
    failures.push({
      stage: "understand",
      what: `no document covers ${required - 1}, the year this work paper opens from`,
      reason: `the opening column of a ${required} work paper is the close of ${required - 1}; nothing here reports on it`,
      action: `Add the ${required - 1} Form 5471 or the ${required - 1} statements, or enter the opening balances by hand. Schedule F and Schedule J open blank without them.`,
    });
  }

  const mism = docs.filter((d) => d.match === "mismatch" || d.match === "unclear").length;
  return {
    docs, failures,
    notes: [required
      ? `Agent: tax year check — documents report ${state.detectedYears.length ? state.detectedYears.join(", ") : "no year"}; work paper year ${required} (${state.yearSource === "selected" ? "you chose it" : "from the documents"}); current ${required}, prior ${required - 1}. ${docs.filter((d) => d.match === "match").length} document(s) match, ${mism} need a decision`
      : "Agent: tax year check — no year could be established from the documents, so nothing was placed against one"],
  };
};

/** Pick out what the rules alone would let past. Four risks, each named, each
    with its page and figures attached. Nothing is guessed here — a risk is a
    statement about what the pipeline will do, not about what the caption
    means. */
const spotlight = (state: AgentState) => {
  const important: AgentImportant[] = [];
  const add = (row: AgentRow, risk: AgentImportant["risk"], why: string) => {
    if (important.some((x) => x.key === row.key && x.risk === risk)) return;
    important.push({
      key: row.key, label: row.label, doc: row.docName || "document", page: row.page ?? null,
      section: row.section, figures: figuresText(row), why, risk,
    });
  };
  for (const row of state.rows) {
    const hasFigure = (row.values || []).some((v) => typeof v === "number" && isFinite(v as number));
    if (!hasFigure) continue;
    if (row.dropped) {
      /* Dropped by the arithmetic, not by its name. A real subtotal says so;
         this one only happened to equal the rows above it. */
      if (!TOTAL_LIKE.test(row.label)) {
        add(row, "dropped-as-structure",
          `dropped before mapping as ${row.dropped}, although the caption does not name itself a total`);
      }
      continue;
    }
    if (row.ruleMatched === false && !row.section) {
      add(row, "no-rule", "no keyword rule claims it and it carries no section heading, so nothing will place it");
    }
    if (!row.english && /[^\u0000-\u024F]/.test(row.label)) {
      add(row, "untranslated", "the caption is not in the Latin alphabet and no translation was available");
    }
  }
  return {
    important,
    notes: [important.length
      ? `Agent: ${important.length} item(s) carry a figure and are at risk of being missed — ${[...new Set(important.map((i) => i.risk))].join(", ")}`
      : "Agent: every figure read has either a rule or a section heading to place it"],
  };
};

/** Ask the model what the spotlighted items mean. It never books anything —
    the answer becomes the "why" the preparer reads, and an answer the model is
    unsure of becomes a FAILURE rather than a guess. */
const interpret = async (state: AgentState, config: RunConfig) => {
  const deps = config.configurable as unknown as AgentDeps;
  const items = state.important;
  const failures: AgentFailure[] = [];
  const answers = new Map<string, Proposal>();
  const notes: string[] = [];

  const send = async (batch: AgentImportant[]) => parseMap(await deps.ask([
    { role: "system", content: SYSTEM },
    { role: "user", content: `Each line is a caption read from a set of financial statements, with the figures beside it and the heading it printed under. Say what each one IS in accounting terms and whether it belongs on a US Form 5471 work paper.\n\n${batch.map((x, i) => `${i}. ${x.label} | figures: ${x.figures}${x.section ? ` | under "${x.section}"` : ""} | from ${x.doc}${x.page ? " p." + x.page : ""}`).join("\n")}\n\nReturn JSON only: {"map":{"<index>":{"t":"<what it is, 3-8 words>","c":"high|medium|low","r":"<why it matters, max 14 words>"}}}. Use c:"low" when the caption is not enough to tell — do not guess.` },
  ], true, { maxTokens: maxTokensFor(batch.length), timeoutMs: 2 * deps.timeoutMs }));

  const stopped = await askResume(
    items, send,
    (batch, map) => batch.forEach((x, i) => {
      const p = norm1((map as Record<string, unknown>)[String(i)]);
      if (p && p.t) answers.set(x.key, p);
    }),
    (m) => notes.push(m),
  );
  if (stopped) {
    failures.push({
      stage: "understand", what: `${items.length} item(s) could not be interpreted`,
      reason: stopped.message || String(stopped),
      action: "Check the AI key and connection on Settings ▸ AI platform, then re-process. The items are listed below and can be mapped by hand meanwhile.",
    });
  }

  const enriched = items.map((item): AgentImportant => {
    const p = answers.get(item.key);
    if (!p || !p.t) return item;
    if (!aiOk(p)) {
      failures.push({
        stage: "understand", what: `“${item.label}” could not be understood with confidence`,
        doc: item.doc, page: item.page,
        reason: p.r ? `the agent read it as “${p.t}” but was not sure — ${p.r}` : "the caption alone was not enough to tell what it is",
        action: "Open the page and decide the line yourself on Mapping & adjustments.",
      });
      return item;
    }
    return { ...item, why: `${p.t}${p.r ? ` — ${p.r}` : ""}; ${item.why}` };
  });

  return { important: enriched, failures, notes };
};

/** Close the understanding phase. */
const handoff = (state: AgentState) => ({
  notes: [`Agent: handing ${state.important.length} item(s) to the 5471 rules as worth considering${state.failures.length ? ` · ${state.failures.length} thing(s) it could not resolve` : ""}`],
});

/* ---------- the review phase ---------- */

/* Which captions belong on the lines a set of accounts cannot be without.
   Deliberately narrow: these are the words that name the line itself, not
   every caption that could land on it. A false alarm here costs the preparer
   a look at a line that is fine; a missed one ships a balance sheet with no
   cash on it. */
const CASH_WORDS = /\b(cash|bank|petty cash|efectivo|caja|bancos|tr[ée]sorerie|liquide|kas)\b/i;
const FIXED_WORDS = /\b(fixed asset|property,? plant|plant and equipment|motor vehicle|machinery|equipment|leasehold improvement|furniture|immobilisation|inmovilizado|anlageverm)/i;
const DEPN_WORDS = /accumulated (?:depreciation|amortisation|amortization)|depr\.? acumulada|amortissements cumul/i;
const EQUITY_WORDS = /\b(retained earning|accumulated (?:profit|loss)|share capital|common stock|paid-?in|capital surplus|reserve|current account|owner'?s? equity|members? equity)\b/i;

const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
const figuresOf = (row: AgentRow): number[] =>
  (row.values || []).filter((v): v is number => typeof v === "number" && isFinite(v));

/** Captions from `rows` whose figures account for `gap`. Naming them turns
    "out by 44,660.64" into something the preparer can act on in one move.
 *
 * Searched smallest-first — one caption, then two, then any subset — because a
 * whole group can go missing at once: a bank heading with four accounts under
 * it, or a fixed-asset register. The subset search is bounded at 12 captions
 * (4,096 combinations) so a page full of leftovers cannot hang the tab.
 */
function explainGap(gap: number, rows: AgentRow[]): AgentRow[] {
  const target = Math.abs(gap);
  for (const row of rows) {
    if (figuresOf(row).some((v) => near(Math.abs(v), target))) return [row];
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = figuresOf(rows[i]), b = figuresOf(rows[j]);
      for (const x of a) for (const y of b) if (near(Math.abs(x + y), target)) return [rows[i], rows[j]];
    }
  }
  /* Each caption contributes its LAST figure — the current-year column — so a
     row carrying two years is not counted twice. */
  const pool = rows.map((r) => ({ row: r, v: figuresOf(r).slice(-1)[0] })).filter((p) => typeof p.v === "number");
  if (pool.length > 12 || pool.length < 3) return [];
  for (let mask = 1; mask < (1 << pool.length); mask++) {
    let sum = 0, count = 0;
    for (let i = 0; i < pool.length; i++) if (mask & (1 << i)) { sum += pool[i].v; count++; }
    if (count < 3) continue;
    if (near(Math.abs(sum), target)) return pool.filter((_, i) => mask & (1 << i)).map((p) => p.row);
  }
  return [];
}

/**
 * Read the booked result back and say what is missing.
 *
 * This is the half of the agent that needed no model and that the preparer
 * feels first: a balance sheet with no cash line, fixed assets carried at
 * cost with no accumulated depreciation, equity that does not tie, a period
 * end nobody's document actually states. Each finding names the caption or
 * the figure behind it, so it can be fixed in one move rather than hunted.
 */
const reconcile = (state: AgentState) => {
  const f = state.facts;
  if (!f) return {};
  const findings: AgentFinding[] = [];
  const filled = new Set(f.filled);
  const leftovers = state.rows;
  const cite = (row: AgentRow) => evidenceOf(row);

  /* ---- the period the work paper is filed for ---- */
  if (f.cyEnd && /assumed/i.test(f.cyEndSource || "")) {
    findings.push({
      kind: "period",
      message: `The period end ${f.cyEnd} was assumed, not read: no document in this entity states one. The year end picks the exchange-rate tables and dates Schedules E and J, so a fiscal entity dated 31 December is wrong throughout. Check Basic Information B1 and B2 before generating.`,
    });
  } else if (f.cyEnd && /rolled forward/i.test(f.cyEndSource || "")) {
    findings.push({
      kind: "period",
      message: `The period end ${f.cyEnd} was rolled forward from last year's return, not read from this year's documents — no set of accounts here prints a period end. It is the right shape for this entity, but confirm the year is the one you are filing.`,
    });
  }
  if (f.statementPeriodEnd && f.cyEnd && f.statementPeriodEnd.slice(0, 5) !== f.cyEnd.slice(0, 5)) {
    findings.push({
      kind: "period",
      message: `Basic Information gives the period end as ${f.cyEnd}, but ${f.statementDoc || "the statements"} prints “${f.statementPeriodEnd}”. One of the two is not this period.`,
    });
  }

  /* ---- lines a set of accounts cannot be without ---- */
  const hasAssets = [...filled].some((t) => /^BS:(1[0-9]|2\d|3\d|4[01])$/.test(t));
  if (hasAssets && !filled.has("BS:10")) {
    const cashRows = leftovers.filter((r) => CASH_WORDS.test(r.label) || CASH_WORDS.test(r.english || ""));
    findings.push({
      kind: "balance",
      key: cashRows[0]?.key, caption: cashRows[0]?.label,
      message: cashRows.length
        ? `Schedule F line 1 (Cash) is empty, but ${cashRows.map((r) => `“${r.label}”`).join(", ")} ${cashRows.length === 1 ? "was read from the documents and never booked" : "were read from the documents and never booked"}. Cash almost always exists where there are other assets — assign it on Mapping & adjustments.`
        : `Schedule F line 1 (Cash) is empty although other assets were booked. Either the balance sheet has no cash, or its cash caption was read as part of a heading and never became a line of its own.`,
      evidence: cashRows[0] ? cite(cashRows[0]) : undefined,
    });
  }

  const fixedRows = leftovers.filter((r) => FIXED_WORDS.test(r.label) || FIXED_WORDS.test(r.english || ""));
  if (!filled.has("BS:28") && fixedRows.length) {
    findings.push({
      kind: "balance", key: fixedRows[0].key, caption: fixedRows[0].label,
      message: `Schedule F line 9a (Buildings and other depreciable assets) is empty, but ${fixedRows.map((r) => `“${r.label}”`).join(", ")} ${fixedRows.length === 1 ? "is" : "are"} unbooked. Fixed assets belong on 9a at cost with the accumulated depreciation on 9b.`,
      evidence: cite(fixedRows[0]),
    });
  } else if (filled.has("BS:28") && !filled.has("BS:29")) {
    const depnRows = leftovers.filter((r) => DEPN_WORDS.test(r.label) || DEPN_WORDS.test(r.english || ""));
    findings.push({
      kind: "balance", key: depnRows[0]?.key, caption: depnRows[0]?.label,
      message: `Fixed assets are on Schedule F line 9a but line 9b (accumulated depreciation) is empty.${depnRows.length ? ` “${depnRows[0].label}” was read and not booked.` : " Either the assets are carried at net book value — in which case 9a overstates cost — or the depreciation column was missed."}`,
      evidence: depnRows[0] ? cite(depnRows[0]) : undefined,
    });
  }

  /* ---- does it balance, and what would fix it ---- */
  const gap = Math.round((f.assetsEoy - f.liabEquityEoy) * 100) / 100;
  if (Math.abs(gap) >= 0.01) {
    const culprits = explainGap(gap, leftovers);
    const equityRows = leftovers.filter((r) => EQUITY_WORDS.test(r.label) || EQUITY_WORDS.test(r.english || ""));
    findings.push({
      kind: "balance",
      key: culprits[0]?.key, caption: culprits[0]?.label,
      message: `The balance sheet is out by ${gap.toLocaleString("en-US")}: assets ${f.assetsEoy.toLocaleString("en-US")} against liabilities and equity ${f.liabEquityEoy.toLocaleString("en-US")} (equity ${f.equityEoy.toLocaleString("en-US")}).` +
        (culprits.length
          ? ` ${culprits.map((r) => `“${r.label}”`).join(" and ")} ${culprits.length === 1 ? "was" : "were"} read from the documents and never booked, and ${culprits.length === 1 ? "its figure matches" : "their figures together match"} the difference exactly — book ${culprits.length === 1 ? "it" : "them"} and the balance sheet ties.`
          : equityRows.length
            ? ` ${equityRows.map((r) => `“${r.label}”`).join(", ")} sits unbooked on the equity side and is the first place to look.`
            : ` No unbooked caption accounts for it, so a figure has been booked twice or a line carries the wrong sign — check the contributions on each balance-sheet line.`),
      evidence: culprits[0] ? cite(culprits[0]) : equityRows[0] ? cite(equityRows[0]) : undefined,
    });
  }

  /* ---- was what mattered actually used? ---- */
  const booked = new Set(f.bookedKeys || []);
  const seen = new Set(f.unmatchedKeys || []);
  const closed: AgentImportant[] = (f.important || []).map((item) => {
    const outcome: AgentImportant["outcome"] = booked.has(item.key) ? "booked" : seen.has(item.key) ? "unmatched" : "unused";
    if (outcome === "unused") {
      findings.push({
        kind: "unused", key: item.key, caption: item.label,
        message: `“${item.label}” was read from ${item.doc}${item.page ? ` p.${item.page}` : ""} (${item.figures}) and the agent flagged it before mapping — ${item.why} — but it reached neither a work paper line nor the Review tab. Nothing in the run explains where it went.`,
      });
    }
    return { ...item, outcome };
  });

  /* ---- and everything the agent could not do ---- */
  for (const fail of f.failures || []) {
    findings.push({
      kind: "failure",
      message: `Agent failed at the ${fail.stage} step — ${fail.what}${fail.doc ? ` (${fail.doc}${fail.page ? ` p.${fail.page}` : ""})` : ""}. Reason: ${fail.reason}. What to do: ${fail.action}`,
    });
  }

  return {
    findings,
    important: closed,
    notes: [
      `Agent: reviewed the booked balance sheet — ${findings.length ? `${findings.length} finding(s)` : "no gaps found"}`,
      ...(f.important && f.important.length
        ? [`Agent: of ${f.important.length} item(s) it flagged before mapping, ${closed.filter((i) => i.outcome === "booked").length} were booked, ${closed.filter((i) => i.outcome === "unmatched").length} are in Review, ${closed.filter((i) => i.outcome === "unused").length} unaccounted for`]
        : []),
    ],
  };
};

/* ---------- the graph ---------- */

export function buildAgent() {
  const graph = new StateGraph<AgentState>({
    channels: {
      phase: last<"map" | "review" | "understand">("map"),
      facts: last<BookFacts | null>(null),
      docs: last<DocBrief[]>([]),
      requiredYear: last<number | null>(null),
      yearSource: last<"selected" | "documents" | "none">("documents"),
      detectedYears: last<number[]>([]),
      important: last<AgentImportant[]>([]),
      failures: append<AgentFailure>(),
      rows: last<AgentRow[]>([]),
      catalogue: last(""),
      targets: last<string[]>([]),
      occupied: last<string[]>([]),
      haveModel: last(false),
      /* `route` rewrites the list it was given rather than adding to it, so
         suggestions are last-write; findings and notes accumulate. */
      suggestions: last<AgentSuggestion[]>([]),
      findings: append<AgentFinding>(),
      notes: append<string>(),
      failure: last<string | null>(null),
      considered: { value: (a, b) => (a || 0) + (b || 0), default: () => 0 },
    },
  });

  graph.addNode("gather", gather);
  graph.addNode("understand", understand);
  graph.addNode("suggest", suggestNode);
  graph.addNode("terminology", terminologyNode);
  graph.addNode("critique", critique);
  graph.addNode("route", route);
  graph.addNode("reconcile", reconcile);
  graph.addNode("survey", survey);
  graph.addNode("yearCheck", yearCheck);
  graph.addNode("spotlight", spotlight);
  graph.addNode("interpret", interpret);
  graph.addNode("handoff", handoff);

  /* One graph, two entry points. The mapping phase runs before anything is
     booked; the review phase runs after, when there is a balance sheet to
     read back. Both produce findings in the same shape. */
  graph.addConditionalEdges(
    START,
    (s) => (s.phase === "review" ? "review" : s.phase === "understand" ? "understand" : "map"),
    { review: "reconcile", understand: "survey", map: "gather" },
  );
  graph.addEdge("reconcile", END);
  graph.addEdge("survey", "yearCheck");
  graph.addEdge("yearCheck", "spotlight");
  graph.addConditionalEdges(
    "spotlight",
    (s) => (s.haveModel && s.important.length ? "model" : "plain"),
    { model: "interpret", plain: "handoff" },
  );
  graph.addEdge("interpret", "handoff");
  graph.addEdge("handoff", END);
  graph.addEdge("gather", "understand");
  /* No key, or nothing left to place: the deterministic half of the agent
     still runs, so a key-less deployment gets the gap findings. */
  graph.addConditionalEdges(
    "understand",
    (s) => (s.haveModel && s.rows.length ? "model" : "offline"),
    { model: "suggest", offline: "critique" },
  );
  graph.addConditionalEdges(
    "suggest",
    (s) => (!s.failure && s.rows.some(isTranslated) ? "translated" : "plain"),
    { translated: "terminology", plain: "critique" },
  );
  graph.addEdge("terminology", "critique");
  graph.addEdge("critique", "route");
  graph.addEdge("route", END);
  return graph;
}

export const AGENT_GRAPH = buildAgent().describe();

/** Run the agent over one entity's leftovers. The store passes the model
    client; this function never touches the store, the network or the DOM
    directly. */
export async function runAgent(
  input: {
    rows: AgentRow[]; catalogue?: string; targets?: string[]; occupied?: string[]; haveModel?: boolean;
    phase?: "map" | "review" | "understand"; facts?: BookFacts | null;
    docs?: DocBrief[]; important?: AgentImportant[]; requiredYear?: number | null;
    yearSource?: "selected" | "documents" | "none"; detectedYears?: number[];
  },
  deps: AgentDeps,
  onStep?: (note: { node: string; ms: number }) => void,
): Promise<AgentState> {
  const app = buildAgent().compile();
  return app.invoke(input, { configurable: deps as unknown as Record<string, unknown>, onStep, recursionLimit: 12 });
}
