"use client";

import {
  BS_LINES, CATEGORY_CELLS, DEFAULT_RULES, DEMO_RELABELS, FORMULA_REFS, FX_FIELDS, IS_LINES, REPLACEABLE_FORMULA_REFS,
  OWNERSHIP_FIELDS, POOLS, PROFILE_FIELDS, SHEET,
  detectRulers, resolveWordRulers, inheritRulers, detectPeriodRulers, explainUnreadable, isProcessorFee, splitSidePanels, extractPositionedRows, extractRows, fixedAssetSplit, movementFixedAssetSplit, matchRule, matchRuleScoped, noteLookthrough, numeric, numericCell, readDocument, signForLabel, stackedCaptionRows, statementNotes, boxedFormCodes, boxedFormSpec, isTaxRegisterCaption,
  type ExtractedRow, type MappingRule, type ParsedDoc,
} from "./engine";
import { r2, r2add, sanitize } from "./hygiene";
import { pdfToDoc } from "./pdfText";
import { parseQuestionnaire, type Questionnaire } from "./questionnaire";
import { irsCountryCode } from "./countryCodes";
import { entityInsights, summarizeReview, fileSignature, type ChoiceMemory } from "./insights";
import { DETAIL_PNL_TITLE, bsSide, isProfitLine, isResultSubtotal, supplementaryDetailPages, collapsedRoute, collapsedSections, contraRevenueFlip, deductionMagnitudeFlip, dropFurniture, dropMovementSchedules, equityOverride, expenseGainFlip, gridStructRows, outsidePrintedTotal, refeedBySection, sameIndentSubtotals, sectionOk, sectionRoute, structRows, tagSections, tagStatementGroups, type MapRow, type Section } from "./sections";
import { asOfLabel, fxTag, providerTag, requireIso, toIsoLoose, yearBefore } from "./fxDates";
import {
  AI_BATCH, TPM_BUDGET, aiMode, askResume, classifyFailure, estTokens, maxTokensFor,
  norm1, ok as aiOk, parseMap, retryAfterMs, sleep, tpmCorrectLast, tpmNote, tpmWaitMs,
  type AiError, type AiMode, type Proposal,
} from "./aiMapping";
import {
  AGENT_CAN, AGENT_CANNOT, AGENT_FRAMEWORK, AGENT_GRAPH, AGENT_NAME, AGENT_PROVIDER,
  citeEvidence, runAgent,
  type AgentBrief,
  type CaseContext, type AgentFailure, type AgentImportant, type AgentRow, type AgentSuggestion, type DocBrief,
} from "./agent";
import { sessionSnapshot } from "../session";
import { apiBase } from "../api";
import {
  classifyParsedDoc, deriveCaseYears, entitySimilarity, markDuplicates, pagesForFeed, periodMinusOneYear,
  type DocClass, type DocKind,
} from "./classify";
import { addressLines, directoryDirectors, directoryShareholders, extractCarryForwards, naicsDescription, samePerson, type CarryForward, type DirectoryHolder } from "./carryForward";

/** One 5471 block's carry-forward, tagged with its origin for selection,
    cross-document dedupe and sibling fan-out. */
type CfCandidate = {
  cf: CarryForward;
  source: string;       // file name
  fileId: string;
  blockIndex: number;
  pageCount: number;
  cfcName: string;      // block-level name first, face-parsed second ("" = unidentified)
  refIds: string[];
  statementYear: number | null;   // the year the source return reports on
};

/** Leading month of a "MM/DD/YYYY" or "M/D/YY" period string. */
export function monthFromPeriod(p?: string): number | null {
  const m = /^(\d{1,2})[-/]/.exec((p || "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 12 ? n : null;
}

/** A period end whose month is not December is a fiscal year — the published
    calendar-year rate tables (IRS average, Treasury 12/31 spot) do not apply. */
export const isFiscalPeriod = (p?: string): boolean => {
  const m = monthFromPeriod(p);
  return m !== null && m !== 12;
};

/** "06/30/2023" → "06/30/23" — the profile's placeholder style. */
function shortPeriod(p: string): string {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec((p || "").trim());
  if (!m) return p;
  const yy = m[3].length === 4 ? m[3].slice(2) : m[3];
  return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${yy}`;
}

function periodPlusOneYear(p: string): string | null {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec((p || "").trim());
  if (!m) return null;
  return `${m[1]}/${m[2]}/${Number(m[3]) + 1}`;
}

/** Exact day count of the period (pyEnd, cyEnd] — fiscal years cross a
    calendar boundary, so daysInYear(caseYear) would miscount leap years. */
function daysBetweenPeriods(from?: string, to?: string): number | null {
  const parse = (p?: string): Date | null => {
    const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec((p || "").trim());
    if (!m) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(Date.UTC(y, Number(m[1]) - 1, Number(m[2])));
  };
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return null;
  const days = Math.round((b.getTime() - a.getTime()) / 86400000);
  return days > 0 && days < 400 ? days : null;
}
import { summarizeLedger, summarizeSalary, type LedgerSummary, type SalarySchedule } from "./relatedPartyLedger";
import { addWorksheet, applyWrites, resolveTemplateRows, templateBytes, type CellValue, type Writes } from "./xlsxPatch";
import { safeDownload } from "./safeBrowser";
import { applyPeg, lookupRates, peggedRate, yearFromPeriod, FX_META } from "./fxRates";
import { seedRateDb, type RateDb } from "./rateDb";
import { PROVIDERS, fetchLiveRate, fxCurrencyApiAverage, fxFrankfurterAverage, fxOfxAverage, isMostlyNonLatin, translateFree, type LiveRate } from "./providers";
import { collectCaptionLabels, detectLanguage, bilingualLabel, displayLabel, isServiceErrorText, poisonedTranslationKeys, translateSourceCode } from "./captions";
import { translateCaption } from "./terms";
import { cleanFor, detectProfile, looksLikeDate, sniffCurrency, type DetectedField, type ProfileCandidate } from "./detectProfile";

declare const JSZip: any;

export type EntityFile = {
  id: string; name: string; size: number; parsable: boolean; blob: File;
  /** Worksheet tab names, recorded the first time a workbook is read, so the
      intake screen can offer them without re-opening the file. */
  sheetNames?: string[];
  /** SHA-256 of the bytes, or an "nk:" fallback key where the crypto API is
      unavailable. Identity for the duplicate refusal. */
  sha?: string;
  /** Present when this file's text layer was produced by OCR: which engine
      read each page, how confident it was, where every word sits, and what
      the validator or a second engine disputed. Travels with the file so
      each figure booked from it can cite its evidence. */
  ocr?: OcrSidecar;
};

/** One recognised token, box in PDF points on its page. */
export type OcrWord = { text: string; bbox: number[]; conf: number; engine: string };
/** A reading a reviewer must look at. `text` is what was kept; `alt` is what
    a second engine or the validator proposes instead — never applied. */
export type OcrFlag = {
  page: number; kind: string; level: "block" | "warn" | "info"; text: string; bbox: number[];
  conf: number; engine: string; message: string; alt?: string | null; alt_engine?: string | null; alt_conf?: number | null;
};
export type OcrPage = {
  page: number; status: string; engine?: string | null; confMean?: number | null;
  words: OcrWord[]; flags: OcrFlag[];
};
export type OcrSidecar = {
  /** Primary engine that read the pages ("paddle"), and the model behind it. */
  engine: string; backend?: string; verifyEngine?: string | null; chain?: string[];
  mode: "auto" | "manual"; source: "service" | "browser"; at: string;
  originalName: string; originalSha?: string;
  verdict: string; ocrPages: number[]; pages: OcrPage[];
  stats?: Record<string, unknown>;
};
export type LineValue = { amount?: number | null; boy?: number | null; eoy?: number | null };
export type EntityStatus = "idle" | "processing" | "ready" | "error";

/** One source row's contribution to a mapped line — full provenance. */
export type SourceLabel = { label: string; values: number[]; years?: (number | null)[] };

export type Contribution = {
  docId: string;
  docName: string;
  page?: number;
  label: string;
  value: number;
  field: "amount" | "boy" | "eoy";
  year?: number | null;
  /** "section": no keyword matched — the statement's own section heading placed it. */
  via: "rule" | "section" | "groq" | "manual";
  /** The document's original row values/years (pre-sign, pre-routing) —
      what unassign needs to reconstruct the unmatched row faithfully. */
  srcValues?: number[];
  srcYears?: (number | null)[];
  /** Period column the value came from ("本年累计数 · YTD"). */
  period?: string;
};

/** A user's standing decision about where a caption maps; survives
    re-processing because it is keyed by caption, not by run state. */
export type MapOverride = { to: string | null };   // null = force-unassign

export type PolicyMatch = { id?: string; category?: ReviewItem["category"]; message?: string; regex?: boolean };
export type PolicyAction = "keep" | "block" | "warn" | "info" | "suppress";
export type PolicyRule = { id: string; match: PolicyMatch; action: PolicyAction; note?: string };

/** A cell write outside the IS/BS/Basic maps (Schedule J, M, R, …). */
export type CellWrite = {
  sheet: string;
  ref: string;
  value: string | number;
  source?: string;                    // "2023 US return p.24 · Sch J line 14"
  reviewId?: string;
  /** Source snapshot (S-05): the document, page and the ROW TEXT the value
      was read from — the Evidence view shows it verbatim so a reviewer can
      trace every schedule figure without opening the PDF. */
  prov?: { docName: string; page?: number; rowText?: string };
  /** Re-resolve the ROW by matching this text in the label column at
      generation time — template-revision-proof (Schedule M). */
  labelKey?: { col: string; contains: string; excludes?: string };
  /** This value replaces the formula the template ships in the cell. Only
      for a cell whose formula reads a figure that does not exist for this
      entity (the Retained Earnings tab's opening, linked to Schedule F's
      opening column, when there is no opening column). */
  replaceFormula?: true;
  /** Decimal places kept when the value reaches the cell. Amounts round to
      2; an exchange rate written at 2 dp is a different rate (0.833 → 0.83). */
  dp?: number;
};

export type ReviewItem = {
  id: string;
  level: "block" | "warn" | "info";
  /* Keep in step with the policy-editor dropdown in SettingsView: a category
     the union knows but the editor does not list is a category no policy can
     ever target. "tie-out" and "entity-scope" were raised for months without
     being selectable. */
  category: "fx" | "mapping" | "carry-forward" | "related-party" | "source-gap" | "profile" | "consistency" | "process" | "tie-out" | "entity-scope";
  message: string;
  target?: string;                    // "Balance Sheet!F54"
  source?: string;
  suggestedValue?: string | number;
  /** The document caption this item quotes, kept as a field so the message can
      be re-resolved against the entity's translations when it is read. The
      message is built during processing but translation runs afterwards, so
      baking the wording in would strand the original text in the item. */
  sourceLabel?: string;
  applied?: boolean;                  // suggestion was pre-filled into a write
  dismissed?: boolean;
  dismissedNote?: string;
  /** "edited" = the reviewer changed the value and resubmitted. */
  resolution?: "signed-off" | "edited";
  editedValue?: string | number;
  priorValue?: string | number;       // pre-edit value — enables Restore
  /** Set at read time when a policy changed or would change this item. */
  policy?: { ruleId: string; from: ReviewItem["level"] };
};

export type DividendRec = {
  date: string;                       // "12/18/24"
  amountFunctional: number;
  usdPerUnit: number | null;          // Dividends!D — USD per unit (multiply)
  rateSource: "frankfurter" | "eoy-fallback" | "none";
};

/** Where one exchange rate came from, and — for a hand-typed one — the date
    it MEASURES as distinct from the date it was typed. Those two are not the
    same fact, and conflating them made a rate entered in March look like a
    March rate for a December year end. */
export type FxMeta = {
  source: string;
  asOf: string;
  /** Short provenance label: IRS, Treasury, Pegged, OFX, ECB, Live, Manual. */
  tag?: string;
  /** When a manual rate was typed (never the date it measures). */
  enteredOn?: string;
  /** True when `asOf` is the period end this rate is FOR, not a guess. */
  measured?: boolean;
  /** Average-rate note only: an estimate offered (never written) when no
      published average could be reached. */
  estimate?: number;
};

export type DocKindOverride = {
  /** Absent when only the worksheet list is pinned — classification stays
      automatic in that case. */
  kind?: DocKind;
  pageHint?: "fs-pnl" | "fs-balance-sheet";
  /** Worksheets to read from this workbook, by tab name. Set by the preparer
      when the automatic ranking picked the wrong tabs; absent means rank
      automatically. File-keyed, so removeFile prunes it for free. */
  sheets?: string[];
};

/** A direct shareholder row (Shareholding Details rows 19–26). Seeded from
    the prior 5471's Schedule B Part II; editable in the Shareholders tab. */
export type Shareholder = {
  id: string;
  name: string;
  classOfShares: string;
  boy: number;
  eoy: number;
  source?: string;
  /** Schedule B Part I column (e) — the pro rata share of Subpart F income,
      as a percentage. Only Part I states it; Part II never does. Used for the
      U.S. Shareholders block only. */
  pct?: number;
};

export type Entity = {
  id: string;
  name: string;
  open: boolean;
  files: EntityFile[];
  status: EntityStatus;
  progress: number;
  profile: Record<string, string>;
  ownership: Record<string, string>;
  categories: Record<string, boolean>;
  fx: Record<string, string>;
  /** Where each rate came from and its as-of date — shown beside the inputs. */
  fxMeta: Record<string, FxMeta>;
  fxAuto: boolean;
  /** C-01: an auto-DETECTED functional currency must be confirmed by the
      preparer before the workbook can generate; manual entry confirms. */
  currencyConfirmed: boolean;
  /* The prior return names a different foreign corporation from the
     statements. Set during processing, cleared by confirmLegalName; while it
     is set, generation blocks. `sameEntity` records the preparer's answer so
     the next run can adopt (or keep refusing) the carry-forward instead of
     asking again. */
  nameMismatch?: { statementName: string; priorName: string; source: string } | null;
  nameDecision?: { priorName: string; sameEntity: boolean } | null;
  /** Other names the SAME company prints its papers under — the books or
      trading name on the statements when the filed return carries the legal
      name. Recorded when the preparer confirms the two are one company. */
  nameAliases?: string[];
  /** The rate the opening balance sheet was translated at, and why that one.
      Written once, read by the provenance sheet and by every cell that
      depends on the opening figures. */
  openingRate?: { rate: number; why: string; source: string } | null;
  detected: Record<string, DetectedField>;
  lines: Record<string, LineValue>;
  relabels: Record<string, string>;
  sourceLabels: Record<string, SourceLabel>;
  contributions: Record<string, Contribution[]>;
  mapOverrides: Record<string, MapOverride>;
  docClasses: Record<string, DocClass>;
  /** Manual per-document type overrides, applied on (re)processing. The
      pageHint routes a PDF's unclassified pages to one statement feed. */
  docKindOverrides: Record<string, DocKindOverride>;
  shareholders: Shareholder[];
  /** Schedule B Part I — the U.S. shareholders (direct AND indirect), which
      drive template rows 7-14. Kept separate from `shareholders` (Part II,
      the direct legal owners, rows 19-26) because the same person often
      appears in both — directly and through a trust — and merging the two
      would double-count ownership. */
  usShareholders: Shareholder[];
  /** Template sheets the preparer excluded in the Review Summary — they
      receive no writes on generation (the sheets themselves remain). */
  excludedSheets: string[];
  reviewItems: ReviewItem[];
  extraWrites: CellWrite[];
  dividends: DividendRec[];
  translations: Record<string, string>;
  /** Captions the translators could NOT handle, with the specific reason —
      shown highlighted in the evidence table; nothing is ever guessed. */
  translationFailures: Record<string, string>;
  /* `section` travels with the row so the AI pass (and the reviewer) can see
     which banner it was printed under — a proposal that contradicts it is a
     documentary contradiction, not a judgement call. */
  /** The year's result as each statement prints it — the P&L's bottom line
      (skipped as a total) and the equity line — for the tie-out check. */
  statedResults?: { label: string; value: number; docName: string; page?: number; feed: "is" | "bs" }[];
  /** The year's result as a numbered-box return states it, BEFORE income
      tax, so Schedule C can be checked against the filing. */
  formResults?: { label: string; value: number; docName: string }[];
  unmatched: (ExtractedRow & {
    docId?: string; docName?: string; section?: Section | null;
    /** What the model proposed for this caption and why it was refused (or
        the reason before a proposal replaced it). Kept so the review row can
        show the reasoning rather than just "unmapped". */
    aiProposal?: { to: string; confidence: string; reason: string; refused?: boolean };
    originalReason?: string;
    /** The agent already read this caption. The AI mapping pass that follows
        leaves it alone rather than re-proposing what the agent deliberately
        sent to the Exception Centre. */
    agentSeen?: boolean;
  })[];
  /** Caption/value pairs from the profile pages that no matcher claimed —
      the input to the AI profile pass. */
  unmatchedProfile: ProfileCandidate[];
  log: string[];
  processedAt: string | null;
  /** What the agent understood about the documents BEFORE mapping, kept so the
      activity view, the review phase and the log all read one record. */
  agentBrief?: AgentBrief;
  /** The year end was changed after this entity was processed, so every line,
      rate and validation on it belongs to the previous year. Cleared by the
      next run. Nothing derived may be trusted, or generated, while it is set. */
  yearStale?: boolean;
};

export type GroqState = {
  key: string;
  model: string;
  status: "not configured" | "online" | "error" | "testing";
  latency: number | null;
  calls: number;
  tokens: number;
  lastError: string;
  /** Whether the automatic mapping pass runs as processing step 6. Undefined
      means "not decided", which reads as on — the pass is the default. */
  autoMap?: boolean;
  /** A transient condition worth showing WHILE it lasts (rate-limit pause,
      one failed attempt in a retry) without turning the panel red. Distinct
      from lastError, which is a state, not an event. */
  notice?: string;
  noticeAt?: number | null;
  /** True once the preparer has seen and acknowledged the panel. */
  checked?: boolean;
};

/** Settings and the last run of the AI Mapping & Review Agent. The agent has
    no credentials of its own — it uses the Groq key in `groq`. */
export type AgentSettings = {
  /** Undefined reads as on: the agent is the default path for leftovers. */
  enabled?: boolean;
  lastRun?: {
    at: string;
    entity: string;
    considered: number;
    accepted: number;
    exceptions: number;
    findings: number;
    nodes: string[];
  };
};

export type LogEvent = {
  id: string;
  at: string;
  actor: "user" | "system" | "groq";
  entity: string | null;
  action: string;
  detail: string;
};

export type ProviderUsage = {
  requests: number;
  units: number;          // characters for translators, requests for FX
  lastStatus: "idle" | "ok" | "error";
  lastError: string;
  lastLatency: number | null;
  lastUsed: string | null;
};

export type WpState = {
  stakeholder: string;
  entities: Entity[];
  activeEntityId: string | null;
  rules: MappingRule[];
  /** Catalogue generation the saved `rules` came from. A restored project
      keeps the preparer's edited rules verbatim, so without this a returning
      user would silently never receive a rule added since they last saved. */
  rulesVersion?: number;
  policies: PolicyRule[];
  rateDb: RateDb;
  groq: GroqState;
  agent: AgentSettings;
  usage: { docs: number; storage: number; api: number; generated: number };
  busy: boolean;
  providerUsage: Record<string, ProviderUsage>;
  translateOrder: string[];
  fxOrder: string[];
  quotaDay: string;
  liveRates: Record<string, LiveRate>;   // currency code -> last live quote
  events: LogEvent[];
  toast: { id: number; text: string; kind: "ok" | "bad" | "" } | null;
};

/* The models offered for the AI passes, default first. Groq retired the
   Llama 3.x and Qwen models this list used to start with; a saved project that
   still names one is moved to the default on load (loadState) and again at
   call time (groqChat), so no request is sent to a model that no longer
   exists. Mirrors dist's model list. */
export const GROQ_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
];

export const QUOTA = { aiTokens: 500000, documents: 500, storageMB: 2048, apiRequests: 5000 };
/* What the picker offers. Images are NOT here: the tool has no reader for
   them, and offering one is an invitation to attach a scan and be told
   afterwards that nothing came out of it. A scanned PDF has the OCR card. */
export const DOC_TYPES = [".xlsx", ".xlsm", ".xls", ".docx", ".csv", ".tsv", ".pdf", ".txt"];
export const NATIVE_PARSE = [".xlsx", ".xlsm", ".xls", ".docx", ".csv", ".tsv", ".txt", ".pdf"];
export const MAX_FILE_MB = 25;

export const PROCESS_STEPS = [
  "Receive and secure documents",
  "Inventory and classify",
  "Extract and normalise line items",
  "Map to work paper schedule lines",
  "Apply FX policy and validations",
  // Last, deliberately: the model only ever sees what the rules could not
  // place, so every deterministic answer is already fixed before it runs.
  "Map the remainder with AI",
];

export const uid = () => Math.random().toString(36).slice(2, 9);

export function makeEntity(name: string, stakeholder: string): Entity {
  return {
    id: uid(),
    name,
    open: true,
    files: [],
    status: "idle",
    progress: 0,
    // cyEnd/pyEnd deliberately NOT pre-seeded: the blank-only detection fill
    // must be able to take the period from the documents, and the FX-year
    // lookup depends on it. Placeholders show the expected format instead.
    profile: { clientName: stakeholder, entityShort: name },
    ownership: {},
    categories: {},
    fx: {},
    fxMeta: {},
    fxAuto: false,
    currencyConfirmed: false,
    nameMismatch: null,
    nameDecision: null,
    openingRate: null,
    detected: {},
    lines: {},
    relabels: {},
    sourceLabels: {},
    contributions: {},
    mapOverrides: {},
    docClasses: {},
    docKindOverrides: {},
    shareholders: [],
    usShareholders: [],
    excludedSheets: [],
    reviewItems: [],
    extraWrites: [],
    dividends: [],
    translations: {},
    translationFailures: {},
    unmatched: [],
    unmatchedProfile: [],
    log: [],
    processedAt: null,
  };
}

/** A note that acknowledges a blocker without explaining it. Nothing is
    refused for being thin -- the preparer may have a good reason to be brief,
    or may simply be testing -- but the Provenance sheet says so, so a reviewer
    can tell a considered acknowledgement from a keystroke. */
export const isThinNote = (note: string): boolean => {
  const said = String(note || "").trim();
  return said.length < 12 || /^(test\w*|ok(ay)?|n\/?a|none|nil|x+|\.+|-+|check(ed|ing)?|done|fine|yes|no|asdf\w*|foo|bar)$/i.test(said);
};

/** The four-digit year behind a short period like "03/31/24". */
export function yearOfShortPeriod(p: string | undefined): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(String(p || "").trim());
  if (!m) return null;
  const y = Number(m[3]);
  return m[3].length === 4 ? y : 2000 + y;
}

/** The period end one year before a short `m/d/yy` period end, or null when
    the value is not a period end. 29 February has no counterpart in a common
    year, so it steps back to the 28th rather than rolling into March. */
export function priorPeriodEnd(p: string | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(String(p || "").trim());
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const y = m[3].length === 4 ? Number(m[3]) : 2000 + Number(m[3]);
  const py = y - 1;
  const leap = (py % 4 === 0 && py % 100 !== 0) || py % 400 === 0;
  const day = mm === 2 && dd === 29 && !leap ? 28 : dd;
  return `${String(mm).padStart(2, "0")}/${String(day).padStart(2, "0")}/${String(py).slice(2)}`;
}

/* ---------------- the one controlling year ---------------- */

/** Every year the documents themselves report on, newest first. */
export const detectedYears = (ent: Entity): number[] =>
  [...new Set(Object.values(ent.docClasses || {})
    .filter((c) => !c.duplicateOf && c.statementYear)
    .map((c) => c.statementYear as number))].sort((a, b) => b - a);

/** The year the PREPARER set, or null when the year end on the profile is the
    one the tool proposed. `detected[key]` holds what was proposed, and
    `setField` deletes it the moment a value is typed over — so the two
    together are the record of who chose. */
export function selectedYear(ent: Entity): number | null {
  const typed = yearOfShortPeriod(ent.profile?.cyEnd);
  if (!typed) return null;
  const auto = ent.detected?.cyEnd;
  if (auto && auto.value === ent.profile.cyEnd) return null;
  return typed;
}

export type CaseYears = {
  cy: number | null;
  py: number | null;
  dissent: number[];
  /** Who decided: the preparer, the documents, or nobody yet. */
  source: "selected" | "documents" | "none";
  detected: number[];
  /** Set when the year is the one after the prior-year return. */
  afterPrior?: number;
};

/**
 * The year the whole run obeys.
 *
 * A work paper is prepared FOR a year; the documents are evidence about it,
 * not the choice of it. Before this, `deriveCaseYears` took the newest year
 * any document reported and that year drove column routing, carry-forward
 * selection, validation and the agent — so a set of accounts one year ahead
 * of the engagement silently became the current year, and correcting the year
 * end in Basic Information changed nothing but the date printed on the form.
 *
 * The preparer's year wins when they set one. Otherwise the documents vote,
 * exactly as before, so nothing changes for a run where nobody has typed a
 * year end.
 */
export function resolveCaseYears(ent: Entity): CaseYears {
  const seen = detectedYears(ent);
  const chosen = selectedYear(ent);
  if (chosen) {
    return { cy: chosen, py: chosen - 1, dissent: seen.filter((y) => y !== chosen), source: "selected", detected: seen };
  }
  const voted = deriveCaseYears(Object.values(ent.docClasses || {}));
  return { ...voted, source: voted.cy ? "documents" : "none", detected: seen };
}

/** One line of plain English for the log, the brief and the activity card. */
export const caseYearReason = (y: CaseYears): string =>
  y.source === "selected"
    ? `${y.cy} — you set the year end in Basic Information${y.detected.length ? `; the documents report on ${y.detected.join(", ")}` : ""}`
    : y.source === "documents" && y.afterPrior
      ? `${y.cy} — the year after the prior-year return (${y.afterPrior})${y.dissent.length ? `; the statements also report ${y.dissent.join(", ")}, which is reference only` : ""} — set the year end in Basic Information to prepare a different year`
    : y.source === "documents"
      ? `${y.cy} — taken from the documents (${y.detected.join(", ")}); set the year end in Basic Information to prepare a different year`
      : "not established — no document states a year and no year end has been entered";

/* ---------------- store ---------------- */
const initialStakeholder = "New stakeholder";

/* The mapping catalogue is versioned so a restored project can receive rules
   added since it was saved. Bump this AND add the new groups to
   RULES_ADDED_SINCE whenever DEFAULT_RULES gains a group.

   Version 2 (2026-09-09) added the six groups from the round-5 review:
   werkkostenregeling, kleinmateriaal, issued & paid-up capital, the periodic
   opening/closing stock pair and stock on hand. */
export const RULE_CATALOGUE_VERSION = 17;

/** SKIP keywords added at each version. The SKIP group already exists in
    every saved catalogue, so these are MERGED into it rather than added as a
    group — and only when absent, so a preparer who removed one stays removed
    for the version they removed it in. */
const SKIP_ADDED_SINCE: Record<number, string[]> = {
  // v3 (2026-09-10): QuickBooks/Xero/Sage closing lines booked as deductions.
  2: ["net earnings", "net earnings for the year", "net profit for the period", "net loss for the year", "net loss"],
  // v5 (2026-09-15): Chilean statement totals may end in "totales".
  4: ["ingresos totales", "gastos totales", "costos totales", "activos totales", "pasivos totales", "patrimonio total", "total activos", "total pasivos", "total gastos", "total costos", "resultado antes de impuestos"],
  // v9 (2026-09-23): how a Mexican P&L captions its bottom line.
  8: ["utilidad (o p\u00e9rdida)", "utilidad (o perdida)", "utilidad o p\u00e9rdida", "utilidad o perdida",
      "utilidad o p\u00e9rdida del ejercicio", "utilidad o perdida del ejercicio",
      "resultado integral de financiamiento", "resultado integral", "resultado neto"],
  // v11 (2026-09-28): UK (Companies Act) subtotals.
  10: ["profit for the financial year", "loss for the financial year",
       "profit on ordinary activities after taxation", "loss on ordinary activities after taxation",
       "profit on ordinary activities before taxation", "loss on ordinary activities before taxation",
       "profit after taxation", "loss after taxation", "total comprehensive income",
       "net current assets", "net current liabilities", "net current assets/(liabilities)",
       "total assets less current liabilities"],
  // v16 (2026-09-30): Dutch-style result subtotals printed in English.
  15: ["result before taxation", "result after taxation", "result before tax", "result after tax", "operating result", "gross operating result", "financial income and expenditure", "total financial income and expenditure", "result on ordinary activities", "net result"],
  // v17 (2026-10-01): Colombian (PUC) result subtotals.
  16: ["resultado bruto", "resultado operacional", "resultado antes de", "result. antes de", "resultado antes de impto", "resultado antes de corr"],
};

/** target → first keyword, for each group added at version 2. Identified by
    keyword rather than by index so reordering the catalogue is harmless. */
const RULES_ADDED_SINCE: Record<number, string[]> = {
  1: ["wkr expense", "small material", "issued & paid up capital", "opening stock", "closing stock", "stock on hand"],
  // v4 (2026-09-11): the groups written for the reconciliation test. Every one
  // of them was shipped at v3 WITHOUT being registered here, so a saved project
  // never received them — the SHORI 2024 run booked owner investments as a
  // current liability and "Taxes and Licenses" into the other-deductions pool
  // although both rules were sitting in the bundle. One fresh keyword per
  // changed group is enough: upgradeRules appends the whole group it belongs to.
  3: ["discount given", "freight", "taxes and licenses", "merchant account",
      "payroll expense", "owner investment", "owner draw"],
  // v6 (2026-09-15): Chilean balance-sheet caption coverage.
  5: ["edificios", "provisi\u00f3n impuesto", "garant\u00eda", "fondo de capital", "inversiones", "capital"],
  // v7 (2026-09-18): the English of "property, plant and equipment". Without
  // it the line fell to the other-assets pool on every English balance sheet.
  6: ["property, plant and equipment"],
  // v8 (2026-09-21): a live Australian Xero balance sheet left its whole bank
  // group and its whole fixed-asset register unmapped. The cash rule knew the
  // US spelling only, the depreciable-assets rule knew no account name an
  // accounting package actually prints, and a named partner capital account
  // was claimed by the bare "capital" keyword on the common-stock group.
  7: ["cheque account", "computer equipment", "capital -"],
  /* v9 (2026-09-23): the Mexican chart of accounts. A CONTPAQ i balance sheet
     left its land, its whole fixed-asset register, every tax account and the
     accumulated result unmapped, and an advance PAID to suppliers was booked
     as a payable. */
  8: ["terrenos", "equipo de transporte", "depreciaci\u00f3n acumulada", "amortizaci\u00f3n acumulada", "anticipo a proveedores",
      "impuestos por pagar", "resultado de ejercicios anteriores", "depreciaci\u00f3n contable",
      "gastos de servicio"],
  /* v10 (2026-09-24): the payment-processor fees left the cost-of-goods group
     and became a group of their own, so a saved catalogue that never had them
     needs the new group as well as the move. */
  9: ["paypal fee"],
  /* v11 (2026-09-28): UK statutory P&L and balance-sheet captions — interest
     receivable/payable, other operating income, the bare "Taxation" charge,
     the distribution/administrative expense headings and "Stocks". */
  10: ["interest receivable", "interest payable", "other operating income", "taxation",
       "distribution costs", "stocks"],
  // v12 (2026-09-28): Macroroots spreadsheets — other expenses, debt by term, taxes payable.
  11: ["other expenses", "short-term debt", "long-term debt", "taxes payable"],
  // v13 (2026-09-29): sundry debtors are other current assets, not trade receivables.
  12: ["deudores diversos"],
  /* v15 (2026-09-30): Blue Water Grill — bank accounts named after the bank,
     staff loans and "due from" balances, equipment rental, donations,
     "business tax" and furniture held with equipment. */
  14: ["checking", "staff loan", "due from shareholder", "equipment rental", "donation", "business tax", "furniture and equipment"],
  // v16 (2026-09-30): annual accounts in Dutch style (Collaborate and Eight).
  15: ["housing costs", "interest and similar expenditure", "interest and similar income", "currency differences", "selling costs", "debts to participants", "debts to credit institutions"],
  // v17 (2026-10-01): Colombian (PUC) statements (Premium Care).
  16: ["antic. a trabajadores", "anticipo de clientes", "impto de renta"],
};

/** Keywords that MOVED to a different line at a given version. Adding a group
    cannot fix a caption that the saved catalogue already claims for the wrong
    line: the old group keeps matching and position only breaks ties. So the
    keyword is taken out of every group that is not its new target, and added
    to the group that is. A preparer who deleted the keyword keeps it deleted;
    a preparer who moved it somewhere else themselves keeps their choice,
    because only the target it is being moved OFF is touched. */
const RULES_MOVED_SINCE: Record<number, Array<{ kw: string[]; from: string; to: string }>> = {
  /* v10 (2026-09-24): a payment processor's fee is the cost of collecting the
     money, not the cost of the goods. Booked on Schedule C line 2 it read as
     cost of goods sold; it belongs in other deductions beside "bank fees". */
  9: [{
    kw: ["shopify fee", "paypal fee", "stripe fee", "merchant account fee",
         "merchant fee", "payment processing fee", "payment fee",
         "transaction fee", "processing fee"],
    from: "IS:12", to: "IS:OD",
  }],
  /* v13 (2026-09-29): short-term debt joins the other borrowings on
     Schedule F line 19 (v12 had put it on the other-current-liabilities
     pool). Only a v12 catalogue carries it there, so only that one moves. */
  12: [{
    kw: ["short-term debt", "short term debt", "short-term loans", "short-term loan", "short-term borrowings"],
    from: "BS:OCL", to: "BS:OL",
  }],
  /* v14 (2026-09-30): a plain exchange gain or loss is line 8a, as the
     section route already had it; only a caption saying "realised" is 8b. */
  13: [{ kw: ["exchange gain", "exchange loss"], from: "IS:20", to: "IS:19" }],
};

/** Groups the saved catalogue is missing purely because it predates them.
    A group the preparer DELETED is never resurrected: only groups introduced
    after the saved version are considered. */
export function upgradeRules(saved: MappingRule[], savedVersion: number | undefined): MappingRule[] {
  const from = savedVersion ?? 1;
  if (from >= RULE_CATALOGUE_VERSION) return saved;
  const known = new Set(saved.flatMap((r) => r.kw.map((k) => k.toLowerCase())));
  const wanted = new Set<string>();
  for (let v = from; v < RULE_CATALOGUE_VERSION; v++) for (const k of RULES_ADDED_SINCE[v] || []) wanted.add(k);
  /* Known per LINE, not just as a word: "taxation" already sat on the
     balance-sheet creditor group, and that must not stop the P&L tax group
     that now also carries it from being added. */
  const knownOn = new Set(saved.flatMap((r) => r.kw.map((k) => `${r.t}|${k.toLowerCase()}`)));
  const add = DEFAULT_RULES.filter((r) => r.kw.some((k) => wanted.has(k.toLowerCase()) && !knownOn.has(`${r.t}|${k.toLowerCase()}`)));
  const skipWords: string[] = [];
  for (let v = from; v < RULE_CATALOGUE_VERSION; v++) for (const k of SKIP_ADDED_SINCE[v] || []) if (!known.has(k)) skipWords.push(k);
  const moves: Array<{ kw: string[]; from: string; to: string }> = [];
  for (let v = from; v < RULE_CATALOGUE_VERSION; v++) for (const m of RULES_MOVED_SINCE[v] || []) {
    const words = m.kw.map((k) => k.toLowerCase());
    // Applicable only while the keyword is still on the line it is moving off.
    // A catalogue that never had it, or has already been moved, is untouched.
    if (saved.some((r) => r.t === m.from && r.kw.some((k) => words.includes(k.toLowerCase())))) moves.push(m);
  }
  if (!add.length && !skipWords.length && !moves.length) return saved;
  let merged = skipWords.length
    ? saved.map((r) => (r.t === "SKIP" ? { ...r, kw: [...r.kw, ...skipWords] } : r))
    : saved;
  for (const m of moves) {
    const words = m.kw.map((k) => k.toLowerCase());
    // Only the group it is being moved OFF loses the keyword.
    merged = merged
      .map((r) => (r.t === m.from ? { ...r, kw: r.kw.filter((k) => !words.includes(k.toLowerCase())) } : r))
      .filter((r) => r.kw.length);
    // Only the keywords the saved catalogue actually carried are moved across.
    const carry = m.kw.filter((k) => known.has(k.toLowerCase()));
    if (!carry.length) continue;
    if (merged.some((r) => r.t === m.to)) {
      let done = false;
      merged = merged.map((r) => {
        if (done || r.t !== m.to) return r;
        done = true;
        const have = new Set(r.kw.map((k) => k.toLowerCase()));
        return { ...r, kw: [...r.kw, ...carry.filter((k) => !have.has(k.toLowerCase()))] };
      });
    } else {
      merged = [...merged, { t: m.to, kw: [...carry] }];
    }
  }
  // Ahead of the saved rules: a longer keyword still wins, so position only
  // decides ties, and a rule the preparer wrote should not lose one.
  return [...merged, ...add.map((r) => ({ t: r.t, kw: [...r.kw] }))];
}

let state: WpState = {
  stakeholder: initialStakeholder,
  entities: [makeEntity("Entity 1", initialStakeholder)],
  activeEntityId: null,
  rules: DEFAULT_RULES.map((r) => ({ t: r.t, kw: [...r.kw] })),
  rulesVersion: RULE_CATALOGUE_VERSION,
  policies: [],
  rateDb: seedRateDb(),
  groq: { key: "", model: GROQ_MODELS[0], status: "not configured", latency: null, calls: 0, tokens: 0, lastError: "" },
  agent: {},
  usage: { docs: 0, storage: 0, api: 0, generated: 0 },
  busy: false,
  providerUsage: Object.fromEntries(
    PROVIDERS.map((p) => [p.id, { requests: 0, units: 0, lastStatus: "idle" as const, lastError: "", lastLatency: null, lastUsed: null }]),
  ),
  translateOrder: ["mymemory", "lingva"],
  fxOrder: ["ofx", "frankfurter", "erapi"],
  quotaDay: new Date().toISOString().slice(0, 10),
  liveRates: {},
  events: [],
  toast: null,
};
state.activeEntityId = state.entities[0].id;

/* The layer reads the LIVE state through this, not a snapshot copy: it runs on
   its own after a wp:state event and must see what the app sees at that
   moment. Published immediately — unlike __WPACT, `state` is fully built here. */
if (typeof window !== "undefined") window.__WPGET = () => state;

/** Every state-changing action writes one immutable audit row. */
function logEvent(action: string, detail: string, entity: string | null = null, actor: LogEvent["actor"] = "user") {
  const ev: LogEvent = {
    id: uid(),
    at: new Date().toISOString(),
    actor,
    entity,
    action,
    detail,
  };
  state = { ...state, events: [ev, ...state.events].slice(0, 500) };
}

/** Record a provider call. Counters reset when the calendar day changes,
    mirroring how these free allowances are published. */
/** Pending autoFillRates timers, one per entity. */
/* A year-end change re-reads the entity once the typing has stopped. */
const yearRerun: Record<string, ReturnType<typeof setTimeout>> = {};
const fxDebounce: Record<string, ReturnType<typeof setTimeout>> = {};

/** The period end a manually entered rate measures — never today's date, and
    never a guess: an unparseable period end yields null, and the rate is then
    stamped as unmeasured rather than as measuring something it does not. */
function fxMeasureDate(ent: Entity, key: string): string | null {
  const raw = key === "cyRate" ? ent.profile.cyEnd : key === "pyRate" ? ent.profile.pyEnd : null;
  try {
    return requireIso(raw);
  } catch {
    return null;
  }
}

/** Stamp (or clear) the provenance of a hand-typed rate. */
function fxManualMeta(
  meta: Record<string, FxMeta>,
  key: string,
  value: string,
  measuredOn: string | null,
): Record<string, FxMeta> {
  const next = { ...(meta || {}) };
  if (!String(value ?? "").trim()) { delete next[key]; return next; }
  next[key] = {
    source: "Manual entry",
    asOf: measuredOn || "",
    enteredOn: new Date().toISOString().slice(0, 10),
    measured: !!measuredOn,
    tag: "Manual",
  };
  return next;
}

function recordProvider(id: string, units: number, ok: boolean, error = "", latency: number | null = null) {
  const today = new Date().toISOString().slice(0, 10);
  let usage = state.providerUsage;
  if (state.quotaDay !== today) {
    usage = Object.fromEntries(
      Object.keys(usage).map((k) => [k, { requests: 0, units: 0, lastStatus: "idle" as const, lastError: "", lastLatency: null, lastUsed: null }]),
    );
    state = { ...state, quotaDay: today };
  }
  const prev = usage[id] || { requests: 0, units: 0, lastStatus: "idle" as const, lastError: "", lastLatency: null, lastUsed: null };
  state = {
    ...state,
    providerUsage: {
      ...usage,
      [id]: {
        requests: prev.requests + 1,
        units: prev.units + units,
        lastStatus: ok ? "ok" : "error",
        lastError: ok ? "" : error,
        lastLatency: latency,
        lastUsed: new Date().toISOString(),
      },
    },
  };
}

const listeners = new Set<() => void>();

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function getSnapshot(): WpState { return state; }

/* Persistence seam: the store never imports the backend client. persist.ts
   registers hooks; in local mode nothing is registered and nothing changes. */
type StoreHooks = {
  onMutate?: (patch: Partial<WpState>) => void;
  onFilesAdded?: (entityId: string, files: EntityFile[]) => void;
};
const hooksList: StoreHooks[] = [];
export function registerStoreHooks(h: StoreHooks) { hooksList.push(h); }
const hooks: StoreHooks = {
  onMutate: (patch) => hooksList.forEach((h) => h.onMutate?.(patch)),
  onFilesAdded: (id, files) => hooksList.forEach((h) => h.onFilesAdded?.(id, files)),
};

/** Replace the whole state (hydration from the backend). */
export function loadState(next: WpState) {
  const rules = upgradeRules(next.rules || [], next.rulesVersion);
  const added = rules.length - (next.rules?.length || 0);
  // A project saved before the agent existed has no `agent` key; without the
  // default every read of state.agent would throw on restore.
  const groq = { ...state.groq, ...(next.groq || {}) };
  if (!GROQ_MODELS.includes(groq.model)) groq.model = GROQ_MODELS[0];
  state = { ...next, groq, rules, rulesVersion: RULE_CATALOGUE_VERSION, agent: next.agent || {} };
  listeners.forEach((fn) => fn());
  // After the assignment, not before: logEvent writes through set(), and the
  // entry would be discarded by the state replacement above.
  if (added > 0) {
    logEvent(
      "Mapping rules updated",
      `${added} rule group(s) added from catalogue v${RULE_CATALOGUE_VERSION}; your own rules and edits are untouched`,
    );
  }
}

function set(patch: Partial<WpState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
  hooks.onMutate?.(patch);
  /* The enhancement layer's ONLY re-render trigger. It is plain DOM code
     outside React, so it cannot subscribe to the store — this event is how it
     learns anything changed. (A listener that throws is already contained by
     the event system; the try/catch is for environments with no window or no
     CustomEvent, such as the tests and any server-side render.) */
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("wp:state"));
  } catch { /* no window (tests, SSR) */ }
}

function updateEntity(id: string, patch: Partial<Entity>) {
  set({ entities: state.entities.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  if (patch.translations) rememberTerms(patch.translations);
}

/* ---------- shared translation memory ----------
   One English wording per foreign caption, across every work paper on this
   machine: a caption translated (or corrected) once reads the same the next
   time it appears, on any entity. Filled from every translation an entity
   stores; read back before mapping. Browser storage, like the choice memory. */
const TERM_KEY = "en9TermMemory";
function readTerms(): Record<string, string> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(TERM_KEY) : null;
    const m = raw ? JSON.parse(raw) : {};
    return m && typeof m === "object" ? m : {};
  } catch { return {}; }
}
function rememberTerms(translations: Record<string, string>): void {
  try {
    if (typeof localStorage === "undefined") return;
    const m = readTerms();
    let changed = false;
    for (const [k, v] of Object.entries(translations || {})) {
      if (!k || k.length < 3 || !v || v === k || isServiceErrorText(v) || m[k] === v) continue;
      m[k] = v; changed = true;
    }
    if (!changed) return;
    const keys = Object.keys(m);
    for (const k of keys.slice(0, Math.max(0, keys.length - 3000))) delete m[k];
    localStorage.setItem(TERM_KEY, JSON.stringify(m));
  } catch { /* storage unavailable */ }
}
export function termsFromMemory(existing: Record<string, string> | undefined, labels: string[]): Record<string, string> {
  const m = readTerms();
  const out: Record<string, string> = {};
  for (const l of labels) if (l && !(existing && existing[l]) && m[l] && !out[l]) out[l] = m[l];
  return out;
}

let toastId = 0;
export function toast(text: string, kind: "ok" | "bad" | "" = "") {
  const id = ++toastId;
  set({ toast: { id, text, kind } });
  setTimeout(() => { if (state.toast && state.toast.id === id) set({ toast: null }); }, 3400);
}

/* ---------------- actions ---------------- */
/* Fan-out: a client copy holding several filed 5471s creates one work paper
   per foreign corporation. The parent keeps the block matching its own name;
   every other NAMED block becomes a sibling entity sharing the same document
   files, processed sequentially. Re-processing never spawns duplicates: a
   plan whose reference ID or name matches an existing entity is skipped. */
/* Which corporation does a page belong to?
 *
 * A client sends one PDF per statement, but a stapled set — or a package
 * that prints two companies one after the other — carries pages for more
 * than one foreign corporation. A Form 5471 is filed per corporation, so a
 * page that names another corporation must not feed this work paper: added
 * together, two companies' balance sheets produce a work paper that belongs
 * to neither. The page's own letterhead is the evidence, and nothing else
 * is guessed: a page that names no corporation stays with whoever the page
 * before it belonged to, and a page that names two is left unattributed.
 *
 * This is the source-side counterpart of the EN9_norm / EN9_vars / EN9_attr
 * block in dist/index.html; the two must agree caption for caption. */
const entityNameKey = (s: string): string => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function entityNameVariants(name: string): string[] {
  const n = entityNameKey(name);
  if (!n) return [];
  const out = [n];
  const bare = n.replace(/(proprietarylimited|ptylimited|ptyltd|limited|ltd|pty|incorporated|inc|llc|gmbh|plc)+$/, "");
  if (bare && bare !== n && bare.length >= 6) out.push(bare);
  return out;
}

type PageOwnerDoc = { rows: { page: number; cells: { text: string }[] }[] };

export function attributePagesToEntities(
  doc: PageOwnerDoc,
  ents: { key: string; vars: string[] }[],
): Map<number, string | null> {
  /* The letterhead is at the top of the page, so only the first rows are
     read — far enough down to clear a logo, not so far that an account
     caption naming a group company decides the page. */
  const head = new Map<number, string[]>();
  for (const r of doc.rows) {
    const acc = head.get(r.page) || [];
    if (acc.length < 16) { acc.push(r.cells.map((c) => c.text).join(" ")); head.set(r.page, acc); }
  }
  const pages = [...head.keys()].sort((a, b) => a - b);
  const owner = new Map<number, string | null>();
  let running: string | null = null;
  let first: string | null = null;
  for (const page of pages) {
    const text = entityNameKey((head.get(page) || []).join(" "));
    const hit = ents.filter((e) => e.vars.some((v) => v && text.includes(v)));
    if (hit.length === 1) { running = hit[0].key; if (first === null) first = running; }
    owner.set(page, running);
  }
  // Pages before the first letterhead belong to the first corporation named.
  if (first !== null) for (const page of pages) { if (owner.get(page) !== null) break; owner.set(page, first); }
  return owner;
}

let fanningOut = false;

async function fanOutSiblings(parentId: string, plans: CfCandidate[]): Promise<void> {
  const parent = state.entities.find((e) => e.id === parentId);
  if (!parent) return;
  /* When the plan and an existing entity are BOTH named, the NAME decides and
     nothing else does — the same rule the candidate dedupe applies. A
     reference ID read from a neighbouring block's pages (the scan bands
     overlap on a stapled multi-CFC copy) otherwise matched this plan against
     the corporation already being prepared, and the second corporation never
     became an entity at all. Identifiers only settle it when a name is
     missing, and a template placeholder ("Entity 1") is not a name. */
  const placeholderName = (n: string) => !String(n || "").trim() || /^entity \d+$/i.test(String(n).trim());
  const fresh = plans.filter((plan) => {
    const match = state.entities.find((e) => {
      const known = e.profile.legalName || e.name;
      if (plan.cfcName && !placeholderName(known)) return entitySimilarity(known, plan.cfcName) >= 0.5;
      return plan.refIds.length > 0 && !!e.profile.refId && plan.refIds.includes(e.profile.refId);
    });
    return !match;
  });
  if (!fresh.length) return;
  toast(`${fresh.length + 1} foreign corporations found in ${fresh[0].source} — creating ${fresh.map((p) => p.cfcName).join(", ")}`, "ok");
  for (const plan of fresh) {
    const sib = makeEntity(plan.cfcName, state.stakeholder);
    sib.profile.legalName = plan.cfcName;   // drives the sibling's own block selection + backend naming
    if (plan.refIds[0]) sib.profile.refId = plan.refIds[0];
    /* A sibling is another work paper for the SAME engagement year. Carrying
       the parent's year end means the sibling obeys the preparer's choice too,
       instead of re-deriving a year from the shared documents and quietly
       preparing a different one. */
    if (selectedYear(parent)) {
      sib.profile.cyEnd = parent.profile.cyEnd;
      sib.profile.pyEnd = parent.profile.pyEnd;
    }
    // Share the parent's documents: same file ids, same blob references.
    // Storage counts per entity copy — consistent with removeEntity's refund.
    sib.files = parent.files.map((f) => ({ ...f }));
    const bytes = sib.files.reduce((n, f) => n + f.size, 0);
    set({
      entities: [...state.entities, sib],
      usage: { ...state.usage, storage: state.usage.storage + bytes },
    });
    logEvent("Entity created from prior-year 5471", `${sib.name} · seeded from ${plan.source} (5471 #${plan.blockIndex + 1}) · ref ID ${plan.refIds[0] ?? "—"}`, sib.name, "system");
    logEvent("Documents shared", `${sib.files.length} document(s) shared from ${parent.name}`, sib.name, "system");
    hooks.onFilesAdded?.(sib.id, sib.files);
    await actions.processEntity(sib.id);
  }
  const p2 = state.entities.find((e) => e.id === parentId);
  if (p2) updateEntity(parentId, { log: [...p2.log, `Fan-out: created ${fresh.map((p) => p.cfcName).join(", ")} from the additional Form 5471(s)`] });
}

/** Review items for a document whose text came from OCR: one notice naming
    the engine and pages, and one item per disputed reading. The disputed
    value is offered as `suggestedValue`, never applied — the figure booked
    is what the primary engine read, and the preparer decides. A page the
    engines could not read at all blocks generation: nothing from it is on
    the work paper, and silence would hide that. */
export function ocrReviewItems(f: EntityFile): (Omit<ReviewItem, "id"> & { id: string })[] {
  const o = f.ocr;
  if (!o) return [];
  const out: (Omit<ReviewItem, "id"> & { id: string })[] = [];
  const confs = o.pages.filter((p) => p.status === "ocr" && typeof p.confMean === "number").map((p) => p.confMean as number);
  const mean = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
  const failed = o.pages.filter((p) => p.status === "failed").map((p) => p.page);
  out.push({
    id: `ocr-doc-${f.id}`, level: "info", category: "process", source: f.name,
    message: `${f.name} was read by OCR — ${o.backend || o.engine}${o.verifyEngine ? `, cross-checked by ${o.verifyEngine}` : ""} — on page(s) ${o.ocrPages.join(", ") || "none"}` +
      `${mean != null ? `, mean confidence ${Math.round(mean * 100)}%` : ""}${o.mode === "manual" ? " (started by the preparer)" : " (detected automatically at upload)"}. ` +
      `Every figure it contributes is machine-read: verify each against the original scan${o.originalName && o.originalName !== f.name ? ` (${o.originalName})` : ""}.`,
  });
  if (failed.length) {
    out.push({
      id: `ocr-failed-${f.id}`, level: "block", category: "source-gap", source: f.name,
      message: `${f.name}: page(s) ${failed.join(", ")} could not be read by any OCR engine, so NOTHING from them feeds the work paper. Supply a clearer scan or type the figures onto the schedule lines.`,
    });
  }
  for (const p of o.pages) {
    for (const fl of p.flags || []) {
      if (fl.level === "info") continue;
      out.push({
        id: `ocr-flag-${f.id}-p${fl.page}-${fl.kind}-${norm(fl.text || "").slice(0, 24)}-${Math.round((fl.bbox || [0])[0] || 0)}`,
        level: fl.level === "block" ? "block" : "warn", category: "source-gap", source: f.name,
        message: `${f.name} p.${fl.page}: ${fl.message}`,
        sourceLabel: fl.text || undefined,
        suggestedValue: fl.alt ?? undefined,
      });
    }
  }
  return out;
}

/** Record (or reset) the scans awaiting OCR for one entity. `null` clears the
    entity's queue. Never throws: a missing global must not fail processing. */
function queueScans(entityId: string, doc: { id: string; name: string } | null) {
  try {
    const g = globalThis as unknown as { EN9SCANS?: Record<string, { id: string; name: string }[]> };
    g.EN9SCANS = { ...(g.EN9SCANS || {}) };
    if (!doc) { g.EN9SCANS[entityId] = []; return; }
    (g.EN9SCANS[entityId] ||= []).push(doc);
  } catch { /* the layer is optional */ }
}

/* ---------------- the bridge to the enhancement layer ----------------

   dist/index.html carries an enhancement layer (layer-src/) that runs as plain
   DOM code beside the React app: the OCR card, the mapping-table polish, the
   verify badges. It is deliberately outside the bundle — it lazy-loads three
   libraries from a CDN, which this self-contained single-file build otherwise
   never does — so it needs a way in and a way to know when to redraw.

   Three things, and all three must exist or the layer half-works in ways that
   are hard to see: __WPGET for the live state, __WPACT for the actions, and
   the wp:state event above. */

declare global {
  interface Window {
    __WPGET?: () => WpState;
    __WPACT?: typeof actions;
  }
}

/* ---------- choice memory ----------
   What the preparer chose before, on this machine: document types set by
   hand and average rates typed by hand. It is read back ONLY as suggestions
   (insights.ts memorySuggestions) — nothing is applied from it. Kept in the
   browser's own storage, so it is the preparer's habit, not project data. */
const CHOICE_KEY = "en9ChoiceMemory";
export function readChoiceMemory(): ChoiceMemory {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CHOICE_KEY) : null;
    const m = raw ? JSON.parse(raw) : {};
    return m && typeof m === "object" ? m : {};
  } catch { return {}; }
}
export function rememberChoice(kind: "docKind" | "fx", key: string, value: Record<string, string>): void {
  try {
    if (typeof localStorage === "undefined" || !key) return;
    const m = readChoiceMemory() as Record<string, Record<string, { count: number } & Record<string, unknown>>>;
    const bucket = (m[kind] ||= {});
    const prev = bucket[key];
    bucket[key] = { ...value, count: (prev && JSON.stringify({ ...prev, count: 0 }) === JSON.stringify({ ...value, count: 0 }) ? prev.count : 0) + 1 };
    localStorage.setItem(CHOICE_KEY, JSON.stringify(m));
  } catch { /* storage unavailable: nothing is remembered */ }
}

export const actions = {
  /** Publish the action surface to the layer. Called on a deferred tick, not
      at module scope: `actions` is still being defined here, and exposing a
      half-built object gives the layer methods that are undefined. */
  EN9_expose() {
    if (typeof window !== "undefined") window.__WPACT = actions;
  },

  /** The layer's own way to say something to the user. Without it the
      auto-OCR announcer's messages reached only the console — it called a
      __toast that did not exist. */
  __toast(text: string, kind: "ok" | "bad" | "" = "") {
    toast(text, kind);
  },

  /** Which pages of a PDF carry a text layer, read with the bundled pdf.js
      — the same reader processing uses, so "no text" here means "no text"
      there. The layer asks this at upload time to decide whether a document
      needs OCR before Process Entity ever runs. null: not a PDF the reader
      could open. */
  async EN9_probePdf(blob: Blob): Promise<{ pageCount: number; textPages: number[]; scanPages: number[] } | null> {
    try {
      const doc = await pdfToDoc(await blob.arrayBuffer());
      const withText = new Set(doc.rows.map((r) => r.page));
      const all = Array.from({ length: doc.pageCount }, (_, i) => i + 1);
      return { pageCount: doc.pageCount, textPages: all.filter((p) => withText.has(p)), scanPages: all.filter((p) => !withText.has(p)) };
    } catch {
      return null;
    }
  },

  /** Swap a scanned document for its OCR'd copy in place: same position in
      the list, same document-type override, the original's name and hash
      recorded on the sidecar. A NEW file id is issued, because persistence
      keys blobs by id and would otherwise keep serving the old bytes.
      Returns the new id, or null when the entity or file is gone. */
  async EN9_replaceFile(entityId: string, fileId: string, file: File, ocr: Omit<OcrSidecar, "originalName" | "originalSha">): Promise<string | null> {
    const ent = state.entities.find((e) => e.id === entityId);
    const old = ent?.files.find((f) => f.id === fileId);
    if (!ent || !old) return null;
    let sha: string | null = null;
    try {
      if (typeof crypto !== "undefined" && crypto.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch { /* fall back below */ }
    if (!sha) sha = `nk:${file.name}|${file.size}|${file.lastModified || 0}`;
    const fresh: EntityFile = {
      id: uid(), name: file.name, size: file.size, parsable: true, blob: file, sha,
      ocr: { ...ocr, originalName: old.name, originalSha: old.sha },
    };
    const cur = state.entities.find((e) => e.id === entityId);
    if (!cur) return null;
    const files = cur.files.map((f) => (f.id === fileId ? fresh : f));
    const overrides = { ...(cur.docKindOverrides || {}) };
    if (overrides[fileId]) { overrides[fresh.id] = overrides[fileId]; delete overrides[fileId]; }
    const docClasses = { ...cur.docClasses };
    delete docClasses[fileId];
    updateEntity(entityId, { files, docKindOverrides: overrides, docClasses, status: "idle" });
    set({ usage: { ...state.usage, storage: Math.max(0, state.usage.storage - old.size + file.size) } });
    logEvent("Document replaced by OCR copy",
      `${old.name} → ${file.name} · ${ocr.backend || ocr.engine}${ocr.verifyEngine ? ` (cross-checked by ${ocr.verifyEngine})` : ""} · page(s) ${ocr.ocrPages.join(", ") || "none"} · ${ocr.mode}`,
      cur.name, "system");
    return fresh.id;
  },

  setStakeholder(name: string) {
    const clean = name.trim() || "Unnamed stakeholder";
    const old = state.stakeholder;
    logEvent("Stakeholder renamed", clean);
    set({
      stakeholder: clean,
      // Only entities still carrying the OLD stakeholder default follow the
      // rename — filer-derived and hand-typed client names survive.
      entities: state.entities.map((e) =>
        e.profile.clientName === old || !e.profile.clientName
          ? { ...e, profile: { ...e.profile, clientName: clean } }
          : e,
      ),
    });
  },

  addEntity() {
    const ent = makeEntity(`Entity ${state.entities.length + 1}`, state.stakeholder);
    logEvent("Entity added", ent.name, ent.name);
    set({ entities: [...state.entities, ent], activeEntityId: ent.id });
    toast(`${ent.name} added`, "ok");
  },

  renameEntity(id: string, name: string) {
    const clean = name.trim();
    if (!clean) return;
    const prev = state.entities.find((e) => e.id === id);
    if (prev && prev.name !== clean) logEvent("Entity renamed", `${prev.name} → ${clean}`, clean);
    set({
      entities: state.entities.map((e) =>
        e.id === id ? { ...e, name: clean, profile: { ...e.profile, entityShort: clean } } : e,
      ),
    });
  },

  removeEntity(id: string) {
    if (state.entities.length === 1) { toast("At least one entity is required", "bad"); return; }
    const ent = state.entities.find((e) => e.id === id);
    const freed = ent ? ent.files.reduce((n, f) => n + f.size, 0) : 0;
    const rest = state.entities.filter((e) => e.id !== id);
    logEvent("Entity removed", ent ? `${ent.name} · ${ent.files.length} document(s) discarded` : id, ent?.name ?? null);
    set({
      entities: rest,
      activeEntityId: state.activeEntityId === id ? rest[0].id : state.activeEntityId,
      usage: { ...state.usage, storage: Math.max(0, state.usage.storage - freed) },
    });
    toast("Entity removed");
  },

  toggleEntity(id: string) {
    set({ entities: state.entities.map((e) => (e.id === id ? { ...e, open: !e.open } : e)) });
  },

  setActiveEntity(id: string) { set({ activeEntityId: id }); },

  /* Attaching the same document twice doubles every figure it contributes,
     and the second copy looks exactly like a legitimate second statement, so
     nothing downstream can catch it. Identity is the file's SHA-256, compared
     against everything already attached AND everything earlier in this batch
     — dragging a folder in twice is the common way it happens.

     The order matters: size gate, then extension, then hash. Hashing a 25 MB
     file that is about to be refused for its size is wasted work. */
  async addFiles(id: string, fileList: FileList | File[]) {
    const ent = state.entities.find((e) => e.id === id);
    if (!ent) return;
    const added: EntityFile[] = [];
    let bytesAdded = 0;
    for (const f of Array.from(fileList)) {
      if (f.size > MAX_FILE_MB * 1048576) { toast(`${f.name} exceeds ${MAX_FILE_MB} MB`, "bad"); continue; }
      const ext = "." + (f.name.split(".").pop() || "").toLowerCase();

      let sha: string | null = null;
      try {
        if (typeof crypto !== "undefined" && crypto.subtle) {
          const digest = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
          sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
        }
      } catch { /* no SubtleCrypto (an insecure origin) — fall back below */ }
      /* Without the crypto API, name+size+lastModified is a weaker identity
         but a real one. It is PREFIXED so it can never collide with a real
         digest, and the comparison below requires both sides to have a key —
         a file attached before hashing existed must not match on undefined. */
      if (!sha) sha = `nk:${f.name}|${f.size}|${f.lastModified || 0}`;

      const dup = [...ent.files, ...added].find((x) => x.sha && x.sha === sha);
      if (dup) {
        toast(`${f.name} is byte-identical to ${dup.name} — already attached, skipped (uploading the same file twice would double every figure)`, "bad");
        logEvent("Duplicate document refused", `${f.name} matches ${dup.name}`, ent.name);
        continue;
      }

      added.push({ id: uid(), name: f.name, size: f.size, parsable: NATIVE_PARSE.includes(ext), blob: f, sha });
      bytesAdded += f.size;
    }
    if (!added.length) return;
    added.forEach((f) => logEvent("Document added", `${f.name} · ${f.size} bytes · ${f.parsable ? "native parse" : "unsupported format"}`, ent.name));
    updateEntity(id, { files: [...ent.files, ...added], status: "idle" });
    set({ usage: { ...state.usage, storage: state.usage.storage + bytesAdded } });
    toast(`${added.length} document${added.length === 1 ? "" : "s"} added to ${ent.name}`, "ok");
    hooks.onFilesAdded?.(id, added);
  },

  /** Manual document-type override — applied on the next (re)processing. */
  setDocKind(entityId: string, fileId: string, kind: DocKind | "", pageHint?: "fs-pnl" | "fs-balance-sheet") {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const f = ent.files.find((x) => x.id === fileId);
    const overrides = { ...(ent.docKindOverrides || {}) };
    const prior = overrides[fileId];
    if (!kind) {
      // Clearing the type must not silently discard a pinned worksheet list.
      if (prior?.sheets?.length) overrides[fileId] = { sheets: prior.sheets };
      else delete overrides[fileId];
    } else {
      overrides[fileId] = { ...(prior?.sheets?.length ? { sheets: prior.sheets } : {}), kind, ...(pageHint ? { pageHint } : {}) };
    }
    updateEntity(entityId, { docKindOverrides: overrides });
    logEvent("Document type set", `${f?.name ?? fileId} → ${kind || "automatic"}${pageHint ? ` (${pageHint})` : ""}`, ent.name);
    if (kind && f) rememberChoice("docKind", fileSignature(f.name), { kind, example: f.name });
    toast(kind ? "Document type saved — re-process to apply" : "Document type back to automatic", "ok");
  },

  /** Which worksheets to read from one workbook. Empty list = automatic. */
  setDocSheets(entityId: string, fileId: string, sheets: string[]) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const f = ent.files.find((x) => x.id === fileId);
    const overrides = { ...(ent.docKindOverrides || {}) };
    const existing = overrides[fileId];
    if (!sheets.length) {
      if (!existing) return;
      const { sheets: _drop, ...rest } = existing;
      // The sheet list may be the only reason the override exists.
      if (rest.kind) overrides[fileId] = rest;
      else delete overrides[fileId];
    } else {
      overrides[fileId] = { ...(existing || {}), sheets };
    }
    updateEntity(entityId, { docKindOverrides: overrides });
    logEvent(
      "Worksheets set",
      `${f?.name ?? fileId} → ${sheets.length ? sheets.join(", ") : "automatic (statement tabs)"}`,
      ent.name,
    );
    toast(sheets.length ? "Worksheets saved — re-process to apply" : "Worksheet choice back to automatic", "ok");
  },

  removeFile(entityId: string, fileId: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const f = ent.files.find((x) => x.id === fileId);
    if (f) logEvent("Document removed", f.name, ent.name);
    // A removed document takes its per-file derived state with it, and the
    // entity must be re-processed — stale "ready" over a changed document
    // set was exactly how deleted-document data lingered.
    const files = ent.files.filter((x) => x.id !== fileId);
    const docClasses = { ...ent.docClasses };
    const docKindOverrides = { ...(ent.docKindOverrides || {}) };
    delete docClasses[fileId];
    delete docKindOverrides[fileId];
    updateEntity(entityId, {
      files, docClasses, docKindOverrides,
      status: "idle",
      ...(files.length ? {} : { processedAt: null }),
    });
    if (f) set({ usage: { ...state.usage, storage: Math.max(0, state.usage.storage - f.size) } });
  },

  setField(entityId: string, bucket: "profile" | "ownership" | "fx", key: string, value: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    updateEntity(entityId, { [bucket]: { ...ent[bucket], [key]: value } } as Partial<Entity>);
    if (bucket === "fx" && key === "avgRate" && value && ent.profile.currency) {
      const yr = (/(\d{2})\s*$/.exec(ent.profile.cyEnd || "") || [])[1];
      if (yr) rememberChoice("fx", `${ent.profile.currency.toUpperCase()}|20${yr}`, { rate: value, entity: ent.profile.legalName || ent.name });
    }
    if (ent.detected[key] && ent.detected[key].value !== value) {
      const detected = { ...ent.detected };
      delete detected[key];                       // now a manual value
      updateEntity(entityId, { detected });
    }
    /* The year end decides which column is booked, which prior return opens
       the balances, which rates apply and what the validations compare. A
       change to it after a run leaves every one of those belonging to the
       year before — so say so, and drop the rates that were fetched for it,
       rather than letting the old figures stand under the new date. */
    if (bucket === "profile" && (key === "cyEnd" || key === "pyEnd") && ent.profile[key] !== value) {
      const before = yearOfShortPeriod(ent.profile.cyEnd);
      const after = yearOfShortPeriod(key === "cyEnd" ? value : ent.profile.cyEnd);
      /* Changing the work paper year moves the opening date with it. Without
         this the edit was real for the closing column and cosmetic for the
         opening one: the prior year end kept the value proposed for the year
         the documents report on. A prior year end the preparer typed by hand
         is never moved — `detected.pyEnd` is present only while the value is
         the tool's own proposal. */
      if (key === "cyEnd") {
        const cur = state.entities.find((e) => e.id === entityId);
        const want = priorPeriodEnd(value);
        const pyTyped = !!cur?.profile.pyEnd && !cur?.detected?.pyEnd;
        if (cur && want && !pyTyped && cur.profile.pyEnd !== want) {
          updateEntity(entityId, {
            profile: { ...cur.profile, pyEnd: want },
            detected: {
              ...cur.detected,
              pyEnd: {
                key: "pyEnd", value: want, confidence: "high",
                sourceLabel: `the year before ${value}, the period this work paper is prepared for`,
              },
            },
          });
        }
      }
      if (ent.processedAt && before !== after) {
        /* The year decides which column every figure came from, so nothing
           mapped for the old year may survive the change: the mapped lines,
           their provenance and the schedule writes are cleared at once, and
           the entity is read again for the new year as soon as the typing
           stops. Documents, profile, overrides and sign-offs are kept. */
        updateEntity(entityId, {
          yearStale: true,
          lines: {}, contributions: {}, sourceLabels: {}, unmatched: [], extraWrites: [], dividends: [],
          ...(ent.fxAuto ? { fx: {}, fxMeta: {} } : {}),
        });
        clearTimeout(yearRerun[entityId]);
        if (after && ent.files.length) {
          yearRerun[entityId] = setTimeout(() => {
            const cur = state.entities.find((e) => e.id === entityId);
            if (!cur || cur.status === "processing" || yearOfShortPeriod(cur.profile.cyEnd) !== after) return;
            void actions.processEntity(entityId);
          }, 1500);
        }
        logEvent(
          "Work paper year changed",
          `${before ?? "not set"} → ${after ?? "not set"} — the lines mapped for ${before ?? "the previous year"} were cleared; the documents are read again for ${after ?? "the new year"}`,
          ent.name, "user",
        );
        toast(after ? `Year changed to ${after} — the documents are read again for ${after}` : "Year end cleared — the old year's lines were removed", "");
      }
    }
    // Typing the currency by hand IS the confirmation (C-01).
    if (bucket === "profile" && key === "currency" && value.trim()) {
      updateEntity(entityId, { currencyConfirmed: true });
    }
    // C-02: the single legal-name input keeps driving the header while the
    // card still carries its default name.
    if (bucket === "profile" && key === "legalName" && value.trim()) {
      const cur = state.entities.find((e) => e.id === entityId);
      if (cur) {
        const patch: Partial<Entity> = {};
        if (!cur.profile.entityShort || /^Entity \d+$/.test(cur.profile.entityShort)) {
          patch.profile = { ...cur.profile, entityShort: value };
        }
        if (/^Entity \d+$/.test(cur.name)) patch.name = value;
        if (Object.keys(patch).length) updateEntity(entityId, patch);
      }
    }
    /* Currency or period end changed -> refresh the published rates, unless
       the preparer has overridden them by hand. Debounced: these are typed
       character by character, and firing on every keystroke sent one network
       lookup per letter of "AUD" and raced their results into the field. */
    if (bucket === "profile" && (key === "currency" || key === "cyEnd" || key === "pyEnd")) {
      clearTimeout(fxDebounce[entityId]);
      fxDebounce[entityId] = setTimeout(() => actions.autoFillRates(entityId, false), 700);
    }
    /* A hand-typed rate is stamped with the date it MEASURES — the period end
       it belongs to — with the date it was typed recorded separately. Those
       are different facts: a rate entered in March for a December year end is
       a December rate, and labelling it "March" made correct work look wrong
       in review. */
    if (bucket === "fx") {
      updateEntity(entityId, {
        fxAuto: false,
        fxMeta: fxManualMeta(ent.fxMeta, key, value, fxMeasureDate(ent, key)),
      });
    }
  },

  /* ---------------- dividends (Dividends rows 3–6) ---------------- */
  updateDividend(entityId: string, index: number, patch: Partial<Pick<DividendRec, "date" | "amountFunctional" | "usdPerUnit">>) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent || !ent.dividends[index]) return;
    const dividends = ent.dividends.map((d, i) => (i === index ? { ...d, ...patch } : d));
    const d = dividends[index];
    const row = 3 + index;
    const avgRate = numeric(ent.fx.avgRate);
    // The detected record (index 0) drives four schedules — its edits follow
    // through; added records live on the Dividends sheet only.
    const extraWrites = ent.extraWrites.map((w) => {
      if (w.sheet === SHEET.dividends && w.ref === `B${row}`) return { ...w, value: d.date };
      if (w.sheet === SHEET.dividends && w.ref === `C${row}`) return { ...w, value: d.amountFunctional };
      if (w.sheet === SHEET.dividends && w.ref === `D${row}` && d.usdPerUnit !== null) return { ...w, value: d.usdPerUnit };
      if (index === 0) {
        if (w.sheet === SHEET.schR && w.ref === "E10") return { ...w, value: d.date };
        if (w.sheet === SHEET.schR && (w.ref === "G10" || w.ref === "I10")) return { ...w, value: d.amountFunctional };
        if (w.sheet === SHEET.schJ && w.ref === "F33") return { ...w, value: -d.amountFunctional };
        if (w.sheet === SHEET.schM && w.ref === "E32" && avgRate) return { ...w, value: Math.round((d.amountFunctional * dividendShareOfFiler(ent)) / avgRate) };
        if (w.sheet === SHEET.schR && w.reviewId === "sch-r-split" && /^[GI]\d+$/.test(w.ref)) {
          const parts = distributionSplit(ent, d.amountFunctional);
          const p = parts ? parts[Number(w.ref.slice(1)) - 10] : undefined;
          if (p) return { ...w, value: p.amount };
        }
      }
      return w;
    });
    updateEntity(entityId, { dividends, extraWrites });
    logEvent("Dividend edited", `row ${row} · ${d.date} · ${d.amountFunctional.toLocaleString()} · US$/unit ${d.usdPerUnit ?? "n/a"}`, ent.name);
  },

  addDividend(entityId: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    if (ent.dividends.length >= 4) { toast("The template's Dividends sheet carries rows 3–6 (4 records)", "bad"); return; }
    const rec: DividendRec = { date: ent.profile.cyEnd || "", amountFunctional: 0, usdPerUnit: null, rateSource: "none" };
    const dividends = [...ent.dividends, rec];
    const row = 2 + dividends.length;
    const extraWrites = [...ent.extraWrites,
      { sheet: SHEET.dividends, ref: `B${row}`, value: rec.date, source: "dividends tab" },
      { sheet: SHEET.dividends, ref: `C${row}`, value: rec.amountFunctional, source: "dividends tab" },
    ];
    updateEntity(entityId, { dividends, extraWrites });
    toast("Dividend row added — Schedule R/J/M flow-through applies only to the detected record; review those schedules for added rows", "ok");
  },

  removeDividend(entityId: string, index: number) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    if (index === 0 || index !== ent.dividends.length - 1) { toast("Only the last added dividend row can be removed (the detected record drives four schedules)", "bad"); return; }
    const row = 3 + index;
    updateEntity(entityId, {
      dividends: ent.dividends.slice(0, -1),
      extraWrites: ent.extraWrites.filter((w) => !(w.sheet === SHEET.dividends && new RegExp(`^[BCD]${row}$`).test(w.ref))),
    });
  },

  /** Review Summary: include/exclude a template sheet from generation. */
  toggleSheetExclusion(entityId: string, sheet: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const cur = ent.excludedSheets || [];
    const on = cur.includes(sheet);
    updateEntity(entityId, { excludedSheets: on ? cur.filter((s) => s !== sheet) : [...cur, sheet] });
    logEvent(on ? "Sheet re-included" : "Sheet excluded from generation", sheet, ent.name);
  },

  /* ---------------- shareholders (Shareholding rows 19–26) ---------------- */
  addShareholder(entityId: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    if ((ent.shareholders || []).length >= 8) { toast("The template carries at most 8 shareholder rows (19–26)", "bad"); return; }
    const shareholders = [...(ent.shareholders || []), { id: uid(), name: "", classOfShares: "Common", boy: 0, eoy: 0 }];
    updateEntity(entityId, { shareholders, extraWrites: rebuildShareholderWrites({ ...ent, shareholders }) });
  },

  updateShareholder(entityId: string, id: string, patch: Partial<Shareholder>) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const shareholders = (ent.shareholders || []).map((s) => (s.id === id ? { ...s, ...patch, id } : s));
    updateEntity(entityId, { shareholders, extraWrites: rebuildShareholderWrites({ ...ent, shareholders }) });
  },

  removeShareholder(entityId: string, id: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const gone = (ent.shareholders || []).find((s) => s.id === id);
    const shareholders = (ent.shareholders || []).filter((s) => s.id !== id);
    updateEntity(entityId, { shareholders, extraWrites: rebuildShareholderWrites({ ...ent, shareholders }) });
    if (gone?.name) logEvent("Shareholder removed", gone.name, ent.name);
  },

  /* ------------- U.S. shareholders (Shareholding rows 7–14) -------------
     Schedule B Part I. Separate from the direct holders above because the
     same person is often in both — directly and again through a trust — and
     adding the two together would double-count ownership. */
  addUsShareholder(entityId: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    if ((ent.usShareholders || []).length >= 8) { toast("The template carries at most 8 U.S. shareholder rows (7–14)", "bad"); return; }
    const usShareholders = [...(ent.usShareholders || []), { id: uid(), name: "", classOfShares: "Common", boy: 0, eoy: 0 }];
    updateEntity(entityId, { usShareholders, extraWrites: rebuildShareholderWrites({ ...ent, usShareholders }) });
  },

  updateUsShareholder(entityId: string, id: string, patch: Partial<Shareholder>) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const usShareholders = (ent.usShareholders || []).map((s) => (s.id === id ? { ...s, ...patch, id } : s));
    updateEntity(entityId, { usShareholders, extraWrites: rebuildShareholderWrites({ ...ent, usShareholders }) });
  },

  removeUsShareholder(entityId: string, id: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const gone = (ent.usShareholders || []).find((s) => s.id === id);
    if (gone && typeof window !== "undefined" && window.confirm && !window.confirm(`Remove U.S. shareholder ${gone.name || "(unnamed)"}?`)) return;
    const usShareholders = (ent.usShareholders || []).filter((s) => s.id !== id);
    updateEntity(entityId, { usShareholders, extraWrites: rebuildShareholderWrites({ ...ent, usShareholders }) });
    if (gone?.name) logEvent("U.S. shareholder removed", gone.name, ent.name);
  },

  /** C-01: the preparer confirms an auto-detected functional currency. */
  confirmCurrency(entityId: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent || !ent.profile.currency) return;
    updateEntity(entityId, { currencyConfirmed: true });
    logEvent("Functional currency confirmed", `${ent.profile.currency} confirmed by the preparer`, ent.name);
    toast(`${ent.profile.currency} confirmed`, "ok");
    actions.autoFillRates(entityId, false);
  },

  /** The preparer settles a statements-vs-prior-return name disagreement.
   *
   * `sameEntity` is the whole point of asking: it decides whether the prior
   * return's carry-forward is used on the next run. The decision is stored,
   * so re-processing does not ask again, and the corrected name is written
   * everywhere the legal name goes (Basic Information B11, Schedule E B16,
   * the file name). */
  confirmLegalName(entityId: string, name: string, sameEntity: boolean) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent || !ent.nameMismatch) return;
    const chosen = String(name || "").trim() || ent.nameMismatch.statementName;
    const priorName = ent.nameMismatch.priorName;
    /* "Same company" means the statements' name is this company's too, so
       its pages keep feeding this work paper whichever name is kept as the
       legal one. */
    const aliases = sameEntity
      ? [...new Set([...(ent.nameAliases || []), ent.nameMismatch.statementName, priorName]
          .map((n) => String(n || "").trim())
          .filter((n) => n && n.toLowerCase() !== chosen.toLowerCase()))]
      : (ent.nameAliases || []);
    /* "Different company": whatever the prior return supplied while the
       question was open (a books name is used provisionally — see
       booksNameAlias) belongs to that other corporation and comes back out:
       its reference ID, address, currency, categories and holders. A value
       the preparer changed since is theirs and stays. */
    const profile: Record<string, string> = { ...ent.profile, legalName: chosen };
    const ownership: Record<string, string> = { ...ent.ownership };
    const categories = { ...ent.categories };
    const detected = { ...ent.detected };
    let shareholders = ent.shareholders || [];
    let usShareholders = ent.usShareholders || [];
    if (!sameEntity) {
      const src = ent.nameMismatch.source;
      const fromPrior = (label?: string) => !!src && String(label || "").startsWith(src);
      for (const [k, d] of Object.entries(ent.detected || {})) {
        if (!d || !fromPrior(d.sourceLabel)) continue;
        delete detected[k];
        if (k.startsWith("cat:")) { categories[k.slice(4)] = false; continue; }
        if (profile[k] !== undefined && profile[k] === d.value && k !== "legalName") profile[k] = "";
        else if (ownership[k] !== undefined && ownership[k] === d.value) ownership[k] = "";
      }
      if (profile.entityShort && entitySimilarity(profile.entityShort, priorName) >= 0.8) profile.entityShort = chosen;
      shareholders = shareholders.filter((h) => !fromPrior(h.source));
      usShareholders = usShareholders.filter((h) => !fromPrior(h.source));
    }
    updateEntity(entityId, {
      profile: profile as Entity["profile"],
      ...(sameEntity ? {} : {
        ownership: ownership as Entity["ownership"], categories, detected, shareholders, usShareholders,
        ...(entitySimilarity(ent.name, priorName) >= 0.8 ? { name: chosen } : {}),
      }),
      nameMismatch: null,
      nameDecision: { priorName, sameEntity },
      nameAliases: aliases,
    });
    logEvent(
      "Legal name confirmed",
      sameEntity
        ? `"${chosen}" confirmed as the same entity as "${priorName}" — re-process to carry the prior return forward`
        : `"${chosen}" confirmed as a different entity from "${priorName}" — its carry-forward figures stay out`,
      ent.name,
    );
    toast(sameEntity ? "Legal name confirmed — re-process to use the prior return" : "Legal name confirmed", "ok");
  },

  /** Populate C59/C60/C61 from the published tables, then from live data.
   *
   * `force` is the difference between the preparer pressing Refresh and the
   * app filling blanks on its own. A non-forced run must never overwrite a
   * rate the preparer typed: a hand-entered rate is a decision, and silently
   * replacing it with a table figure loses it with nothing on screen to say
   * so. Manual-tagged rates therefore survive every unforced pass, and the
   * fiscal strip below.
   */
  autoFillRates(entityId: string, force = true) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const code = (ent.profile.currency || "").toUpperCase().trim();
    if (!code) { if (force) toast("Set the functional currency first", "bad"); return; }

    /* FISCAL YEARS. The IRS yearly-average and Treasury 12/31 tables are
       calendar-year figures; a period ending in any month but December must
       never receive them. Rather than stopping there and leaving the preparer
       to type three rates, the run continues to OFX, which publishes daily
       data and can therefore average the ACTUAL period and price its actual
       ends. What is refused is the calendar table, not the automation. */
    const fiscal = isFiscalPeriod(ent.profile.cyEnd);
    if (fiscal) {
      logEvent(
        "Calendar-year tables skipped",
        `fiscal year ending ${ent.profile.cyEnd} — IRS/Treasury calendar tables not applicable; using OFX daily data over the actual period`,
        ent.name, "system",
      );
    }

    const db = state.rateDb;
    const hit = {
      ...applyPeg(
        lookupRates(code, ent.profile.cyEnd || "", ent.profile.pyEnd || "", {
          irsAvg: db.irsAvg, spot: db.spot, source: db.source,
        }),
        code,
        !!db.uploadedAt,
      ),
      ...(fiscal ? { avgRate: null, cyRate: null, pyRate: null } : null),
    };

    /* A previously auto-filled calendar rate on a year that has since been
       identified as fiscal is wrong and must go — but only the auto-filled
       ones. Anything the preparer typed is kept. */
    const stripAuto = <T extends Record<string, unknown>>(obj: T): T =>
      Object.fromEntries(
        Object.entries(obj || {}).filter(([k]) =>
          !["avgRate", "cyRate", "pyRate"].includes(k) || fxTag(ent.fxMeta?.[k]) === "Manual"),
      ) as T;
    const fx = fiscal && ent.fxAuto ? stripAuto({ ...ent.fx }) : { ...ent.fx };
    const fxMeta = fiscal && ent.fxAuto ? stripAuto({ ...ent.fxMeta }) : { ...ent.fxMeta };

    const put = (k: string, v: number | null, meta: FxMeta) => {
      if (v === null) return;
      if (!force && fxTag(fxMeta[k]) === "Manual") return;   // never clobber a typed rate
      if (force || fx[k] === undefined || fx[k] === "" || ent.fxAuto) {
        fx[k] = String(v);
        fxMeta[k] = meta;
      }
    };
    // The as-of dates derive from the entity's own period ends when set — the
    // provenance must not claim a 12/31 date the profile does not carry.
    const cyAsOf = ent.profile.cyEnd?.trim() || `12/31/${hit.cyYear}`;
    const pyAsOf = ent.profile.pyEnd?.trim() || `12/31/${hit.pyYear}`;
    put("avgRate", hit.avgRate, { source: `${db.source} · IRS yearly average`, asOf: `calendar ${hit.cyYear}`, tag: "IRS" });
    /* A pegged currency takes its peg, and says so: the published table's
       two decimals are a rounding of the peg, and translating an opening
       balance sheet at the rounded figure moves every line against the
       filing it continues. The table's own figure stays in the note. */
    const spotSource = hit.pegged
      ? `${hit.pegged.note} · published table ${hit.pegged.published.cy ?? "—"}`
      : `${db.source} · Treasury 12/31 spot`;
    const spotTag: FxMeta["tag"] = hit.pegged ? "Pegged" : "Treasury";
    put("cyRate", hit.cyRate, { source: spotSource, asOf: cyAsOf, tag: spotTag });
    put("pyRate", hit.pyRate, {
      source: hit.pegged
        ? `${hit.pegged.note} · published table ${hit.pegged.published.py ?? "—"}`
        : `${db.source} · Treasury 12/31 spot`,
      asOf: pyAsOf, tag: spotTag,
    });
    updateEntity(entityId, { fx, fxAuto: true, fxMeta });
    if (hit.avgRate || hit.cyRate || hit.pyRate) {
      logEvent("Exchange rates applied", `${code} · avg ${hit.avgRate ?? "—"} (${hit.cyYear}) · CY spot ${hit.cyRate ?? "—"} · PY spot ${hit.pyRate ?? "—"} · ${db.source}`, ent.name, "system");
      if (force) toast(`${code} rates applied from ${db.source}`, "ok");
    }

    /* Spot rates the tables lack, from the live providers, on the exact date.
       Only the provider that CANNOT answer a historical date is dropped from
       the order — the rest each have their own way of serving one, and which
       the preparer has enabled is their choice, not this function's. */
    const missing: Array<{ k: "cyRate" | "pyRate"; end: string }> = [];
    if (!fx.cyRate && ent.profile.cyEnd) missing.push({ k: "cyRate", end: ent.profile.cyEnd });
    if (!fx.pyRate && ent.profile.pyEnd) missing.push({ k: "pyRate", end: ent.profile.pyEnd });
    if (missing.length) {
      void (async () => {
        for (const m of missing) {
          let iso: string | null;
          try {
            iso = requireIso(m.end, m.k === "pyRate" ? "prior-year end date" : "current-year end date");
          } catch (err) {
            // Refuse rather than look up a dateless "latest" rate and stamp
            // today's figure as the year-end rate.
            logEvent("Exchange rate lookup refused", (err as Error).message, ent.name, "system");
            continue;
          }
          if (!iso) continue;
          const recent = Date.now() - new Date(iso).getTime() < 7 * 86400000;
          try {
            const order = !recent ? state.fxOrder.filter((p) => p !== "erapi") : state.fxOrder;
            const { result } = await fetchLiveRate(code, order, iso);
            if (result.ok && result.value.rate > 0) {
              const fresh = state.entities.find((e) => e.id === entityId);
              if (!fresh || fresh.fx[m.k] || fxTag(fresh.fxMeta?.[m.k]) === "Manual") continue;
              updateEntity(entityId, {
                fx: { ...fresh.fx, [m.k]: String(result.value.rate) },
                fxMeta: { ...fresh.fxMeta, [m.k]: {
                  source: `${result.value.provider} (live fallback)`,
                  asOf: asOfLabel(result.value.asOf, iso),
                  tag: providerTag(result.value.provider),
                } },
              });
              logEvent("Live rate fallback applied", `${code} ${m.k} = ${result.value.rate} · ${result.value.provider} · ${asOfLabel(result.value.asOf, iso)}`, ent.name, "system");
            }
          } catch { /* stays blank — the missing-rate blocker says what to enter */ }
        }
      })();
    }

    /* Average-rate chain (RAT-001, the preparer's decision): IRS table → OFX
       daily average over the entity's own period → blank, with the reason
       recorded so the preparer knows WHY they are typing it in. An OFX figure
       is always labelled as one. */
    if (!fx.avgRate && ent.profile.cyEnd) {
      const endIso = toIsoLoose(ent.profile.cyEnd);
      const startIso = endIso ? yearBefore(endIso) : null;   // leap-day safe
      if (endIso && startIso) {
        void (async () => {
          /* OFX first, then the ECB's daily reference rates. OFX carries about
             fifty currencies and not, for one, the Romanian leu; the ECB
             publishes the leu every working day. A provider switched off in
             Settings is skipped and said so. */
          type Avg = { ok: true; value: { rate: number; points: number; from: string; to: string } } | { ok: false; error: string };
          let r: Avg = { ok: false, error: "OFX provider is unchecked in Settings" };
          let via: "OFX" | "ECB" | "Market" = "OFX";
          if (state.fxOrder.includes("ofx")) {
            const t0 = Date.now();
            r = await fxOfxAverage(code, startIso, endIso).catch((err): Avg => ({ ok: false, error: (err as Error).message }));
            recordProvider("ofx", 1, !!r.ok, r.ok ? "" : r.error || "", Date.now() - t0);
          }
          if (!r.ok && state.fxOrder.includes("frankfurter")) {
            const t1 = Date.now();
            const e = await fxFrankfurterAverage(code, startIso, endIso).catch((err): Avg => ({ ok: false, error: (err as Error).message }));
            recordProvider("frankfurter", 1, !!e.ok, e.ok ? "" : e.error || "", Date.now() - t1);
            if (e.ok) { r = e; via = "ECB"; } else r = { ok: false, error: `OFX: ${r.error}; ECB: ${e.error}` };
          }
          /* Third: public market mid-rates (currency-api), sampled twice a
             month — for a network where neither OFX nor the ECB answers. */
          if (!r.ok) {
            const t2 = Date.now();
            const m = await fxCurrencyApiAverage(code, startIso, endIso).catch((err): Avg => ({ ok: false, error: (err as Error).message }));
            recordProvider("currency-api", 1, !!m.ok, m.ok ? "" : m.error || "", Date.now() - t2);
            if (m.ok) { r = m; via = "Market"; } else r = { ok: false, error: `${r.error}; currency-api: ${m.error}` };
          }
          const fresh = state.entities.find((e) => e.id === entityId);
          if (!fresh || fresh.fx.avgRate) return;   // filled meanwhile — keep it
          if (r.ok) {
            const v = r.value;
            const what = via === "OFX" ? "OFX daily mid-market rates" : via === "ECB" ? "ECB daily reference rates" : "public market mid-rates (currency-api, sampled on the 1st and 15th of each month)";
            const { avgRateNote: _cleared, ...restMeta } = fresh.fxMeta || {};
            updateEntity(entityId, {
              fx: { ...fresh.fx, avgRate: String(v.rate) },
              fxMeta: { ...restMeta, avgRate: {
                source: fiscal
                  ? `${via === "Market" ? "Market mid-rate" : `${via} daily`} average over the fiscal period (IRS calendar tables not applicable)`
                  : `${via === "Market" ? "Market mid-rate" : `${via} daily`} average (fallback — ${db.source} has no ${code} average)`,
                asOf: `${v.from}..${v.to} (${v.points} ${via === "Market" ? "sample dates" : "daily points"})`,
                tag: via,
              } },
            });
            logEvent(`${via} average-rate fallback applied`, `${code} average ${v.rate} over ${v.from}..${v.to} (${v.points} points) — IRS table has no figure`, ent.name, "system");
            const again = state.entities.find((e) => e.id === entityId);
            if (again && !again.reviewItems.some((x) => x.id === "avg-ofx-fallback")) {
              updateEntity(entityId, {
                reviewItems: [...again.reviewItems, {
                  id: "avg-ofx-fallback", level: "warn", category: "fx", applied: true,
                  message: fiscal
                    ? `C59 average rate ${v.rate} was computed from ${what} over the fiscal period ${v.from}..${v.to} (${v.points} points) — the IRS calendar-year table does not apply to this year end. Confirm or replace it before filing.`
                    : `C59 average rate ${v.rate} was computed from ${what} over ${v.from}..${v.to} (${v.points} points) because the IRS table has no ${code} average. ${via === "OFX" ? "OFX is an indicative source" : via === "ECB" ? "The ECB rate is a central-bank reference rate, not an IRS figure" : "currency-api is an indicative market source"} — confirm or replace it before filing.`,
                  target: `${SHEET.basic}!C59`, source: via, suggestedValue: v.rate,
                } as ReviewItem],
              });
            }
          } else {
            /* Nothing reachable. The two Treasury year-end rates bracket the
               year; their mean is offered as an ESTIMATE the preparer can
               accept in one click — never written on its own. */
            const cy = numeric(String(fresh.fx.cyRate ?? "")), py = numeric(String(fresh.fx.pyRate ?? ""));
            const est = cy && py && !fiscal ? Math.round(((cy + py) / 2) * 1e4) / 1e4 : null;
            updateEntity(entityId, {
              fxMeta: { ...fresh.fxMeta, avgRateNote: {
                source: fiscal
                  ? `fiscal period ${startIso}..${endIso}: daily-average fallbacks failed — ${r.error}`
                  : `no IRS ${code} average; online fallbacks failed — ${r.error}`,
                asOf: "",
                ...(est ? { estimate: est } : {}),
              } },
            });
            logEvent("Average-rate fallback unavailable", `${code}: no IRS figure; ${r.error} — manual entry required${est ? `; estimate ${est} offered` : ""}`, ent.name, "system");
          }
        })();
      }
    }
    if (!hit.avgRate && !hit.cyRate && !hit.pyRate && !missing.length && force) {
      toast(`No published rates for ${code} in those years — enter them manually`, "bad");
    }
  },

  /* ---------------- currency-rate database ---------------- */
  replaceRateDb(db2: RateDb) {
    logEvent("Currency rate database replaced", `${db2.source} · ${db2.codes.length} currencies`);
    set({ rateDb: db2 });
    toast("Rate database replaced — new lookups use it immediately", "ok");
  },

  setDbRate(code: string, kind: "avg" | "spot", year: string, raw: string) {
    const db = state.rateDb;
    const table = kind === "avg" ? { ...db.irsAvg } : { ...db.spot };
    const c = code.toUpperCase();
    const v = Number(raw.replace(/,/g, ""));
    table[c] = { ...(table[c] || {}) };
    if (!raw.trim() || !isFinite(v) || v <= 0) delete table[c][year];
    else table[c][year] = v;
    logEvent("Rate edited", `${c} ${kind === "avg" ? "IRS average" : "Treasury spot"} ${year} → ${raw || "cleared"}`);
    set({ rateDb: { ...db, [kind === "avg" ? "irsAvg" : "spot"]: table, source: db.source.includes("edited") ? db.source : `${db.source} (edited)` } });
  },

  resetRateDb() {
    logEvent("Currency rate database reset", "built-in IRS + Treasury tables restored");
    set({ rateDb: seedRateDb() });
    toast("Rate database reset to the built-in tables", "ok");
  },

  toggleCategory(entityId: string, cat: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    updateEntity(entityId, { categories: { ...ent.categories, [cat]: !ent.categories[cat] } });
  },

  setLine(entityId: string, key: string, field: "amount" | "boy" | "eoy", raw: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const lines = { ...ent.lines };
    const cur = { ...(lines[key] || {}) };
    if (raw === "") delete cur[field];
    else cur[field] = Number(raw);
    if (Object.keys(cur).length === 0) delete lines[key];
    else lines[key] = cur;
    updateEntity(entityId, { lines });
  },

  setRelabel(entityId: string, key: string, value: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const relabels = { ...ent.relabels };
    if (value.trim()) relabels[key] = value.trim();
    else delete relabels[key];
    updateEntity(entityId, { relabels });
  },

  assignUnmatched(entityId: string, index: number, target: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent || !target) return;
    const row = ent.unmatched[index];
    if (!row) return;
    const lines = { ...ent.lines };
    const contributions = { ...ent.contributions };
    const relabels = { ...ent.relabels };
    if (!manualApply(ent, lines, contributions, relabels, target, row, "manual")) {
      toast(`"${displayLabel(ent.translations, row.label)}" could not be booked to ${target} — the row's year columns don't identify a current-year value. Enter it directly on the line instead.`, "bad");
      return;
    }
    logEvent("Unmatched label assigned", `"${displayLabel(ent.translations, row.label)}" → ${target}`, ent.name);
    updateEntity(entityId, {
      lines,
      relabels,
      sourceLabels: { ...ent.sourceLabels, [target]: { label: row.label, values: row.values, years: row.years } },
      contributions,
      unmatched: ent.unmatched.filter((_, i) => i !== index),
      // The assignment is a standing decision — it now survives re-processing.
      mapOverrides: { ...ent.mapOverrides, [norm(row.label)]: { to: target } },
    });
    // And it teaches the tool: the caption becomes a mapping rule, so FUTURE
    // documents map it automatically (rules are editable in Settings).
    const kw = norm(row.label);
    if (kw.length >= 3 && !state.rules.some((r) => r.kw.some((k) => k.toLowerCase() === kw))) {
      set({ rules: [...state.rules, { kw: [kw], t: target }] });
      logEvent("Mapping rule learned", `"${kw}" → ${target} (from a manual assignment)`, ent.name);
      toast(`Mapped and remembered — future documents will map "${displayLabel(ent.translations, row.label)}" automatically`, "ok");
    }
  },

  /** Move every contribution of a caption to another template line (or back
      to the review queue). The decision persists as a mapOverride, so it
      survives re-processing. */
  remapCaption(entityId: string, fromTarget: string, label: string, to: string | null) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    if (to !== null && (!VALID_TARGETS.has(to) || to === fromTarget)) return;
    const all = ent.contributions[fromTarget] || [];
    const moved = all.filter((c) => c.label === label);
    if (!moved.length) return;

    // Honest-arithmetic guard: if the line no longer equals the sum of its
    // contributions, the user edited it by hand — refuse rather than guess.
    const cur = ent.lines[fromTarget] || {};
    const { total, has } = sumContribs(all);
    const mismatch = (["amount", "boy", "eoy"] as const).some((f) => {
      const lineV = typeof cur[f] === "number" ? (cur[f] as number) : null;
      return has[f] ? lineV === null || Math.abs(lineV - total[f]) > 0.01 : lineV !== null;
    });
    if (mismatch) {
      toast(`${fromTarget} was edited by hand — clear the manual value or re-process before remapping.`, "bad");
      return;
    }

    const lines = { ...ent.lines };
    const contributions = { ...ent.contributions };
    const sourceLabels = { ...ent.sourceLabels };
    const relabels = { ...ent.relabels };
    const unmatched = [...ent.unmatched];

    // Detach from the origin; recompute the origin line from what remains.
    const remaining = all.filter((c) => c.label !== label);
    if (remaining.length) contributions[fromTarget] = remaining; else delete contributions[fromTarget];
    const next = remaining.length ? linesFromContribs(remaining) : null;
    if (next) lines[fromTarget] = next; else delete lines[fromTarget];
    if (sourceLabels[fromTarget]?.label === label) {
      const first = remaining[0];
      if (first) sourceLabels[fromTarget] = { label: first.label, values: first.srcValues ?? [first.value], years: first.srcYears };
      else delete sourceLabels[fromTarget];
    }
    if (specFor(fromTarget)?.relabel && relabels[fromTarget] === label) delete relabels[fromTarget];

    let droppedBoy = 0;
    if (to === null) {
      const c0 = moved[0];
      unmatched.push({
        label,
        values: c0.srcValues ?? moved.map((c) => c.value),
        years: c0.srcYears,
        page: c0.page,
        docId: c0.docId || undefined,
        docName: c0.docName || undefined,
      });
    } else {
      const toIsBS = to.startsWith("BS");
      const added: Contribution[] = [];
      for (const c of moved) {
        let field = c.field;
        if (!toIsBS && c.field === "boy") { droppedBoy++; continue; }   // prior year never books to income
        if (!toIsBS && c.field === "eoy") field = "amount";
        if (toIsBS && c.field === "amount") field = "eoy";
        const curTo = lines[to] || {};
        if (field === "amount") lines[to] = { amount: (typeof curTo.amount === "number" ? curTo.amount : 0) + c.value };
        else if (field === "eoy") lines[to] = { ...curTo, eoy: (typeof curTo.eoy === "number" ? curTo.eoy : 0) + c.value };
        else lines[to] = { ...curTo, boy: (typeof curTo.boy === "number" ? curTo.boy : 0) + c.value };
        added.push({ ...c, field });
      }
      contributions[to] = [...(contributions[to] || []), ...added];
      const c0 = moved[0];
      sourceLabels[to] = { label, values: c0.srcValues ?? moved.map((c) => c.value), years: c0.srcYears };
      if (specFor(to)?.relabel && !relabels[to]) relabels[to] = label;
    }

    const mapOverrides = { ...ent.mapOverrides, [norm(label)]: { to } };
    /* A remap is the preparer's answer to the questions raised about this
       caption; they are not asked again. */
    const answered = new Set([`business-tax-question-${norm(label)}`, `freight-in-cogs-${norm(label)}`, `due-from-related-${norm(label)}`]);
    const reviewItems = ent.reviewItems.filter((r) => !answered.has(r.id));
    logEvent(
      "Caption remapped",
      `"${bilingualLabel(ent.translations, label)}": ${fromTarget} → ${to ?? "unassigned"}${droppedBoy ? ` · ${droppedBoy} prior-year value(s) not carried` : ""}`,
      ent.name,
    );
    updateEntity(entityId, { lines, contributions, sourceLabels, relabels, unmatched, mapOverrides, reviewItems });
    toast(
      to === null
        ? `"${label}" unassigned — back in the review queue`
        : `"${label}" moved to ${to}${droppedBoy ? " · prior-year value dropped (income lines take current year only)" : ""}`,
      "ok",
    );
  },

  dismissReviewItem(entityId: string, id: string, note?: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const item = ent.reviewItems.find((r) => r.id === id) || allReviewItems(ent).find((r) => r.id === id);
    if (!item) return;
    /* Answering it is the only way past. The UI hides the acknowledge button
       for these, and this is the belt to that pair of braces. */
    if (MUST_ANSWER.has(id)) {
      logEvent(
        "Acknowledgement refused",
        `"${item.message.slice(0, 120)}" must be answered, not acknowledged — it fills a required cell`,
        ent.name,
      );
      toast("Answer this one — acknowledging would leave the cell blank", "bad");
      return;
    }
    /* A blocking exception needs the preparer to SAY something, and that is
       all this asks. An earlier version of this check also demanded fifteen
       characters and rejected a list of filler words; it was wrong twice over.
       It refused real answers for being short -- "Rod confirmed" is thirteen
       characters and "Client confirmed" is sixteen, which is not a difference
       worth anything -- and it left no way to acknowledge a blocker in order
       to see what the workbook looks like. A reason can be anything; the
       preparer is the one signing the return.

       What the run that prompted this actually needed was for the problem to
       be VISIBLE afterwards, not for the note to be long: an out-of-balance
       Schedule F was waved through and the generated workbook said so nowhere
       on its face. Schedule F now carries a labelled out-of-balance row in all
       four columns, and a thin note is marked as such on the Provenance sheet,
       so a reviewer can see both the figure and the fact that nobody explained
       it. */
    /* Owner decision (2026-09-30): the reason is never an obstacle. Whatever
       the preparer types is recorded -- a word, a placeholder, or nothing --
       and an empty reason is recorded as such. A thin note is still marked on
       the Provenance sheet (isThinNote), so a reviewer can tell. */
    if (item.level === "block" && !String(note || "").trim()) note = "Acknowledged — no reason given";
    const rest = ent.reviewItems.filter((r) => r.id !== id);
    updateEntity(entityId, { reviewItems: [...rest, { ...item, dismissed: true, dismissedNote: note || "" }] });
    logEvent(
      item.level === "block" ? "Blocking exception acknowledged" : "Review item dismissed",
      `${item.message.slice(0, 160)}${note ? ` — "${note}"` : ""}`,
      ent.name,
    );
  },

  /** Edit an exception's value and resubmit: the linked workbook cells take
      the reviewer's number, and the item is signed off as "edited". */
  resubmitReviewItem(entityId: string, id: string, rawValue: string, note?: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const item = ent.reviewItems.find((r) => r.id === id) || allReviewItems(ent).find((r) => r.id === id);
    if (!item) return;
    const numeric = Number(String(rawValue).replace(/,/g, ""));
    const value: string | number = rawValue !== "" && isFinite(numeric) ? numeric : rawValue;

    let priorValue: string | number | undefined;
    let landed = false;

    // (a) Every schedule write linked by reviewId takes the new value.
    const linked = ent.extraWrites.filter((w) => w.reviewId === id);
    let extraWrites = ent.extraWrites;
    if (linked.length) {
      priorValue = linked[0].value;
      extraWrites = ent.extraWrites.map((w) => (w.reviewId === id ? { ...w, value } : w));
      landed = true;
    }

    /* (a2) The translation adjustment has no write until it is signed off —
       signing off IS the booking. The write carries who asked for it in its
       source, so the provenance sheet records a plug as a plug. */
    if (!landed && id === "re-translation-adjustment" && typeof value === "number") {
      extraWrites = [...ent.extraWrites, {
        sheet: SHEET.re, ref: "F24", value, reviewId: id,
        source: `translation adjustment booked by the preparer — residual of the retained-earnings roll-forward${note ? ` · "${note}"` : ""}`,
      }];
      landed = true;
    }
    if (!landed && id === "schh-nondeductible" && typeof value === "number") {
      extraWrites = [...ent.extraWrites,
        { sheet: SHEET.schH, ref: "C21", value: "Non-deductible expenses (donations)", reviewId: id, source: `donations add-back confirmed by the preparer${note ? ` · "${note}"` : ""}` },
        { sheet: SHEET.schH, ref: "E21", value, reviewId: id, source: `donations add-back confirmed by the preparer${note ? ` · "${note}"` : ""}` }];
      landed = true;
    }
    if (!landed && id === "re-equity-movement" && typeof value === "number") {
      extraWrites = [...ent.extraWrites, {
        sheet: SHEET.re, ref: "F25", value, reviewId: id,
        source: `equity adjustment booked by the preparer — residual of the retained-earnings roll-forward (one exchange rate, so not translation)${note ? ` · "${note}"` : ""}`,
      }];
      landed = true;
    }

    // (b) No linked write, but the target names an IS/BS input cell: stage
    // the value on the line itself.
    let lines = ent.lines;
    if (!landed && item.target) {
      const m = new RegExp(`^(${SHEET.is}|${SHEET.bs})!([DF])(\\d+)$`).exec(item.target);
      if (m && typeof value === "number") {
        const key = `${m[1] === SHEET.is ? "IS" : "BS"}:${m[3]}`;
        const field = m[1] === SHEET.is ? "amount" : m[2] === "D" ? "boy" : "eoy";
        priorValue = (ent.lines[key] as Record<string, number | null | undefined> | undefined)?.[field] ?? undefined;
        lines = { ...ent.lines, [key]: { ...(ent.lines[key] || {}), [field]: value } };
        landed = true;
      }
    }
    // (c) Neither: the edit is recorded on the item itself (documentation).

    const stamped: ReviewItem = {
      ...item,
      resolution: "edited",
      editedValue: value,
      priorValue,
      dismissed: true,
      dismissedNote: note || "",
    };
    const rest = ent.reviewItems.filter((r) => r.id !== id);
    updateEntity(entityId, { reviewItems: [...rest, stamped], extraWrites, lines });
    logEvent(
      "Exception resolved by edit",
      `${id}: ${priorValue !== undefined ? `${priorValue} → ` : ""}${value}${note ? ` — "${note}"` : ""}${landed ? "" : " (recorded on the item; no linked cell)"}`,
      ent.name,
    );
    toast(landed ? "Value updated — the workbook will carry it on the next generate" : "Edit recorded on the exception", "ok");
  },

  restoreReviewItem(entityId: string, id: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const item = ent.reviewItems.find((r) => r.id === id);
    if (!item) return;
    // An edited item reverts its value along with its sign-off.
    let extraWrites = ent.extraWrites;
    if (item.resolution === "edited" && item.priorValue !== undefined) {
      extraWrites = ent.extraWrites.map((w) => (w.reviewId === id ? { ...w, value: item.priorValue as string | number } : w));
    }
    updateEntity(entityId, {
      extraWrites,
      reviewItems: ent.reviewItems.map((r) =>
        r.id === id
          ? { ...r, dismissed: false, dismissedNote: "", resolution: undefined, editedValue: undefined, priorValue: undefined }
          : r,
      ),
    });
    logEvent(
      item.resolution === "edited" ? "Review item restored — edited value reverted" : "Review item restored",
      item.message.slice(0, 160),
      ent.name,
    );
  },

  async processEntity(entityId: string) {
    /* OCR runs BEFORE processing, never after it. The layer holds a gate per
       entity while a scan is being read; a run that starts now would read
       the un-OCR'd bytes, book nothing from them, and have to be repeated.
       So wait — visibly, the button shows "Processing…" — and read the
       entity again afterwards, because the gate's work replaces files. */
    {
      const gate = (globalThis as unknown as { EN9OCRGATE?: { pending?: (id: string) => boolean; wait?: (id: string) => Promise<unknown> } }).EN9OCRGATE;
      if (gate && typeof gate.pending === "function" && typeof gate.wait === "function" && gate.pending(entityId)) {
        updateEntity(entityId, { status: "processing", progress: -1 });
        toast("OCR is still reading this entity's scanned pages — processing starts when it finishes", "");
        try {
          await gate.wait(entityId);
        } catch (e) {
          updateEntity(entityId, { status: "idle" });
          toast(`OCR did not finish: ${(e as Error).message} — processing was not started`, "bad");
          return;
        }
      }
    }
    const start = state.entities.find((e) => e.id === entityId);
    if (!start) return;
    if (!start.files.length) { toast("Add at least one document first", "bad"); return; }

    logEvent("Processing started", `${start.files.length} document(s)`, start.name);
    // The CURRENT document set is the single source of truth: auto-derived
    // data whose source document is gone is pruned before re-detection.
    {
      const pruned = pruneRemovedDocData(start);
      if (pruned) {
        updateEntity(entityId, pruned);
        logEvent("Stale document data cleared", "values sourced from removed documents were reset before re-processing", start.name, "system");
      }
    }
    // A re-run starts clean: mapped lines, provenance and review state rebuild.
    // Snapshot what the wipe destroys so a mid-run failure can restore it,
    // and so sign-offs survive a re-process.
    const before = {
      lines: start.lines, relabels: start.relabels, sourceLabels: start.sourceLabels,
      contributions: start.contributions, unmatched: start.unmatched,
      reviewItems: start.reviewItems, extraWrites: start.extraWrites,
      dividends: start.dividends, docClasses: start.docClasses,
      unmatchedProfile: start.unmatchedProfile || [],
    };
    updateEntity(entityId, {
      status: "processing", progress: 0, log: [],
      lines: {}, relabels: {}, sourceLabels: {}, contributions: {}, unmatched: [],
      unmatchedProfile: [],
      reviewItems: [], extraWrites: [], dividends: [], docClasses: {},
    });
    const log: string[] = [];
    const bundles: { file: EntityFile; parsed: ParsedDoc; cls: DocClass }[] = [];
    const mapRows: MapRow[] = [];
    /* Rows read from pages that carry figures but name no statement section.
       They are never booked; they join the unmatched list in step 3 so the
       preparer can see every figure the tool read. */
    const looseRows: Entity["unmatched"] = [];
    /* A numbered-box return that states the balance sheet only as totals.
       Those rows are booked only when no statement itemises the balance
       sheet (decided in step 3, once every document has been read). */
    const formBsRows: { rows: MapRow[]; note: string; docId: string; docName: string }[] = [];
    const formResults: NonNullable<Entity["formResults"]> = [];
    /* English read off the terminology table for captions that carried none.
       Written before mapping, so the rules, the review items, the provenance
       sheet and the preparer all see the same English. */
    const termTranslations: Record<string, string> = {};
    const profileGrids: { rows: string[][]; doc: string }[] = [];
    const review: ReviewItem[] = [];
    let caseYears: { cy: number | null; py: number | null } = { cy: null, py: null };
    let equity: EquityFacts | null = null;
    let ato: AtoFacts = {};
    let cf: CarryForward | null = null;
    let cfSource = "";
    /* The prior return is only an opening balance if it CLOSES where this work
       paper OPENS. A FY2023 filing does not open FY2025, and seeding from one
       silently backdates the whole of column (a) by a year. */
    let cfStale = false;
    /* The shareholder register as the CURRENT year's accounts state it. It
       outranks the prior return's Schedule B Part II, which is a year or more
       old -- see directoryShareholders. */
    let directory: DirectoryHolder[] = [];
    let directorySource = "";
    /** The directors the accounts name, for Item H. */
    let directors: string[] = [];
    let nameMismatch: Entity["nameMismatch"] = null;
    // Every 5471 block found across the prior-year documents. Exactly one
    // feeds THIS entity; the remaining named blocks fan out to siblings.
    const cfCandidates: CfCandidate[] = [];
    let siblingPlans: CfCandidate[] = [];
    let ledger: LedgerSummary | null = null;
    let questionnaire: Questionnaire | null = null;
    let salary: SalarySchedule | null = null;

    const rv = (item: Omit<ReviewItem, "id"> & { id?: string }) => {
      if (!review.some((r) => item.id && r.id === item.id)) review.push({ ...item, id: item.id || uid() });
    };

    try {
    for (let step = 0; step < PROCESS_STEPS.length; step++) {
      updateEntity(entityId, { progress: step });
      await new Promise((r) => setTimeout(r, 220));

      /* Step 1 — read and classify every document; mark duplicates. */
      if (step === 1) {
        const ent = state.entities.find((e) => e.id === entityId);
        if (!ent) return;   // removed mid-run
        const parsedByFile = new Map<string, ParsedDoc>();
        const sheetNamesSeen: Record<string, string[]> = {};
        /* Documents that turned out to be scans. The OCR card in the layer
           reads this and offers to run OCR on them; it is a plain global
           because the layer is outside the bundle. Reset per entity at the
           start of the run, or a document fixed by OCR would still be queued
           on the next pass. */
        queueScans(entityId, null);
        for (const f of ent.files) {
          // An OCR'd document's notice and disputed readings are raised
          // whether or not the copy reads cleanly below: a page no engine
          // could read must block even when the file itself fails to open.
          for (const item of ocrReviewItems(f)) rv(item);
          try {
            const parsed = await readDocument(f.blob, { sheets: ent.docKindOverrides?.[f.id]?.sheets });
            if (!parsed) {
              // Honesty over hope: there is no AI-extraction path. And the
              // explanation is per-extension, because "unsupported format"
              // sent preparers to convert files that were already supported.
              // A PDF the reader opened but found no text in is a scan, and
              // OCR is the remedy. One that is ALREADY an OCR output is not:
              // re-running would loop on a file OCR has already failed to fix.
              if (/\.pdf$/i.test(f.name) && !/\(OCR\)\.pdf$/i.test(f.name)) queueScans(entityId, { id: f.id, name: f.name });
              const why = explainUnreadable(f.name);
              log.push(`${f.name}: could not be read — ${why}`);
              rv({
                id: `doc-unreadable-${f.id}`,
                level: "warn", category: "process",
                message: `${f.name} could not be read, so NOTHING from it feeds the work paper. ${why}`,
                source: f.name,
              });
              continue;
            }
            const cls = classifyParsedDoc(f.id, f.name, parsed);
            // Manual type override wins over the rules — the preparer said
            // what this document is; unclassified PDF pages follow the hint.
            const ov = ent.docKindOverrides?.[f.id];
            if (ov?.kind) {
              cls.kind = ov.kind;
              cls.confidence = 1;
              cls.method = "user";
              if (ov.pageHint) {
                cls.pages = cls.pages.map((p) => (p.kind === "unknown" ? { ...p, kind: ov.pageHint!, score: 1 } : p));
              }
              log.push(`${f.name}: document type set manually → ${ov.kind}${ov.pageHint ? ` (${ov.pageHint})` : ""}`);
            }
            if (parsed.sheetNames?.length && !sameList(f.sheetNames, parsed.sheetNames)) {
              sheetNamesSeen[f.id] = parsed.sheetNames;
            }
            if (parsed.sheetsSkipped?.length) {
              log.push(`${f.name}: read ${parsed.sheetsUsed!.join(", ")}; skipped ${parsed.sheetsSkipped.join(", ")}`);
              rv({
                id: `sheets-skipped-${f.id}`, level: "info", category: "process",
                message: `${f.name} has ${(parsed.sheetsUsed!.length + parsed.sheetsSkipped.length)} worksheets; ${parsed.sheetsUsed!.join(", ")} ${parsed.sheetsUsed!.length === 1 ? "was" : "were"} read and ${parsed.sheetsSkipped.join(", ")} ${parsed.sheetsSkipped.length === 1 ? "was" : "were"} skipped as non-statement tabs. If a skipped tab holds figures, name the tabs to read in Document intake and re-process.`,
                source: f.name,
              });
            }
            bundles.push({ file: f, parsed, cls });
            parsedByFile.set(f.id, parsed);
          } catch (err) {
            /* A PDF with no text layer throws from the reader rather than
               returning null, and it is the commonest failure of all — a
               scan. It gets the same per-extension explanation, and the
               message is preserved so a genuinely different failure (a
               corrupt zip, say) is not misreported as a scan. */
            const msg = (err as Error).message;
            // The other path to the same conclusion: pdfToDoc throws rather
            // than returning null when the page carries no text layer.
            if (/no text layer/i.test(String(msg)) && !/\(OCR\)\.pdf$/i.test(f.name)) {
              queueScans(entityId, { id: f.id, name: f.name });
            }
            log.push(`${f.name}: could not be read (${msg})`);
            rv({
              id: `doc-unreadable-${f.id}`,
              level: "warn", category: "process",
              message: `${f.name} could not be read, so NOTHING from it feeds the work paper. ${/no text layer/i.test(msg) ? explainUnreadable(f.name) : msg}`,
              source: f.name,
            });
          }
        }
        markDuplicates(bundles.map((b) => b.cls), parsedByFile);
        /* The preparer's year end wins over the documents. A work paper is
           prepared FOR a year; the documents are evidence about it. */
        const entNow = state.entities.find((e) => e.id === entityId);
        const derived = entNow
          ? resolveCaseYears({ ...entNow, docClasses: Object.fromEntries(bundles.map((b) => [b.cls.fileId, b.cls])) } as Entity)
          : { ...deriveCaseYears(bundles.map((b) => b.cls)), source: "documents" as const, detected: [] as number[] };
        caseYears = { cy: derived.cy, py: derived.py };
        log.push(`Work paper year: ${caseYearReason(derived as CaseYears)}`);
        if (derived.source === "selected" && derived.dissent.length) {
          rv({
            id: "case-year-selected", level: "info", category: "consistency",
            message: `This work paper is being prepared for ${derived.cy}, as entered in Basic Information. The documents report on ${derived.detected.join(", ")}: the ${derived.cy} column is booked as the current year and ${derived.py} as the opening column. Any other year in them is reference only. Clear the year end in Basic Information to let the documents decide again.`,
            target: `${SHEET.basic}!B1`,
          });
        } else if (derived.dissent.length) {
          rv({
            id: "case-year-dissent", level: "warn", category: "consistency",
            message: `Documents report on different years: ${derived.cy} was taken as the case year; ${derived.dissent.join(", ")} document(s) were treated as reference material. Enter the year end in Basic Information to choose the year yourself.`,
          });
        }
        for (const b of bundles) {
          log.push(`${b.file.name}: classified as ${b.cls.kind}${b.cls.statementYear ? ` (${b.cls.statementYear})` : ""}${b.cls.duplicateOf ? " — duplicate, excluded" : ""}`);
          for (const n of b.cls.notes) {
            // Keyed on the note text, not its position: a note added to the
            // classifier later must not renumber the ones already signed off.
            rv({
              id: `doc-note-${b.file.id}-${norm(n.message).slice(0, 40)}`,
              level: n.level, category: "process", message: n.message, source: b.file.name,
            });
          }
          if (b.cls.kind === "unknown" && !b.cls.duplicateOf) {
            /* A document that carried FIGURES and could not be identified is
               not a warning. Nothing from it reached the work paper, and a
               warning in a long list is how that goes unnoticed: the numbers
               were there to be read and the work paper was produced without
               them. A document with no figures at all (a cover letter, terms
               and conditions) stays a warning — there is nothing to lose. */
            const hasFigures = (b.cls.amountRows || 0) > 0;
            rv({
              id: `doc-unclassified-${b.file.id}`,
              level: hasFigures ? "block" : "warn", category: "process",
              message: hasFigures
                ? `${b.file.name} was READ (${(b.cls.textChars || 0).toLocaleString()} characters, ${(b.cls.amountRows || 0).toLocaleString()} line(s) carrying figures) but could not be identified, so NOTHING from it reached the work paper. Set its document type in Document intake (Type column) and re-process, or assign its rows in Review — they are listed there unassigned.`
                : `${b.file.name} could not be classified and fed NOTHING into the work paper. It carries no figures, so nothing is missing from the schedules. Set its document type in Document intake (Type column) if it should feed something.`,
              source: b.file.name,
            });
          }
          if (b.cls.kind === "prior-year-us-return" && caseYears.cy && b.cls.statementYear === caseYears.cy) {
            rv({
              id: `doc-current-year-return-${b.file.id}`,
              level: "warn", category: "consistency",
              message: `${b.file.name} is a US return for the CURRENT year (${caseYears.cy}) — expected a prior-year reference copy. Its carry-forward figures were NOT used.`,
              source: b.file.name,
            });
          }
        }
        if (bundles.some((b) => b.cls.pages.some((p) => p.kind === "us-1120"))) {
          rv({
            id: "excl-1120", level: "info", category: "process",
            message: "The US parent's Form 1120 (and 5472/8992) pages were recognized and excluded — none of the parent's figures feed this work paper.",
          });
        }
        set({ usage: { ...state.usage, docs: state.usage.docs + ent.files.length } });
        updateEntity(entityId, {
          log: [...log],
          docClasses: Object.fromEntries(bundles.map((b) => [b.file.id, b.cls])),
          ...(Object.keys(sheetNamesSeen).length
            ? { files: ent.files.map((f) => (sheetNamesSeen[f.id] ? { ...f, sheetNames: sheetNamesSeen[f.id] } : f)) }
            : {}),
        });
      }

      /* Step 2 — extract rows per feed policy; run the special modules. */
      if (step === 2) {
        /* Documents whose pages were all kept for another corporation. They
           are not failures here, so the zero-rows warning below passes over
           them: the entity-scope item already explains where they went. */
        const scopedOutDocs = new Set<string>();
        /* ---- who this pile of paper is about ----

           Entities are one source of names; the DOCUMENTS are the other, and
           for a client with no US return they are the only one. Two companies
           in one pile used to be added together whenever the case held a
           single entity, because attribution was switched on by the entity
           count. It is switched on by the paper now.

           One company named throughout is never held back, whatever the
           entity is called: an entity named "Client 1" is a naming question,
           not a contamination risk. */
        /* One company whose statements print another name (see
           booksNameAlias): both names are this entity's, so neither is a
           company without an entity. Names the preparer confirmed as the same
           company count the same way. */
        const meScope = state.entities.find((e) => e.id === entityId);
        const booksAlias = meScope ? booksNameAlias(
          bundles.map((b) => b.cls),
          state.entities.filter((e) => e.id !== entityId).map((e) => e.profile.legalName || e.name),
          meScope.nameDecision,
        ) : null;
        if (booksAlias && !meScope?.nameDecision) {
          log.push(`"${booksAlias.alias}" read as the books name of ${booksAlias.cfcName} — the prior return's only Form 5471 — so its statements feed this work paper; confirm the legal name when asked`);
          rv({
            id: "entity-books-name", level: "warn", category: "entity-scope",
            message: `The statements are printed under "${booksAlias.alias}", and the prior-year return's only Form 5471 is for "${booksAlias.cfcName}". One Form 5471 and one other name on the books is one company keeping its accounts under a trading, LLC or bookkeeping name — not a second foreign corporation — so the statements were used for this work paper. Confirm the legal name (the question in Review) before generating; answer "different company" if they are not the same.`,
            source: booksAlias.alias,
          });
        }
        const namesOf = (e: Entity) => [e.profile.legalName || e.name, ...(e.nameAliases || []),
          ...(e.id === entityId && booksAlias ? [booksAlias.alias, booksAlias.cfcName] : [])]
          .map((n) => String(n || "").trim())
          .filter((n, i, a) => n && !/^entity \d+$/i.test(n) && a.indexOf(n) === i);
        const entityScope = state.entities
          .map((e) => {
            const names = namesOf(e);
            return { key: e.id, nm: names[0] || "", names, vars: [...new Set(names.flatMap((n) => entityNameVariants(n)))], entity: true };
          })
          .filter((e) => e.vars.length);
        const docCompanies: { key: string; nm: string; names: string[]; vars: string[]; entity: boolean }[] = [];
        for (const b of bundles) {
          const nm = b.cls.entityName;
          if (!nm || b.cls.duplicateOf) continue;
          if (entityScope.some((e) => e.names.some((n) => entitySimilarity(n, nm) >= 0.5))) continue;
          if (docCompanies.some((d) => entitySimilarity(d.nm, nm) >= 0.5)) continue;
          const vars = entityNameVariants(nm);
          if (vars.length) docCompanies.push({ key: `doc:${vars[0]}`, nm, names: [nm], vars, entity: false });
        }
        /* A heading with no legal form is a CANDIDATE, not a name. It may
           take part in attribution only once the case is already known to
           hold more than one company — there the risk is two companies added
           together, and the candidate is the only evidence which pages belong
           to whom. With a single company in the papers a candidate can only
           do harm: an entity the preparer called "Client 1" would have its
           own statements held back on the strength of a guess. */
        if (entityScope.length + docCompanies.length >= 2) {
          for (const b of bundles) {
            const nm = b.cls.entityNameGuess;
            if (!nm || b.cls.duplicateOf || b.cls.entityName) continue;
            if (entityScope.some((e) => e.names.some((n) => entitySimilarity(n, nm) >= 0.5))) continue;
            if (docCompanies.some((d) => entitySimilarity(d.nm, nm) >= 0.5)) continue;
            const vars = entityNameVariants(nm);
            if (vars.length) docCompanies.push({ key: `doc:${vars[0]}`, nm, names: [nm], vars, entity: false });
          }
        }
        const namedCompanies = entityScope.length + docCompanies.length;
        const companyScope = namedCompanies > 1 ? [...entityScope, ...docCompanies] : [];
        /* One company, and it is not the entity's name. Nothing is held back —
           the preparer is told, and decides. */
        if (namedCompanies === 1 && docCompanies.length === 1) {
          const me = state.entities.find((e) => e.id === entityId);
          /* An entity still carrying the default "Entity 1" takes its legal
             name from the prior return later in the run (the header follows
             it), so with a prior return present there is nothing to say. */
          if (!(me && /^entity\s+\d+$/i.test(me.name.trim()) && !String(me.profile.legalName || "").trim()
            && bundles.some((b) => b.cls.kind === "prior-year-us-return" && !b.cls.duplicateOf))) rv({
            id: `entity-name-differs-${entityId}`,
            level: "warn", category: "entity-scope",
            message: `Every document in this entity names "${docCompanies[0].nm}", but the entity is called "${me ? (me.profile.legalName || me.name) : "this entity"}". The documents were used, because only one company is named in the papers. Set the legal name in Basic Information if they are the same company, or move the documents if they are not.`,
            source: docCompanies[0].nm,
          });
        }
        /* A company the papers name that has no entity: its pages are held
           back rather than folded into somebody else's work paper. */
        const companiesWithoutEntity = new Map<string, string>(docCompanies.map((d) => [d.key, d.nm]));
        for (const b of bundles) {
          if (b.cls.duplicateOf) continue;
          const { parsed, cls, file } = b;
          let read = 0;
          if (parsed.pdf) {
            /* A statement printed as two facing panels — assets down the left,
               liabilities and equity down the right — is re-cut into one
               column of rows per panel before anything else reads it. Left
               unsplit, every liability on the page is swallowed as a second
               period column of the asset printed beside it. Pages that are not
               printed that way come back untouched. */
            const pdf = splitSidePanels(parsed.pdf);
            /* "Current Year / Prior Year" headers become real years here, or
               are dropped when the engagement's years are still unknown. */
            const rulers = resolveWordRulers(detectRulers(pdf), caseYears);
            /* "Periodo | % | Acumulado | %" — figure columns named by what
               they measure rather than by a year. */
            const periodRulers = detectPeriodRulers(pdf);
            /* Page attribution runs before any feed is read, so a page that
               names another company never reaches the rules. */
            const scopeEnts = companyScope;
            /* The document says whose it is, and that outranks reading the
               letterhead page by page. A form prints the registry's wording
               ("CORP EDUCACIONAL CHARLIE BRAWN") while the entity carries the
               filing's ("CORPORACION EDUCACIONAL CHARLIE BRAWN LIMITADA"):
               the same company, and no substring of the page matches the
               entity's name, so page attribution alone left every page
               unowned and both companies were read into both work papers.
               Names are compared the way they are compared everywhere else. */
            const docOwner = cls.entityName
              ? companyScope.find((c) => c.names.some((n) => entitySimilarity(n, cls.entityName as string) >= 0.5)) || null
              : null;
            const pageOwner = companyScope.length > 1
              ? (docOwner
                ? new Map<number, string | null>(cls.pages.map((p) => [p.page, docOwner.key]))
                : attributePagesToEntities(parsed.pdf, companyScope))
              : new Map<number, string | null>();
            const excludedPages = new Map<number, string>();
            const ownPages = (pages: Set<number>): Set<number> => {
              const keep = new Set<number>();
              for (const p of pages) {
                const owner = pageOwner.get(p) ?? null;
                if (owner === null || owner === entityId) keep.add(p);
                else excludedPages.set(p, owner);
              }
              return keep;
            };
            const isPages = ownPages(pagesForFeed(cls, "generic-is"));
            const bsPages = ownPages(pagesForFeed(cls, "generic-bs"));
            /* Held apart until the section banners have been read: a page can
               hold the end of the P&L and the start of the balance sheet, and
               classification only gets one answer for the whole page. The
               banners are the statement's own account of which is which. */
            let pdfIs: MapRow[] = [];
            let pdfBs: MapRow[] = [];
            /* A statement that runs over a page break prints its header once,
               so a continuation page is ruled by the header above it — within
               its own feed only. */
            for (const row of isPages.size ? extractPositionedRows(pdf, rulers, { pages: isPages, inheritRulerFrom: inheritRulers(rulers, isPages), periodRulers }) : []) {
              pdfIs.push({ row, docId: file.id, docName: file.name, feed: "is", kind: "pdf", x0: row.x0 });
            }
            for (const row of bsPages.size ? extractPositionedRows(pdf, rulers, { pages: bsPages, inheritRulerFrom: inheritRulers(rulers, bsPages), periodRulers }) : []) {
              pdfBs.push({ row, docId: file.id, docName: file.name, feed: "bs", kind: "pdf", x0: row.x0 });
            }
            /* The notes are not booked -- they restate what the face already
               carries -- but they say what the face's captions MEAN. Two uses,
               both of which have to prove their arithmetic against the note's
               own total before anything moves: a note holding exactly one
               thing renames the face caption to that thing, and the fixed
               asset note supplies the cost and accumulated depreciation that
               Schedule F lines 9a and 9b need and the face never prints. */
            if (!directory.length && cls.kind === "cfc-financial-statements") {
              const found = directoryShareholders(parsed.pdf.rows.map((r) => ({ page: r.page, cells: r.cells.map((c) => c.text) })));
              if (found.length) { directory = found; directorySource = file.name; }
              const dirRows = parsed.pdf.rows.map((r) => ({ page: r.page, cells: r.cells.map((c) => c.text) }));
              if (!directors.length) directors = directoryDirectors(dirRows);
            }
            const notePages = new Set((cls.pages || []).filter((p) => p.kind === "fs-notes").map((p) => p.page));
            const notes = notePages.size
              ? statementNotes(extractPositionedRows(pdf, rulers, { pages: notePages }))
              : [];
            const lookthrough = notes.length ? noteLookthrough(notes) : new Map<string, string>();
            if (lookthrough.size) {
              const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
              let renamed = 0;
              for (const m of pdfBs) {
                const to = lookthrough.get(key(String(m.row.label || "")));
                if (!to) continue;
                m.row = { ...m.row, label: to };
                renamed++;
              }
              if (renamed) {
                log.push(`${file.name}: ${renamed} balance-sheet caption(s) resolved through their own note (for example "Other Non Current Assets" is the note's "Intangible Assets")`);
              }
            }
            const fixedAssets = (notes.length ? fixedAssetSplit(notes) : null)
              || (notePages.size ? movementFixedAssetSplit(pdf, notePages) : null);
            if (fixedAssets) {
              /* The face carries the fixed asset NET; Schedule F wants cost on
                 9a and accumulated depreciation on 9b. Rather than plumb the
                 split past the mapper, rewrite the evidence: the face row
                 becomes the cost, and the depreciation the face never printed
                 is added as a row of its own, which the existing
                 "accumulated depreciation" rule already books to 9b.

                 Only a face row whose OWN figures equal the note's total is
                 touched. That is the proof the two are the same asset, and
                 without it a note could overwrite an unrelated line. */
              /* Compare the LAST columns, not the whole row: a balance sheet
                 that cross-references its notes prints the note number first,
                 so the face row reads [4, 23,353, 28,667] and only the tail is
                 the money. The same slice is what gets rewritten, so the note
                 reference survives. */
              const tailSame = (a: number[], b: number[]) =>
                a.length >= b.length && b.every((v, i) => Math.abs(a[a.length - b.length + i] - v) <= Math.max(0.02, 1));
              const host = pdfBs.find((m) => tailSame(m.row.values || [], fixedAssets.net));
              if (host) {
                const page = host.row.page;
                const lead = (host.row.values || []).slice(0, (host.row.values || []).length - fixedAssets.net.length);
                host.row = { ...host.row, values: [...lead, ...fixedAssets.cost] };
                /* Immediately after its host, not at the end: the row has to
                   sit under the same section banner as the asset it depreciates.
                   Appended, it landed below the Equity banner and the
                   liabilities-side veto threw it away. */
                pdfBs.splice(pdfBs.indexOf(host) + 1, 0, {
                  row: { label: "Accumulated depreciation", values: [...lead, ...fixedAssets.accumDep.map((v) => -Math.abs(v))],
                         page, years: host.row.years ? host.row.years.slice() : undefined, x0: host.row.x0 },
                  docId: file.id, docName: file.name, feed: "bs", kind: "pdf", x0: host.x0,
                  section: host.section,
                });
                log.push(`${file.name}: the fixed asset note supplied cost ${fixedAssets.cost.join(" / ")} and accumulated depreciation ${fixedAssets.accumDep.join(" / ")}, which the balance sheet prints only as the net ${fixedAssets.net.join(" / ")} — Schedule F lines 9a and 9b need the split`);
              }
            }
            /* Page furniture goes FIRST, before anything reads the banners.
               A multi-page statement repeats its own title at the top of every
               continuation page, and that title IS a section banner ("Statement
               of Financial Performance" -> income). Tagging before the drop let
               the running header reset the section at every page break, so a
               P&L that ran onto a second page had its remaining expenses booked
               as income — 326,669 of them on one 2025 file. structRows drops the
               same rows a few lines below; doing it here as well costs nothing
               (the second pass finds nothing left to drop) and stops the header
               being read as structure by anything downstream. */
            pdfIs = dropFurniture(pdfIs);
            pdfBs = dropFurniture(pdfBs);
            pdfIs = tagSections(pdfIs);
            pdfBs = tagSections(pdfBs);
            // A page that reconciles one account's movements is not a balance
            // sheet, however much its captions read like one.
            pdfBs = dropMovementSchedules(pdfBs);
            const refed = refeedBySection(pdfIs, pdfBs);
            pdfIs = refed.is;
            pdfBs = refed.bs;
            if (refed.moved) {
              log.push(`${file.name}: ${refed.moved} row(s) re-routed between the P&L and balance-sheet pipelines by their statement section banners`);
            }
            pdfIs = structRows(pdfIs);
            pdfBs = structRows(pdfBs);
            pdfIs = sameIndentSubtotals(pdfIs);
            pdfBs = sameIndentSubtotals(pdfBs);
            // A row the statement's own printed total leaves out (see sections.ts).
            pdfIs = outsidePrintedTotal(pdfIs);
            pdfBs = outsidePrintedTotal(pdfBs);
            // A section heading carrying the section's whole figure with
            // nothing itemised beneath it (QuickBooks' summary layout).
            pdfIs = collapsedSections(pdfIs);
            pdfBs = collapsedSections(pdfBs);
            {
              // Pages titled "Detailed Profit and Loss Account" (title in the
              // first few lines of the page) restate the face P&L in detail.
              const detailPages = new Set<number>();
              const firstRows = new Map<number, number>();
              for (const r of pdf.rows) {
                const n = firstRows.get(r.page) || 0;
                if (n >= 4) continue;
                firstRows.set(r.page, n + 1);
                if (isPages.has(r.page) && DETAIL_PNL_TITLE.test(r.cells.map((c) => c.text).join(" "))) detailPages.add(r.page);
              }
              const sup = supplementaryDetailPages(pdfIs, detailPages);
              if (sup.dropped) {
                pdfIs = sup.rows;
                log.push(`${file.name}: the detailed profit and loss account (page${detailPages.size > 1 ? "s" : ""} ${[...detailPages].join(", ")}) restates the profit and loss account line by line — ${sup.dropped} row(s) set aside so nothing is booked twice; the face statement is booked`);
              }
            }
            let skipped = 0;
            for (const m of [...pdfIs, ...pdfBs]) {
              if (m.skipReason) skipped++;
              else read++;
              mapRows.push(m);
            }
            if (skipped) log.push(`${file.name}: ${skipped} structural subtotal/total row(s) dropped before mapping`);
            const eqPages = ownPages(pagesForFeed(cls, "equity"));
            if (eqPages.size && !equity) equity = pullEquityFacts(parsed.pdf, eqPages, resolveWordRulers(detectRulers(parsed.pdf), caseYears), caseYears.cy);
            const atoPages = ownPages(pagesForFeed(cls, "targeted-ato"));
            if (atoPages.size) ato = { ...pullAtoFacts(parsed.pdf, atoPages), ...ato };
            const cfPages = pagesForFeed(cls, "carry-forward");
            if (cfPages.size && !(caseYears.cy && cls.statementYear === caseYears.cy)) {
              for (const { block, cf: candidate } of extractCarryForwards(cls, parsed)) {
                cfCandidates.push({
                  cf: candidate,
                  source: file.name,
                  fileId: file.id,
                  blockIndex: block.index,
                  pageCount: block.pages.length,
                  cfcName: block.cfcName || candidate.cfcName || "",
                  refIds: [...new Set([...block.referenceIds, ...candidate.referenceIds])],
                  statementYear: cls.statementYear,
                });
              }
            }
            const profilePages = ownPages(pagesForFeed(cls, "profile"));
            if (profilePages.size) {
              profileGrids.push({ rows: parsed.pdf.rows.filter((r) => profilePages.has(r.page)).map((r) => r.cells.map((c) => c.text)), doc: file.name });
            }
            /* The client questionnaire, sent as a PDF. The spreadsheet branch
               below has read it for as long as the questionnaire has existed;
               sent as a PDF the same document reached nothing at all. */
            if (cls.kind === "client-questionnaire" && !questionnaire) {
              const qGrid = parsed.pdf.rows.filter((r) => profilePages.has(r.page)).map((r) => r.cells.map((c) => c.text));
              const q = parseQuestionnaire(qGrid, file.name);
              if (q) {
                questionnaire = q;
                log.push(`${file.name}: client questionnaire (PDF) — ${[
                  q.roles ? `roles "${q.roles}"` : "",
                  q.wagesReceived !== undefined ? `wages received ${q.wagesReceived.toLocaleString()}` : "",
                  q.additionalHolders.length ? `${q.additionalHolders.length} additional shareholder(s)` : "",
                ].filter(Boolean).join(", ") || "no answers read"}`);
              }
            }
            /* A numbered-box tax return. Its figures are not on its rows —
               the caption is printed on one line and the box code and amount
               on the next — so the pairs the geometry rebuilds ARE the
               document, and reading the page instead would read nothing.
               Income and expense boxes only: a return states balance-sheet
               totals that a statement itemises, and those are offered in
               Review rather than booked. */
            const boxedPages = ownPages(pagesForFeed(cls, "boxed-form"));
            const boxedText = boxedPages.size
              ? parsed.pdf.rows.filter((r) => boxedPages.has(r.page)).map((r) => r.cells.map((c) => c.text).join(" ")).join("\n") : "";
            const formSpec = boxedPages.size ? boxedFormSpec(boxedText) : null;
            if (formSpec) {
              /* A return the tool knows by its box codes: every figure is
                 placed by its CODE, never by its caption and never by the AI.
                 Boxes outside the table (tax registers, credits, identification)
                 are listed for the preparer and booked nowhere. */
              const boxes = boxedFormCodes(parsed.pdf).filter((b) => boxedPages.has(b.page));
              const byCode = new Map(boxes.map((b) => [b.code, b]));
              const amt = (code: string): number | null => {
                const b = byCode.get(code);
                return b ? numericCell(b.value, { dotThousands: true }) : null;
              };
              const firstOf = (codes: string[]) => {
                for (const c of codes) { const v = amt(c); if (v !== null) return { code: c, value: v }; }
                return null;
              };
              const boxLabel = (code: string) => byCode.get(code)?.caption || `${formSpec.name} box ${code}`;
              const used = new Set<string>();
              let bookedBoxes = 0;
              for (const b of boxes) {
                const t = formSpec.book[b.code];
                if (!t) continue;
                used.add(b.code);
                const v = amt(b.code);
                if (v === null || v === 0) continue;
                mapRows.push({
                  row: { label: boxLabel(b.code), values: [v], page: b.page }, docId: file.id, docName: file.name,
                  feed: "is", kind: "grid", formTarget: t, formCode: b.code,
                });
                const en = translateCaption(boxLabel(b.code));
                if (en) termTranslations[boxLabel(b.code)] = en;
                bookedBoxes++; read++;
              }
              /* Balance-sheet totals. Assets split into the parts the return
                 names (bank balance, fixed assets) and the rest; liabilities as
                 one total; capital as stated; retained earnings is what is left.
                 Booked only when no statement itemises the balance sheet. */
              const bal = formSpec.balance;
              const totA = firstOf(bal.totalAssets);
              if (totA) {
                const cash = firstOf(bal.cash), fixed = firstOf(bal.fixedAssets);
                const liab = firstOf(bal.totalLiabilities), cap = firstOf(bal.capital), eq = firstOf(bal.equity);
                for (const x of [totA, cash, fixed, liab, cap, eq]) if (x) used.add(x.code);
                const rows: MapRow[] = [];
                const bsRow = (label: string, v: number, target: string, code: string) => rows.push({
                  row: { label, values: [r2(v)], page: byCode.get(code)?.page }, docId: file.id, docName: file.name,
                  feed: "bs", kind: "grid", formTarget: target, formCode: code,
                });
                if (cash && cash.value) bsRow(boxLabel(cash.code), cash.value, "BS:10", cash.code);
                if (fixed && fixed.value) bsRow(boxLabel(fixed.code), fixed.value, "BS:28", fixed.code);
                const rest = r2(totA.value - (cash?.value || 0) - (fixed?.value || 0));
                if (Math.abs(rest) >= 1) bsRow(`${boxLabel(totA.code)} — not itemised on the return`, rest, "BS:39", totA.code);
                if (liab && liab.value) bsRow(boxLabel(liab.code), liab.value, "BS:OL", liab.code);
                if (cap && cap.value) bsRow(boxLabel(cap.code), cap.value, "BS:59", cap.code);
                const reBal = r2(totA.value - (liab?.value || 0) - (cap?.value || 0));
                if (Math.abs(reBal) >= 1) bsRow(`Retained earnings — balancing figure (${formSpec.name} total assets less liabilities and capital)`, reBal, "BS:61", totA.code);
                const eqBook = r2(totA.value - (liab?.value || 0));
                formBsRows.push({ rows, docId: file.id, docName: file.name, note: `${file.name} (${formSpec.name}) states the balance sheet only as totals: total assets ${totA.value.toLocaleString()} (box ${totA.code})${liab ? `, total liabilities ${liab.value.toLocaleString()} (box ${liab.code})` : ""}${cap ? `, capital ${cap.value.toLocaleString()} (box ${cap.code})` : ""}. With no itemised balance sheet among the documents, Schedule F was booked at total level: ${cash ? `bank balance to line 1, ` : ""}${fixed ? `fixed assets to line 9a, ` : ""}the rest of the assets to line 13, liabilities to line 19${cap ? `, capital to line 20b` : ""} and retained earnings as the balancing figure.${eq && Math.abs(eq.value - eqBook) >= 1 ? ` The return's own equity figure (box ${eq.code}) is ${eq.value.toLocaleString()}, not the ${eqBook.toLocaleString()} its totals imply — confirm which is right.` : ""} Request the detailed balance sheet (trial balance) from the client and re-process to itemise it.` });
              }
              /* The year's distributions. */
              const dist = firstOf(formSpec.distributions);
              if (dist) used.add(dist.code);
              if (dist && dist.value > 0 && !equity?.dividendsCY) {
                equity = { ...(equity || { openingCY: null, profitCY: null, closingCY: null }), dividendsCY: dist.value };
                log.push(`${file.name}: distributions of ${dist.value.toLocaleString()} read from box ${dist.code}`);
                rv({
                  id: `form-distributions-${file.id}`, level: "warn", category: "mapping", applied: true,
                  sourceLabel: boxLabel(dist.code),
                  message: `${file.name} (${formSpec.name}) reports distributions — withdrawals, remittances or dividends — of ${dist.value.toLocaleString()} in box ${dist.code}. They were booked as the year's dividends: the Dividends tab, Schedule J line 9, Schedule M and Schedule R. If they were withdrawals charged to the shareholders' current accounts rather than distributions, change them on the Dividends tab.`,
                  source: file.name,
                });
              }
              /* The year's result as the return states it, before income tax. */
              for (const alt of formSpec.result) {
                const codes = [...alt.add, ...alt.sub];
                if (!codes.every((c) => amt(c) !== null)) continue;
                const value = r2(alt.add.reduce((n, c) => n + (amt(c) as number), 0) - alt.sub.reduce((n, c) => n + (amt(c) as number), 0));
                formResults.push({ label: `${formSpec.name} result (${alt.add.map((c) => `box ${c}`).join(" + ")}${alt.sub.map((c) => ` − box ${c}`).join("")})`, value, docName: file.name });
                codes.forEach((c) => used.add(c));
                break;
              }
              const unbooked = boxes.filter((b) => !used.has(b.code) && numericCell(b.value, { dotThousands: true }));
              log.push(`${file.name}: ${formSpec.name} read by box code — ${bookedBoxes} income/expense box(es) booked, ${unbooked.length} register or memo box(es) not booked`);
              rv({
                id: `boxed-form-${file.id}`,
                level: "info", category: "process",
                message: `${file.name} is a ${formSpec.name}. Its figures were placed by box code, not by caption and not by the AI: ${Object.keys(formSpec.book).filter((c) => byCode.has(c)).map((c) => `${c} → ${formLineRef(formSpec.book[c])}`).join("; ") || "no income or expense box was filled"}. ${unbooked.length ? `${unbooked.length} other box(es) are tax registers, credits, carry-forwards or identification boxes (for example RAI, REX, SAC, STUT, CPT, prior-year tax losses, RLI, PPM). They are not income, expenses or book balances of the year and were not booked: ${unbooked.slice(0, 40).map((b) => `${b.code}${b.caption ? ` "${b.caption.slice(0, 60)}"` : ""} ${b.value}`).join("; ")}${unbooked.length > 40 ? "; …" : ""}.` : ""}`,
                source: file.name,
              });
              rv({
                id: `tax-basis-${file.id}`, level: "warn", category: "consistency",
                message: `Not GAAP book income: confirm or adjust. ${formSpec.taxBasis} Schedule C was built from ${file.name}. If the client keeps books on another basis, attach the financial statements (or book-to-tax adjustments) and re-process; otherwise record that the tax-basis figures are accepted.`,
                source: file.name,
              });
            } else if (boxedPages.size) {
              const pairs = stackedCaptionRows(parsed.pdf);
              const boxRows = gridStructRows<MapRow>(extractRows(pairs).map((row) => (
                { row, docId: file.id, docName: file.name, feed: "is" as const, kind: "grid" as const }
              )));
              let boxSkipped = 0;
              for (const m of boxRows) {
                if (m.skipReason) boxSkipped++;
                else read++;
                const en = translateCaption(m.row.label || "");
                if (en) termTranslations[m.row.label] = en;
                mapRows.push(m);
              }
              log.push(`${file.name}: ${boxRows.length - boxSkipped} caption/amount pair(s) rebuilt from the boxed form${boxSkipped ? `, ${boxSkipped} dropped as totals` : ""}`);
              rv({
                id: `boxed-form-${file.id}`,
                level: "info", category: "process",
                message: `${file.name} is a numbered-box tax return${cls.language && cls.language !== "English" ? ` in ${cls.language}` : ""}${cls.identifiedBy ? `, identified by "${cls.identifiedBy.term}" (${cls.identifiedBy.english})` : ""}. Its caption/amount pairs were rebuilt from the page layout because no row on the form carries both. Income and expense boxes were mapped; the balance-sheet boxes it states as single totals are listed in Review for you to place, because a return states what a balance sheet itemises.`,
                source: file.name,
              });
            }
            /* Pages that carry money but name no section the rules know. They
               are NEVER booked — every figure on them is surfaced in Review,
               because money that was read must not disappear without a word.
               This is the difference between a short work paper and a short
               work paper nobody can explain. */
            const loosePages = ownPages(pagesForFeed(cls, "unassigned"));
            if (loosePages.size) {
              const loose = extractPositionedRows(pdf, rulers, { pages: loosePages, inheritRulerFrom: inheritRulers(rulers, loosePages), periodRulers });
              let shown = 0;
              for (const row of loose) {
                const label = String(row.label || "").trim();
                const values = (row.values || []).filter((v): v is number => typeof v === "number" && isFinite(v));
                if (!label || !values.length) continue;
                looseRows.push({
                  label, values, page: row.page ?? undefined, x0: row.x0,
                  docId: file.id, docName: file.name,
                  reason: `Read from ${file.name} page ${row.page ?? "?"}, which carries figures but names no statement section the rules know. Nothing from it was booked — assign it here if it belongs on the work paper.`,
                });
                shown++;
              }
              if (shown) {
                log.push(`${file.name}: ${shown} row(s) from ${loosePages.size} unnamed page(s) surfaced in Review, not booked`);
                rv({
                  id: `doc-loose-rows-${file.id}`,
                  level: "warn", category: "process",
                  message: `${file.name} has ${loosePages.size} page(s) carrying figures that name no statement section the tool knows (${[...loosePages].join(", ")}). ${shown} row(s) were read and are listed in Review & exceptions, unassigned. Nothing from those pages was booked — assign anything that belongs on the work paper, or set the document type in Document intake.`,
                  source: file.name,
                });
              }
            }
            /* Silence here would be the worst outcome: the preparer would see
               a shorter work paper and no reason for it. */
            if (excludedPages.size) {
              const ownerKeys = [...new Set([...excludedPages.values()])];
              const homeless = ownerKeys.filter((k) => companiesWithoutEntity.has(k));
              if (homeless.length) {
                const n = [...excludedPages.entries()].filter(([, k]) => companiesWithoutEntity.has(k)).length;
                rv({
                  id: `company-without-entity-${file.id}`,
                  level: "block", category: "entity-scope",
                  message: `${file.name}: ${n} page(s) are the accounts of ${homeless.map((k) => companiesWithoutEntity.get(k)).join(", ")}, and this case has no entity for ${homeless.length > 1 ? "them" : "it"}. A Form 5471 is filed per foreign corporation, so those pages were NOT booked here — folded into this work paper they would belong to neither company. Create the entity and process the document against it, or set the document type / move the file if the two are the same company.`,
                  source: file.name,
                });
              }
              const names = ownerKeys
                .map((k) => companiesWithoutEntity.get(k) || scopeEnts.find((e) => e.key === k)?.nm || "another company");
              const me = state.entities.find((e) => e.id === entityId);
              const self = me ? (me.profile.legalName || me.name) : "this work paper";
              rv({
                id: `entity-scope-${file.id}`,
                level: "warn", category: "entity-scope",
                message: `${file.name}: ${excludedPages.size} page(s) were identified as ${names.join(", ")} and were EXCLUDED from ${self}. Only pages identified as ${self} (plus unidentified pages) feed this work paper.`,
                source: file.name,
              });
              log.push(`${file.name}: ${excludedPages.size} page(s) excluded (belong to ${names.join(", ")})`);
              scopedOutDocs.add(file.id);
            }
          } else if (cls.kind === "related-party-ledger") {
            ledger = summarizeLedger(parsed.grid, file.name) || ledger;
          } else if (cls.kind === "client-questionnaire") {
            questionnaire = parseQuestionnaire(parsed.grid, file.name);
            profileGrids.push({ rows: parsed.grid, doc: file.name });
            log.push(`${file.name}: client questionnaire — ${[
              questionnaire.roles ? `roles "${questionnaire.roles}"` : "",
              questionnaire.wagesReceived !== undefined ? `wages received ${questionnaire.wagesReceived.toLocaleString()}` : "",
              questionnaire.additionalHolders.length ? `${questionnaire.additionalHolders.length} additional shareholder(s)` : "",
            ].filter(Boolean).join(", ") || "no answers read"}`);
          } else if (cls.kind === "related-party-salary") {
            salary = summarizeSalary(parsed.grid, file.name) || salary;
            if (salary) log.push(`${file.name}: salary schedule${salary.person ? ` for ${salary.person}` : ""} — ${salary.lines.length} line(s), total ${(salary.statedTotal ?? salary.sumOfLines).toLocaleString()}${salary.warnings.length ? ` (${salary.warnings.join("; ")})` : ""}`);
          } else if (cls.kind === "trial-balance") {
            /* The grid twin of the structure pass above. Without it a
               spreadsheet export's group subtotals were booked as accounts
               and everything under them counted twice. */
            /* Headings are read too ("Revenues:", "Cost of sales:"), so a
               caption that means nothing on its own ("Services", twice) is
               placed by the section it is printed under, as on a PDF. */
            const grid = tagSections(gridStructRows<MapRow>(extractRows(parsed.grid, { banners: true }).map((row) => (
              { row, docId: file.id, docName: file.name, feed: "both" as const, kind: "grid" as const }
            ))), { headingsOnly: true });
            let gridSkipped = 0;
            for (const m of grid) {
              if (m.skipReason) gridSkipped++;
              else if (!m.row.isBanner) read++;
              mapRows.push(m);
            }
            if (gridSkipped) log.push(`${file.name}: ${gridSkipped} structural subtotal/total row(s) dropped before mapping`);
            profileGrids.push({ rows: parsed.grid, doc: file.name });
          }
          if (read) log.push(`${file.name}: ${read} candidate line items read`);
        }

        // A recognized statement document that produced ZERO mapped rows is a
        // silent failure — name it, with its page kinds, instead of letting
        // the preparer discover empty schedules later.
        const selfKey = (() => {
          const me = state.entities.find((e) => e.id === entityId);
          return entityNameKey(me ? (me.profile.legalName || me.name) : "");
        })();
        for (const b of bundles) {
          if (b.cls.duplicateOf) continue;
          const feedsStatements =
            b.cls.kind === "cfc-financial-statements" || b.cls.kind === "trial-balance";
          if (!feedsStatements) continue;
          if (mapRows.some((m) => m.docId === b.file.id)) continue;
          /* A statement that names ANOTHER corporation contributed nothing
             here because page attribution kept it for the entity it belongs
             to. That is the scoping working, and the entity-scope item above
             already says so; a second "produced ZERO line items" warning
             would read as a failure. */
          if (scopedOutDocs.has(b.file.id)) continue;
          const docKey = entityNameKey(b.cls.entityName || "");
          if (selfKey && docKey && docKey !== selfKey && !docKey.includes(selfKey) && !selfKey.includes(docKey)) continue;
          const kinds = [...new Set(b.cls.pages.map((p) => p.kind))].join(", ");
          rv({
            id: `doc-zero-rows-${b.file.id}`,
            level: "warn", category: "process",
            message: `${b.file.name} was recognized as ${b.cls.kind} but produced ZERO mapped line items (pages: ${kinds}). Check the Type column in Document intake, or map its lines manually.`,
            source: b.file.name,
          });
        }

        /* Carry-forward selection. Cross-document dedupe first (the same CFC
           uploaded in two client copies keeps the wider block), then the
           identity gate: the prior return's foreign corporation must be THIS
           entity, or a sister CFC's return would seed the numbers. */
        if (cfCandidates.length) {
          const deduped: CfCandidate[] = [];
          for (const cand of cfCandidates) {
            /* When both blocks name their corporation, the NAME decides and
               nothing else does. A reference ID read from a neighbouring
               block's pages — the scan bands overlap on a stapled multi-CFC
               copy — otherwise merged two different foreign corporations into
               one candidate, and the second corporation never became an
               entity. Identifiers only settle it when a name is missing. */
            const dupAt = deduped.findIndex((d) => (
              cand.cfcName && d.cfcName
                ? entitySimilarity(cand.cfcName, d.cfcName) >= 0.5
                : cand.refIds.length > 0 && d.refIds.some((id) => cand.refIds.includes(id))
            ));
            if (dupAt < 0) { deduped.push(cand); continue; }
            const kept = deduped[dupAt];
            if (cand.pageCount > kept.pageCount) deduped[dupAt] = cand;
            if (cand.fileId !== kept.fileId) {
              rv({
                id: `cf-dup-${cand.fileId}`,
                level: "info", category: "carry-forward",
                message: `"${cand.cfcName || kept.cfcName}" appears in two prior-year documents (${kept.source}, ${cand.source}) — the wider copy was used.`,
                source: cand.source,
              });
            }
          }
          const knownName =
            (state.entities.find((e) => e.id === entityId)?.profile.legalName || "") ||
            bundles.find((x) => x.cls.kind === "cfc-financial-statements" && x.cls.entityName)?.cls.entityName || "";
          let selected: CfCandidate | null = null;
          let pendingBlock: CfCandidate | null = null;
          if (knownName) {
            let bestSim = 0;
            for (const cand of deduped) {
              const sim = cand.cfcName ? entitySimilarity(knownName, cand.cfcName) : 0;
              if (sim >= 0.5 && sim > bestSim) { selected = cand; bestSim = sim; }
            }
            // A block whose CFC could not be named cannot be judged — accept
            // it rather than silently dropping it (matches the prior gate).
            if (!selected) selected = deduped.find((c) => !c.cfcName) ?? null;
            if (!selected) {
              /* The names disagree. A prior return is not wrong about the
                 entity because it spells the name differently from the
                 statements — a trading name, a re-registration, a typo in an
                 export — and dropping it costs the opening balances, the
                 filer categories, the shareholders and the opening E&P all at
                 once. So it is the PREPARER who decides, once: until they do,
                 generation blocks (see validateEntity), and their answer is
                 remembered on the entity. */
              const decided = state.entities.find((e) => e.id === entityId)?.nameDecision || null;
              /* Set below when the name question is left open: that block is
                 this entity's own return waiting for an answer, not an
                 additional Form 5471 to fan out. */
              const named = deduped.filter((c) => !!c.cfcName);
              let best: CfCandidate | null = null;
              let bestSim = -1;
              for (const cand of named) {
                const sim = entitySimilarity(knownName, cand.cfcName);
                if (sim > bestSim) { best = cand; bestSim = sim; }
              }
              if (best && decided && decided.sameEntity && entitySimilarity(decided.priorName, best.cfcName) >= 0.8) {
                selected = best;
                nameMismatch = null;
                log.push(`${best.source}: "${best.cfcName}" accepted as the same entity as "${knownName}" by the preparer — carry-forward figures were used.`);
              } else if (best && !decided && booksAlias && entitySimilarity(best.cfcName, booksAlias.cfcName) >= 0.8) {
                /* The books-name case (see booksNameAlias): the return's only
                   Form 5471 is this company's, so its opening balances,
                   currency, shareholders and categories are used now — the
                   statements alone cannot say the books are in US dollars
                   when an account is called "Paypal PHP". The legal-name
                   question still blocks generation until it is answered, and
                   "different company" takes all of it back out. */
                selected = best;
                nameMismatch = { statementName: knownName, priorName: best.cfcName, source: best.source };
                log.push(`${best.source}: "${best.cfcName}" used provisionally as the company whose books are printed under "${knownName}" — confirm the legal name before generating.`);
              } else {
                if (best && !decided) {
                  nameMismatch = { statementName: knownName, priorName: best.cfcName, source: best.source };
                  pendingBlock = best;
                }
                for (const cand of deduped) {
                  rv({
                    id: `cf-wrong-entity-${cand.fileId}`,
                    level: "warn", category: "carry-forward",
                    message: `${cand.source} names "${cand.cfcName}" as the foreign corporation, but this work paper's entity is "${knownName}" — its carry-forward figures were NOT used.`,
                    source: cand.source,
                  });
                }
              }
            }
          } else {
            selected = deduped[0] ?? null;
          }
          if (selected) {
            cf = selected.cf;
            cfSource = selected.source;
            /* The return states its own accounting period on the 5471 face
               ("beginning APR 1, 2022, and ending MAR 31, 2023"). The page
               reader never sees it — it only scans statement pages — so the
               return was placed by its label year alone. Record the period it
               actually states, so the opening balances can be checked against
               the year being prepared. */
            if (cf.periodEnd) {
              const host = state.entities.find((e) => e.id === entityId);
              const cls = host?.docClasses?.[selected.fileId];
              if (cls && !cls.statementPeriodEnd) {
                updateEntity(entityId, {
                  docClasses: { ...host!.docClasses, [selected.fileId]: { ...cls, statementPeriodEnd: cf.periodEnd } },
                });
              }
            }
            // A reference copy OLDER than the immediately prior year: its
            // Schedule J line 14 opens the WRONG year — flag, never adjust.
            if (caseYears.cy && selected.statementYear && selected.statementYear < caseYears.cy - 1) {
              cfStale = true;
              rv({
                id: "cf-year-gap", level: "block", category: "carry-forward",
                message: `${selected.source} is a FY${selected.statementYear} filing, but this work paper is FY${caseYears.cy}, so its opening column is the close of FY${caseYears.cy - 1}. That return closes at the end of FY${selected.statementYear}, one year earlier, and its Schedule J line 14 opens FY${selected.statementYear + 1}. Nothing has been carried forward from it: a silently backdated opening balance is worse than a blank one. Supply the FY${caseYears.cy - 1} Form 5471, or enter the opening figures yourself.`,
                source: selected.source,
              });
            }
          }
          // Remaining NAMED blocks become sibling work papers after this run;
          // a nameless leftover block is surfaced instead — never guess.
          siblingPlans = deduped.filter((c) => c !== selected && c !== pendingBlock && !!c.cfcName);
          for (const c of deduped) {
            if (c !== selected && !c.cfcName) {
              rv({
                id: `cf-unnamed-block-${c.fileId}`,
                level: "warn", category: "carry-forward",
                message: `An additional Form 5471 was found in ${c.source} but its foreign corporation could not be identified — create that entity manually and re-process.`,
                source: c.source,
              });
            }
          }
        }
        /* English before mapping, not after it. A caption the terminology
           table knows carries its English from here on: the rules see it, the
           review items quote it, and the provenance sheet can show the
           original and the English side by side. A caption the preparer has
           already translated is never overwritten. */
        /* The same built-in terminology for every statement row, not only
           the boxed forms: a caption the rules already match never looks at
           its translation, so this can only place captions that would
           otherwise go unmatched. A translation already on the entity
           (typed, or from the AI) still wins below. */
        for (const m of mapRows) {
          const lb = m.row && m.row.label;
          if (!lb || termTranslations[lb]) continue;
          const en = translateCaption(lb);
          if (en) termTranslations[lb] = en;
        }
        if (Object.keys(termTranslations).length) {
          const cur = state.entities.find((e) => e.id === entityId);
          const merged = { ...termTranslations, ...(cur?.translations || {}) };
          updateEntity(entityId, { translations: merged });
          log.push(`${Object.keys(termTranslations).length} caption(s) read through the built-in terminology before mapping`);
        }
        /* Until the preparer answers, the books-name case keeps asking,
           even on a run where the legal name already matches the return. */
        if (booksAlias && !nameMismatch && !state.entities.find((e) => e.id === entityId)?.nameDecision) {
          nameMismatch = { statementName: booksAlias.alias, priorName: booksAlias.cfcName, source: cfSource || booksAlias.cfcName };
        }
        updateEntity(entityId, { nameMismatch, log: [...log] });

        /* The agent reads the documents BEFORE the rules do. It changes
           nothing the rules decide — it translates where translation is
           needed, names the figures at risk of being let past, and marks the
           rows the structure pass dropped that it reads as line items so they
           reach Review rather than disappearing. */
        try {
          const brief = await agentUnderstand(entityId, mapRows, log, {
            self: cf?.cfcName || null,
            planned: siblingPlans.map((c) => c.cfcName).filter(Boolean) as string[],
            aliases: [...(state.entities.find((e) => e.id === entityId)?.nameAliases || []),
              ...(booksAlias ? [booksAlias.alias, booksAlias.cfcName] : [])],
          });
          /* The agent has no authority to create or move anything. What it can
             do is refuse to let the run pass over a situation it has
             recognised: every risk it raised becomes an exception here, before
             a single line is booked, carrying the action that resolves it and
             who is allowed to take it. A critical one blocks generation. */
          for (const risk of brief?.risks || []) {
            rv({
              id: `agent-risk-${risk.id}`,
              level: risk.level === "critical" ? "block" : "warn",
              category: "process", applied: false,
              message: `${AGENT_NAME}: ${risk.what} ${risk.why} RECOMMENDED ACTION: ${risk.action}`
                + (risk.permitted === "tool"
                  ? " The tool can do this for you — it is offered on the entity card."
                  : " The agent is not permitted to do this itself.")
                + (risk.evidence ? ` Evidence: ${risk.evidence}.` : ""),
            });
          }
        } catch (err) {
          log.push(`AI agent could not read the documents — ${(err as Error).message}`);
        }
        updateEntity(entityId, { log: [...log] });
      }

      /* Step 3 — map with year routing, pools and provenance; detect profile. */
      if (step === 3) {
        /* A return's balance-sheet totals, only when nothing itemises the
           balance sheet: an itemised statement always wins over totals. */
        if (formBsRows.length && !mapRows.some((m) => (m.feed === "bs" || m.feed === "both") && !m.skipReason && !m.row.isBanner && !m.formTarget)) {
          for (const f of formBsRows) {
            mapRows.push(...f.rows);
            rv({ id: `form-bs-totals-${f.docId}`, level: "warn", category: "source-gap", applied: true, message: f.note, source: f.docName });
          }
        }
        /* Translations accepted on earlier work papers are reused before the
           mapping reads them, so one caption carries one English wording. */
        try {
          const cur = state.entities.find((e) => e.id === entityId);
          const reuse = cur ? termsFromMemory(cur.translations, mapRows.map((m) => String(m.row.label || ""))) : {};
          if (cur && Object.keys(reuse).length) {
            updateEntity(entityId, { translations: { ...cur.translations, ...reuse } });
            log.push(`${Object.keys(reuse).length} caption translation(s) reused from earlier work papers (shared translation memory)`);
          }
        } catch { /* the memory is an aid, never a reason to stop */ }
        const ent = state.entities.find((e) => e.id === entityId);
        if (!ent) return;   // removed mid-run
        const lines: Record<string, LineValue> = {};
        const relabels: Record<string, string> = { ...ent.relabels };
        const sourceLabels: Record<string, SourceLabel> = {};
        const contributions: Record<string, Contribution[]> = {};
        const unmatched: Entity["unmatched"] = [...looseRows];
        const statedResults: NonNullable<Entity["statedResults"]> = [];
        const pools = makePoolState();
        // Standing user remaps survive re-processing. Pre-reserve their pool
        // rows so auto-allocation cannot collide onto a user-chosen slot.
        const overrides = ent.mapOverrides || {};
        for (const ov of Object.values(overrides)) {
          if (!ov.to) continue;
          const row = Number(ov.to.split(":")[1]);
          const prefix = ov.to.startsWith("IS") ? "is" : "bs";
          for (const [poolKey, st] of Object.entries(pools)) {
            if (POOLS[poolKey].sheet !== prefix) continue;
            const i = st.free.indexOf(row);
            if (i >= 0) st.free.splice(i, 1);
          }
        }
        const groupStems = groupNameStems([
          state.stakeholder, ent.profile.clientName, ent.profile.legalName,
          ledger?.counterparty || "", ledger?.subjectEntity || "", cf?.holderName || "",
        ]);

        // A caption that no rule recognises may simply be in another language.
        // The tool already translates captions, but mapping used to run on the
        // raw label only, so a Spanish or Portuguese statement mapped nothing
        // even after translation. Try the raw label first (it is authoritative
        // and free), then the stored translation. Amounts are never affected —
        // only which template line the caption is matched to.
        let viaTranslation = 0;
        const matchWithTranslation = (label: string): { target: string | null; translated: boolean } => {
          const direct = matchRule(label, state.rules);
          if (direct) return { target: direct, translated: false };
          const en = ent.translations?.[label];
          if (!en || en === label) return { target: null, translated: false };
          const t = matchRule(en, state.rules);
          if (!t) return { target: null, translated: false };
          viaTranslation++;
          return { target: t, translated: true };
        };

        /* How each document prints its costs and its creditors, tallied from
           the figures as printed, before any flip. UK accounts put every cost
           in brackets on the P&L and every creditor in brackets on a
           net-assets balance sheet; read literally, cost of sales, the tax
           charge and every liability came out negative. */
        const printedSigns = new Map<string, { costNeg: number; costPos: number; liabNeg: number; liabPos: number }>();
        const COST_T = /^IS:(1[0-2]|2[6-9]|3\d|4\d|50|OD)$/;
        const LIAB_T = /^BS:(4[4-9]|5[0-6]|OCL|OL)$/;
        const signTally = (m: MapRow, target: string, routed: Array<{ field: string; value: number }>) => {
          const t = printedSigns.get(m.docId) || { costNeg: 0, costPos: 0, liabNeg: 0, liabPos: 0 };
          for (const r of routed) {
            if (!r.value) continue;
            if (m.feed === "is" && r.field === "amount" && COST_T.test(target)) { if (r.value < 0) t.costNeg++; else t.costPos++; }
            if (m.feed === "bs" && r.field === "eoy" && LIAB_T.test(target)) { if (r.value < 0) t.liabNeg++; else t.liabPos++; }
          }
          printedSigns.set(m.docId, t);
        };

        /* "Taxes" printed directly under the operating result is the tax
           charge on that result (Macroroots: Operating income 94,561 / Taxes
           2,352 / Net income 92,209), not the "taxes and licences" deduction
           the costs banner above it would make of it. */
        const PROFIT_BEFORE_TAX = /\b(operating (income|profit|result)|(income|profit|earnings|result) before (income )?tax(es|ation)?|pre-?tax (income|profit))\b/i;
        const TAX_ONLY = /^(income\s+)?tax(es|ation)?(\s+expense)?$/i;
        const afterProfitLine = new Map<string, boolean>();

        /* The P&L's own bottom line — "NET EARNINGS AED -47,183.90". It is a
           total, so it is set aside as structure or skipped and never booked;
           it is kept here (the last one per document, never a pre-tax line)
           so Schedule C can be checked against it. */
        for (const m of mapRows) {
          if (m.feed !== "is" || m.row.isBanner || !isProfitLine(m.row.label) || /\b(before|avant|vor|antes|prima)\b/i.test(m.row.label)) continue;
          const vals = m.row.values || [];
          const yi = caseYears.cy && m.row.years ? m.row.years.indexOf(caseYears.cy) : -1;
          const v = yi >= 0 ? vals[yi] : vals.length === 1 || !(m.row.years || []).some((y) => typeof y === "number") ? vals[0] : undefined;
          if (typeof v !== "number") continue;
          const at = statedResults.findIndex((x) => x.feed === "is" && x.docName === m.docName);
          const rec = { label: m.row.label, value: v, docName: m.docName, page: m.row.page, feed: "is" as const };
          if (at >= 0) statedResults[at] = rec; else statedResults.push(rec);
        }

        /* The balance sheet's own "Total assets", kept (never booked) so
           Schedule F can be checked against the statement it came from. */
        for (const m of mapRows) {
          if (m.feed === "is" || m.row.isBanner || m.formTarget || !TOTAL_ASSETS_CAPTION.test(String(m.row.label || "").replace(/^[\d.\s]+/, "").replace(/[:.]+$/, "").trim())) continue;
          const vals = m.row.values || [];
          const yi = caseYears.cy && m.row.years ? m.row.years.indexOf(caseYears.cy) : -1;
          const v = yi >= 0 ? vals[yi] : vals.length === 1 || !(m.row.years || []).some((y) => typeof y === "number") ? vals[m.kind === "grid" ? vals.length - 1 : 0] : undefined;
          if (typeof v !== "number" || !v || statedResults.some((x) => x.feed === "bs" && x.docName === m.docName)) continue;
          statedResults.push({ label: m.row.label, value: v, docName: m.docName, page: m.row.page, feed: "bs" });
        }

        tagStatementGroups(mapRows);
        for (const m of mapRows) {
          const afterProfit = afterProfitLine.get(m.docId) === true;
          if (!m.row.isBanner && (m.row.values || []).length) afterProfitLine.set(m.docId, PROFIT_BEFORE_TAX.test(String(m.row.label || "")));
          // Structure, not data: a banner announces what follows, and a
          // structural subtotal is already the sum of rows being booked.
          // Both stay in mapRows so the log and the evidence view can show
          // them; neither is ever booked.
          if (m.skipReason || m.row.isBanner) {
            if (m.outsideTotal && !m.row.isBanner) {
              const amt = (m.row.values || [])[(m.row.values || []).length - 1];
              rv({
                id: `outside-total-${norm(m.row.label)}`, level: "warn", category: "mapping",
                sourceLabel: m.row.label, source: m.docName,
                message: `"${m.row.label}" (${Number(amt).toLocaleString()}) was not booked: the statement's printed total "${m.outsideTotal}" is the sum of the other rows in its group, without this one. It is usually an account repeated from another group or a figure the statement shows for information. If it is a real balance, assign it on Mapping & adjustments.`,
              });
            }
            /* The agent read this row before mapping and judged it a line
               item rather than a total. It is still NOT booked — the
               arithmetic that dropped it may be right, and booking it would
               double-count — but it stops being invisible: it reaches the
               Review tab, the Exception Centre and the AI mapping pass, where
               a preparer can assign it in one move. */
            if (m.agentImportant && !m.row.isBanner) {
              unmatched.push({
                ...m.row, docId: m.docId, docName: m.docName, section: m.section,
                reason: `Dropped before mapping — ${m.skipReason} — but the agent judged it a line item, not a total: ${m.agentImportant}. Confirm and assign it, or leave it out.`,
              });
            }
            continue;
          }
          const matched = matchWithTranslation(m.row.label);
          let target = matched.target;
          /* The P&L's own result line ("Pérdida del Periodo (621)") closes the
             statement; it is never a line item. A Spanish one matched no
             SKIP keyword, and under the "Gastos" banner it would have been
             booked as one more expense. */
          if (!target && m.feed === "is" && overrides[norm(m.row.label)] === undefined
            && ((isProfitLine(m.row.label) && !/\b(before|avant|vor|antes|prima)\b/i.test(m.row.label)) || isResultSubtotal(m.row.label))) target = "SKIP";
          if (afterProfit && m.feed !== "bs" && TAX_ONLY.test(String(m.row.label || "").trim()) && target !== "IS:63") target = "IS:62";
          /* "Other revenues 54,085" printed inside the revenue block, and added
             into "Total net sales" there, is turnover: gross receipts, not the
             other-income line the words alone would pick. */
          if (m.feed !== "bs" && m.section === "income" && (target === "IS:22" || target === "IS:OI")
            && /^other\s+(revenues?|sales|operating\s+revenues?)$/i.test(String(m.row.label || "").trim())) target = "IS:7";
          /* A caption's accounting meaning depends on the statement it is
             printed in.  A P&L charge called "Patentes" is an expense, not
             an intangible asset merely because its English translation shares
             the word "patent" with Schedule F line 12c. */
          if (m.feed === "is" && /\bpatentes?\b/i.test(m.row.label)) target = "IS:OD";
          /* A payable owed to the company's own shareholders or related
             parties is Schedule F line 18 (loans from shareholders and other
             related persons), not a trade payable: "Cuentas por Pagar
             Accionistas" matched the generic "cuentas por pagar" keyword. */
          if (target === "BS:46" && /\b(accionistas?|socios?|shareholders?|stockholders?|partes\s+relacionadas|compa[n\u00f1][i\u00ed]as\s+relacionadas|related\s+(?:part(?:y|ies)|compan(?:y|ies)))\b/i.test(m.row.label)) target = "BS:52";
          /* The mirror of it, one line up. A payment processor's fee is the
             cost of COLLECTING the money, so it is an ordinary deduction like
             any bank charge — unless the statement itself files it under cost
             of sales, as a QuickBooks chart does with "4500 Shopify Payment
             Fees" and "4502 Paypal Fees". The books' own banner decides, and
             the hand-prepared paper for that client agrees with the banner. */
          if (m.feed === "is" && m.section === "cogs" && target === "IS:OD" && isProcessorFee(m.row.label)) target = "IS:12";
          /* Rent printed under Cost of Sales (equipment hired for production)
             is a cost of the goods: the statement says so. */
          if (m.feed === "is" && m.section === "cogs" && target === "IS:27") target = "IS:12";
          /* The mirror of it: a cost-of-goods keyword ("Shipping and delivery
             expense", "Purchases", "Direct hotel") printed under the
             statement's EXPENSES heading is an operating expense — line 17 —
             because the statement says so. Only a caption that names cost of
             goods itself (or the stock movement) keeps line 2 there. */
          if (m.feed === "is" && m.section === "costs" && target && /^IS:1[0-2]$/.test(target)
            && overrides[norm(m.row.label)] === undefined && !EXPLICIT_COGS.test(String(m.row.label || ""))) {
            target = sectionRoute("costs", m.row.label) || "IS:OD";
          }
          /* Delivering goods to customers is a cost of selling them, not of
             buying or making them: outbound delivery and shipping go to the
             other deductions even when the books file them under cost of
             sales. Freight IN (on purchases, customs, duty) stays in cost of
             goods sold. Both reviewed papers with such a line agree. */
          if (m.feed === "is" && m.section === "cogs" && target && /^IS:1[0-2]$/.test(target)
            && overrides[norm(m.row.label)] === undefined && OUTBOUND_DELIVERY.test(String(m.row.label || ""))
            && !INBOUND_FREIGHT.test(String(m.row.label || ""))) {
            target = "IS:OD";
            rv({
              id: `delivery-to-deductions-${norm(m.row.label)}`, level: "info", category: "mapping", applied: true,
              sourceLabel: m.row.label,
              message: `"${m.row.label}" is printed under cost of sales, but delivery to customers is a selling cost, so it was booked to Schedule C line 17 (other deductions). Net income does not change. If it is freight on purchases, move it to cost of goods sold on Mapping & adjustments.`,
              target: `${SHEET.is}!F33`, source: m.docName,
            });
          }
          // A numbered-box return's code decided the line; its caption did not.
          if (m.formTarget) target = m.formTarget;
          if (target === "SKIP") {
            // "Net income" in an equity section is closing equity, not a
            // P&L subtotal — the one SKIP that depends on which statement
            // the caption is printed in.
            const equity = equityOverride(m.row.label, m.feed, m.section);
            /* "Cost of sales" is skipped because it is normally the total of
               the purchases and direct costs listed above it. On a summary
               P&L it is the FIRST and only figure of its section, with
               nothing itemised beneath it — there is nothing else to book,
               so it goes to the section's line instead of vanishing. */
            if (!equity && m.feed === "is" && m.collapsed && m.collapsedLead) target = null;
            else if (!equity) continue;
            else target = equity;
          }
          /* How the line was chosen — the Provenance sheet must say so honestly. */
          let via: Contribution["via"] = "rule";
          const ov = overrides[norm(m.row.label)];
          if (ov !== undefined) {
            // The user's standing decision wins over rules and feed scoping.
            if (ov.to === null) { unmatched.push({ ...m.row, docId: m.docId, docName: m.docName, reason: "You unassigned this caption — pick a template line to book it." }); continue; }
            target = ov.to;
            via = "manual";
          } else {
            // Feed scoping: a P&L page may only hit IS lines, a balance-sheet
            // page only BS lines. A related-party balance is recognized by the
            // group name in its caption.
            /* A rule that lands on the wrong sheet for this page loses — but
               losing is not the same as there being no rule. Two catalogues
               can own the same words for different statements ("Motor
               Vehicle" is a depreciable asset on a balance sheet and a running
               cost on a P&L), and whichever one the unrestricted scan returns,
               the other is the right answer on the other page. Ask the
               catalogue again with the sheet fixed before falling back to the
               banner. */
            if (target && m.feed === "is" && !target.startsWith("IS")) {
              target = matchRuleScoped(m.row.label, state.rules, "IS");
              if (target === "SKIP") target = null;
            }
            if (target && m.feed === "bs" && !target.startsWith("BS")) {
              target = matchRuleScoped(m.row.label, state.rules, "BS");
              if (target === "SKIP") target = null;
            }
            if (!target && m.feed === "bs") {
              const rp = relatedPartyTarget(m.row.label, groupStems);
              if (rp) {
                target = rp;
                rv({
                  id: `rp-routed-${norm(m.row.label)}`,
                  level: "warn", category: "related-party",
                  sourceLabel: m.row.label,
                  message: `"${m.row.label}" was routed to ${rp === "BS:19" ? "loans to related persons (Sch F line 6)" : "loans from related persons (Sch F line 18)"} because the caption names a group entity — confirm, and consider Schedule M.`,
                  target: `${SHEET.bs}!${rp === "BS:19" ? "D/F19" : "D/F52"}`, source: m.docName,
                });
              }
            }
          }
          /* The statement's own group heading says what an account is when
             the account's name does not: "1303 · Beer" under "Inventory and
             Supplies" is stock, and "Holiday Pay" under "Staff costs" is
             compensation. Only a heading whose group a printed total proved
             is trusted, innermost first. A staff-cost group is booked as ONE
             group on line 11 even where its accounts carry cost words of their
             own ("Payroll", "Casual Labour") or sit under Cost of Sales: the
             reviewed papers keep the whole group on compensation. */
          let head: { caption: string; target: string } | null = null;
          if (ov === undefined && m.groups && m.groups.length && (m.feed === "is" || m.feed === "bs") && target !== "SKIP" && !/^(sub-?)?totals?\b/i.test(String(m.row.label || "").trim())) {
            const sheet = m.feed === "is" ? "IS" : "BS";
            for (const g of m.groups) {
              const t = matchRuleScoped(g, state.rules, sheet);
              if (t && t !== "SKIP") { head = { caption: g, target: t }; break; }
            }
          }
          let inheritedFrom: string | null = null;
          if (head && head.target === "IS:26" && target && target !== "IS:26" && /^IS:(OD|10|11|12)$/.test(target)) {
            target = "IS:26"; inheritedFrom = head.caption; via = "section";
          }
          /* The banner is the statement's own words about what this caption
             is, and it outranks a keyword match: a caption printed under
             "Current assets" cannot be an income line however the keyword
             reads. Applied AFTER the target is chosen, because the veto needs
             to know what was proposed — and only as a veto, never to pick. */
          if (target && m.section && !sectionOk(m.section, target)) target = null;
          // Only once the rules have failed: the banner's own routing. Last
          // resort, and honest about the assets side having no catch-all.
          if (!target && m.section) {
            target = sectionRoute(m.section, m.row.label) || null;
            if (target) via = "section";
          }
          /* The group heading comes after the banner: the banner's routing
             knows captions ("Referral fee" is other income, "Directors and
             managers" is compensation) that a heading like "Turnover" would
             overrule. It places what nothing else could — and a staff-cost
             heading still takes a banner's cost-of-sales catch-all. */
          if (head && head.target === "IS:26" && target && target !== "IS:26" && /^IS:(OD|10|11|12)$/.test(target)) {
            target = "IS:26"; inheritedFrom = head.caption; via = "section";
          }
          if (!target && head && sectionOk(m.section, head.target)) { target = head.target; inheritedFrom = head.caption; via = "section"; }
          if (inheritedFrom && head && head.target === "IS:26" && m.section === "cogs") rv({
            id: `group-compensation-${norm(head.caption)}`, level: "info", category: "mapping", applied: true,
            sourceLabel: head.caption,
            message: `"${head.caption}" is printed under the statement's cost of sales, and its accounts were booked together to Schedule C line 11 (compensation), as the reviewed work papers do. If this labour is direct cost of the goods sold, move the accounts to "Cost of labor" on Mapping & adjustments.`,
            target: `${SHEET.is}!F26`, source: m.docName,
          });
          // A section heading that IS the section's only line (QuickBooks
          // summary layout) goes to that section's "other" line, and says so.
          if (!target && m.collapsed) {
            target = collapsedRoute(m.row.label, m.collapsed);
            if (target) {
              via = "section";
              rv({
                id: `collapsed-section-${norm(m.row.label)}`, level: "info", category: "mapping", applied: true,
                sourceLabel: m.row.label,
                message: `"${m.row.label}" carried a single figure with nothing itemised beneath it (a summary-layout statement), so it was booked as a whole to ${target === "BS:61" ? "retained earnings" : target === "BS:OCA" ? "other current assets" : target === "BS:39" ? "other assets" : target === "BS:OCL" ? "other current liabilities" : target === "BS:OL" ? "other liabilities" : target === "IS:7" ? "gross receipts" : "other deductions"}. Attach the detailed statement if one exists and re-process.`,
                source: m.docName,
              });
            }
          }

          /* Questions the caption cannot answer by itself. Each is raised once
             per caption and only while the preparer has not decided it on
             Mapping & adjustments (a remap is the answer). */
          if (target && via !== "manual") {
            const cap = String(m.row.label || "");
            /* "Business tax" may be the corporate income tax (Belize charges
               it in place of one) or a tax on the business that is not on
               income. The answer moves the figure between Schedule C line 16
               and line 21a — and with it Schedule E, the high-tax test and
               Form 8992 — so it is asked, never guessed. */
            if (target === "IS:32" && /\bbusiness\s+tax\b/i.test(cap)) rv({
              id: `business-tax-question-${norm(cap)}`, level: "block", category: "mapping", applied: true,
              sourceLabel: cap,
              message: `QUESTION: is "${cap}" the company's income tax? It was booked to Schedule C line 16 (taxes other than income tax). If it is the tax charged on the company's income or profits — in some countries (Belize, for example) a business tax is charged in place of the corporate income tax — move it to line 21a (income tax expense) on Mapping & adjustments; Schedule E, the high-tax test and Form 8992 follow from that answer. If it is not an income tax, acknowledge this with a short note to keep it on line 16.`,
              target: `${SHEET.is}!F32`, source: m.docName,
            });
            /* A freight or delivery cost the statement files under Cost of
               Sales stays there: the statement says so. Some reviewers show
               it as an ordinary deduction instead, so it is named. */
            if (m.feed === "is" && m.section === "cogs" && /^IS:1[0-2]$/.test(target) && /\b(freight|delivery|shipping|carriage)\b/i.test(cap)) rv({
              id: `freight-in-cogs-${norm(cap)}`, level: "info", category: "mapping", applied: true,
              sourceLabel: cap,
              message: `"${cap}" is printed under the statement's cost of sales, so it was kept in cost of goods sold (Schedule C line 2). If your practice shows it as an other deduction (line 17), move it on Mapping & adjustments; net income does not change.`,
              target: `${SHEET.is}!F12`, source: m.docName,
            });
            /* A balance "due from" a company the statement names may be a
               loan to a related person (Schedule F line 6), which also needs
               Schedule M. Only the preparer knows who the counterparty is. */
            if (target === "BS:OCA" && /\bdue\s+from\b/i.test(cap) && (m.row.values || []).some((v) => typeof v === "number" && v !== 0)) rv({
              id: `due-from-related-${norm(cap)}`, level: "warn", category: "related-party", applied: true,
              sourceLabel: cap,
              message: `"${cap}" was booked to other current assets (Schedule F line 5). If the counterparty is a shareholder or a company related to the corporation, move it to line 6 (loans to shareholders and other related persons) on Mapping & adjustments and report the balance on Schedule M.`,
              target: `${SHEET.bs}!F16`, source: m.docName,
            });
          }
          if (!target) {
            unmatched.push({
              ...m.row, docId: m.docId, docName: m.docName, section: m.section,
              reason: m.feed === "is"
                ? "No mapping rule matches this caption on an income-statement page — assign it to a Schedule C line (or a Schedule F line if it is really a balance)."
                : m.feed === "bs"
                  ? "No mapping rule matches this caption on a balance-sheet page — assign it to a Schedule F line."
                  : "No mapping rule matches this caption — assign it to the right schedule line.",
            });
            continue;
          }

          let routed = routeRow(m.row, target.startsWith("BS"), caseYears, m.kind);
          if (Array.isArray(routed)) signTally(m, target, routed);
          // The rule and its reasoning live in sections.ts.
          if (Array.isArray(routed) && contraRevenueFlip(target, m.inTotal, routed[0]?.value)) {
            const asPrinted = routed[0]?.value ?? 0;
            routed = routed.map((r) => ({ ...r, value: -r.value }));
            rv({
              id: `contra-revenue-${norm(m.row.label)}`,
              level: "info", category: "mapping", sourceLabel: m.row.label,
              message: `"${m.row.label}" (${asPrinted.toLocaleString()} as printed) was booked to Schedule C line 1b, returns and allowances, as ${r2(-asPrinted).toLocaleString()}. Line 1b is subtracted from line 1a, so it can only hold a positive magnitude; the sign is reversed to leave gross income exactly as the statement reports it. If the books have the sign the wrong way round, correct it in the books rather than here.`,
              target: `${SHEET.is}!F8`, source: m.docName,
            });
          }
          if (Array.isArray(routed) && expenseGainFlip(target, m.section, routed[0]?.value)) {
            const asPrinted = routed[0]?.value ?? 0;
            routed = routed.map((r) => ({ ...r, value: -r.value }));
            rv({
              id: `expense-gain-${norm(m.row.label)}`,
              level: "info", category: "mapping", sourceLabel: m.row.label,
              message: `"${m.row.label}" is printed under the statement's expense heading, so the ${asPrinted.toLocaleString()} it reports is a loss. It was booked to Schedule C as ${r2(-asPrinted).toLocaleString()}.`,
              target: `${SHEET.is}!F${target === "IS:19" ? 19 : 20}`, source: m.docName,
            });
          }
          /* A negative inside an expense group is a sign CONVENTION only when
             the group's own total is negative too. Under a positive total
             ("Other personnel costs 2,390.63" = 2,400.00 − 9.37) it is a
             genuine credit and keeps its sign. */
          if (Array.isArray(routed) && deductionMagnitudeFlip(target, m.section, m.inTotal, routed[0]?.value) && parentTotalSign(mapRows, m) !== 1) {
            const asPrinted = routed[0]?.value ?? 0;
            routed = routed.map((r) => ({ ...r, value: -r.value }));
            rv({
              id: `deduction-magnitude-${target}-${norm(m.row.label)}`,
              level: "info", category: "mapping", sourceLabel: m.row.label,
              message: `"${m.row.label}" is a negative amount inside the statement's proved expense total, so it was booked to Schedule C deduction line ${target} as the positive magnitude ${r2(-asPrinted).toLocaleString()}.`,
              target: `${SHEET.is}!F${target.split(":")[1]}`, source: m.docName,
            });
          }
          /* Schedule F's contra lines (2b bad debts, 9b depreciation, 10b
             depletion, 12d amortisation) are added into total assets, so they
             can only hold a negative. A statement that prints "Less:
             accumulated depreciation 81,142,564" as a positive figure under a
             "less" caption means the subtraction; booked as printed, total
             assets came out 162 million too high on one Colombian file. */
          if (Array.isArray(routed) && CONTRA_ASSET_LINES.has(target) && routed.some((r) => r.value > 0)) {
            const asPrinted = routed[0]?.value ?? 0;
            routed = routed.map((r) => ({ ...r, value: r.value > 0 ? -r.value : r.value }));
            rv({
              id: `contra-asset-${target}-${norm(m.row.label)}`,
              level: "info", category: "mapping", sourceLabel: m.row.label,
              message: `"${m.row.label}" (${asPrinted.toLocaleString()} as printed) was booked to Schedule F line ${CONTRA_ASSET_LINES.get(target)} as ${r2(-Math.abs(asPrinted)).toLocaleString()}. That line is a deduction from the assets above it and the template adds it into total assets, so it must be negative.`,
              target: `${SHEET.bs}!D${target.split(":")[1]}`, source: m.docName,
            });
          }
          if (routed === "ambiguous") {
            unmatched.push({
              ...m.row, docId: m.docId, docName: m.docName,
              reason: "The row carries several numbers with no year identity — assigning it manually books the value the routing can verify.",
            });
            continue;
          }
          if (!routed.length) continue;   // prior-year-only income row etc — correctly ignored

          const isOverride = ov !== undefined && ov.to !== null;
          /* A zero-balance account adds nothing, and on a shared template
             line it took a row a real balance needed ("2010 Brex Credit Card
             0.00" sat first among the credit cards). */
          if (!isOverride && POOLS[target] && routed.every((r) => !r.value)) continue;
          const resolved = isOverride ? { target, relabel: undefined, overflowNote: undefined } : resolvePool(pools, target, m.row.label, m.group);
          if (isOverride && specFor(target)?.relabel && !relabels[target]) relabels[target] = m.row.label;
          if (resolved.relabel) relabels[resolved.target] = resolved.relabel;


          for (const r of routed) {
            // Summary and detailed statements in one document repeat the same
            // figures — the identical caption+value from another PAGE of the
            // same document counts once, not twice.
            const dupe = (contributions[resolved.target] || []).some((c) =>
              c.docId === m.docId && c.page !== m.row.page &&
              c.label.toLowerCase() === m.row.label.toLowerCase() &&
              c.value === r.value && c.field === r.field,
            );
            if (dupe) {
              rv({
                id: `dupe-page-${resolved.target}-${norm(m.row.label)}`,
                level: "info", category: "mapping",
                sourceLabel: m.row.label,
                  message: `"${m.row.label}" (${r.value.toLocaleString()}) appears on two pages of ${m.docName} — counted once.`,
                source: m.docName,
              });
              continue;
            }
            /* The same statement uploaded twice in another form — the PDF and
               its Excel export, or a summary and a detailed copy: the identical
               caption and figure is already booked to this line from ANOTHER
               document. It is the same money, so it is counted once. Current-
               year figures only; opening balances have their own precedence
               between the statements and the prior return. */
            const crossDoc = r.field !== "boy" && r.value !== 0 && (contributions[resolved.target] || []).find((c) =>
              c.docId !== m.docId && c.field === r.field && c.value === r.value && norm(c.label) === norm(m.row.label),
            );
            if (crossDoc) {
              rv({
                id: `dup-doc-${resolved.target}-${norm(m.row.label)}`,
                level: "warn", category: "mapping", applied: true,
                sourceLabel: m.row.label,
                message: `"${m.row.label}" ${r.value.toLocaleString()} is already booked to ${targetLabel(resolved.target)} from ${crossDoc.docName}, and ${m.docName} prints the same caption with the same amount. It is counted once. If the two documents really hold two separate balances of the same size, assign the second one on Mapping & adjustments.`,
                source: m.docName,
              });
              continue;
            }
            /* The same amount on the same line from another page of the same
               document, under a DIFFERENT caption. Usually the notes
               restating the face — "Interest" on the profit and loss and
               "Interest 4% a year" in the note beneath it — and then the line
               carries it twice. Sometimes two real accounts that happen to
               agree to the cent. The rules cannot tell which, so the figure is
               booked as read and the preparer is told exactly what to look at:
               dropping it would be a guess, and a silent double count is what
               brought this here. */
            const echo = (contributions[resolved.target] || []).find((c) =>
              c.docId === m.docId && c.page !== m.row.page &&
              c.label.toLowerCase() !== m.row.label.toLowerCase() &&
              c.value === r.value && c.field === r.field && r.value !== 0,
            );
            if (echo) {
              rv({
                id: `echo-page-${resolved.target}-${norm(m.row.label)}`,
                level: "warn", category: "mapping", applied: true,
                sourceLabel: m.row.label,
                message: `${targetLabel(resolved.target)} now carries ${r.value.toLocaleString()} twice from ${m.docName}: once as "${echo.label}" (page ${echo.page}) and again as "${m.row.label}" (page ${m.row.page}). If the second is the note explaining the first, the line is overstated by ${r.value.toLocaleString()} — remove one on Mapping & adjustments. If they really are two accounts of the same size, leave both.`,
                source: m.docName,
              });
            }
            const booked = taxBookValue(resolved.target, r.field, r.value);
            if (taxPrintedNegative(resolved.target, r.field, r.value)) {
              rv({
                id: `tax-sign-${resolved.target}`, level: "warn", category: "mapping", applied: true,
                sourceLabel: m.row.label,
                  message: `"${m.row.label}" is printed as ${r.value.toLocaleString()} — a NEGATIVE tax. It has been booked as printed to ${resolved.target === "IS:62" ? "income tax expense — current (row 62)" : "deferred tax (row 63)"}, and row 64 subtracts that line, so it will ADD ${Math.abs(r.value).toLocaleString()} to profit. That is right for a genuine tax credit and wrong if the statement simply prints taxes as negatives. Confirm it in the Exception Center.`,
                target: `${SHEET.is}!F${resolved.target.split(":")[1]}`, source: m.docName,
              });
            }
            const cur = lines[resolved.target] || {};
            if (r.field === "amount") lines[resolved.target] = { amount: (typeof cur.amount === "number" ? cur.amount : 0) + booked };
            else if (r.field === "eoy") lines[resolved.target] = { ...cur, eoy: (typeof cur.eoy === "number" ? cur.eoy : 0) + booked };
            else lines[resolved.target] = { ...cur, boy: (typeof cur.boy === "number" ? cur.boy : 0) + booked };
            (contributions[resolved.target] ||= []).push({
              docId: m.docId, docName: m.docName, page: m.row.page,
              label: m.row.label, value: booked, field: r.field, year: r.year, via,
              srcValues: m.row.values, srcYears: m.row.years, period: m.row.period,
            });
          }
          sourceLabels[resolved.target] = { label: m.row.label, values: m.row.values, years: m.row.years };
        }

        /* Periodic inventory: the P&L reports the stock movement as two
           captions, "Opening stock" and "Closing stock", both printed
           positive. Schedule C line 2 wants the NET — opening adds to cost,
           closing relieves it. Both mapped to IS:12 and both were added, so
           the line came out as the SUM of two balances instead of their
           difference. Correcting the line needs −2× the value (once to undo
           the addition, once to subtract it), and the contribution is
           negated so the provenance trail shows what was actually booked. */
        for (const c of contributions["IS:12"] || []) {
          if (!/^closing\s/i.test(c.label || "") || c.value <= 0) continue;
          const cur = lines["IS:12"];
          lines["IS:12"] = { amount: (cur && typeof cur.amount === "number" ? cur.amount : 0) - 2 * c.value };
          c.value = -c.value;
        }

        /* A deduction line holding a negative number is usually a statement
           that prints costs in brackets and a reader that took the sign
           literally — but sometimes it is a genuine credit. The tool cannot
           tell, so it books what it read and says so. */
        /* A document whose costs (or creditors) are ALL printed negative —
           two or more of them, and not one printed positive — uses brackets
           as its presentation, not as a sign. Cost of sales, the tax charge
           and the liabilities are booked as the positive amounts the form
           expects, deductions included — the same brackets need not then be
           reported one line at a time as possible sign errors. */
        for (const [docId, t] of printedSigns) {
          const costs = t.costNeg >= 2 && t.costPos === 0;
          const creditors = t.liabNeg >= 2 && t.liabPos === 0;
          if (!costs && !creditors) continue;
          const keys = Object.keys(contributions).filter((k) =>
            (costs && /^IS:(1[0-2]|2[6-9]|3\d|4\d|50|6[23])$/.test(k)) || (creditors && /^BS:(4[4-9]|5[0-6])$/.test(k)));
          const moved: string[] = [];
          let docName = "";
          for (const k of keys) {
            for (const c of contributions[k]) {
              if (c.docId !== docId || c.value >= 0) continue;
              if (k === "IS:12" && /^closing\s/i.test(c.label || "")) continue;
              const f = c.field as "amount" | "eoy" | "boy";
              const cur = lines[k] || {};
              const was = cur[f];
              lines[k] = { ...cur, [f]: (typeof was === "number" ? was : 0) - 2 * c.value };
              c.value = -c.value;
              moved.push(`"${c.label}" ${c.value.toLocaleString()}`);
              docName = c.docName;
            }
          }
          if (!moved.length) continue;
          if (costs) {
            for (let i = review.length - 1; i >= 0; i--) {
              const id = review[i].id || "";
              if (/^tax-sign-IS:6[23]$/.test(id) && (contributions[id.slice(9)] || []).every((c) => c.value >= 0)) review.splice(i, 1);
            }
          }
          const what = costs && creditors ? "its costs and its creditors" : costs ? "its costs" : "its creditors";
          rv({
            id: `bracket-convention-${docId}`, level: "info", category: "mapping", applied: true,
            message: `${docName} prints ${what} in brackets — every one of them is negative on the page — so the brackets are presentation, not a sign. ${moved.length} figure(s) were booked as the positive amounts the form expects: ${moved.slice(0, 6).join(" · ")}${moved.length > 6 ? " …" : ""}.`,
            source: docName,
          });
          log.push(`${docName}: ${what} printed in brackets — ${moved.length} figure(s) booked as positive amounts`);
        }

        /* A tax printed as its effect on profit: "Bénéfice avant impôts
           -9,218.98 / Impôts -84.80 / Bénéfice de l'exercice -9,303.78". The
           costs above it are printed positive, so the bracket rule does not
           apply, and booked as printed the charge ADDED 84.80 to profit. The
           statements' own result settles it: when reversing the sign makes
           Schedule C reach exactly the result the balance sheet states, the
           printed minus was presentation, and the charge is booked positive.
           Anything else stays as printed, with the warning. */
        {
          const tax = (contributions["IS:62"] || []).filter((c) => c.field === "amount" && c.value < 0);
          const sum = r2(tax.reduce((n, c) => n + c.value, 0));
          const probe = tax.length ? pnlTieOut({ ...ent, lines, contributions, unmatched, statedResults }) : null;
          if (probe && Math.abs(probe.diff - 2 * sum) <= Math.max(1, Math.abs(probe.stated) * 0.001)) {
            for (const c of tax) c.value = -c.value;
            lines["IS:62"] = { ...lines["IS:62"], amount: r2((lines["IS:62"]?.amount ?? 0) - 2 * sum) };
            for (let i = review.length - 1; i >= 0; i--) if (review[i].id === "tax-sign-IS:62") review.splice(i, 1);
            rv({
              id: "tax-sign-by-result", level: "info", category: "mapping", applied: true,
              message: `The tax charge is printed as ${sum.toLocaleString()} — its effect on profit — and was booked as a charge of ${(-sum).toLocaleString()}: with that sign Schedule C reaches exactly the result the balance sheet states ("${probe.label}" ${probe.stated.toLocaleString()}); as printed it would have been out by ${probe.diff.toLocaleString()}.`,
              target: `${SHEET.is}!F62`,
            });
            log.push(`Tax charge ${sum.toLocaleString()} booked as a charge of ${(-sum).toLocaleString()} — proved by the stated result for the year`);
          }
        }

        const negSeen = new Set<string>();
        for (const [target, list] of Object.entries(contributions)) {
          if (!/^IS:(2[6-9]|3\d|4\d|50)$/.test(target)) continue;
          for (const c of list) {
            if (c.value >= 0 || negSeen.has(`${target}|${c.label}`)) continue;
            negSeen.add(`${target}|${c.label}`);
            rv({
              id: `neg-deduction-${target}-${norm(c.label)}`,
              level: "warn", category: "mapping",
              message: `\u201C${c.label}\u201D booked ${c.value.toLocaleString()} (negative) on deduction line ${target} — statement sign conventions can invert here; verify the sign in Mapping & adjustments.`,
              source: c.docName,
            });
          }
        }

        /* Rows that ended up carrying several different accounts.
           Raised once, AFTER the loop, from the final pool state: raised
           inside it, the first caption to overflow won the review id and the
           message froze at the count it had then — a row holding three
           accounts was reported as holding two. */
        for (const [poolKey, pool] of Object.entries(POOLS)) {
          const shared = sharedPoolCaptions(pools, poolKey);
          if (shared.length < 2) continue;
          const row = pool.rows[pool.rows.length - 1];
          const target = `${pool.sheet === "is" ? "IS" : "BS"}:${row}`;
          const sheetName = pool.sheet === "is" ? SHEET.is : SHEET.bs;
          rv({
            id: `pool-overflow-${target}`, level: "warn", category: "mapping", applied: true,
            message: `${shared.length} separate accounts share one "${poolKey}" row because the template offers ${pool.rows.length}: ${shared.join(" · ")}. The row's total is correct and each account is listed on the generated workbook's "Attached schedules" sheet and in Provenance — but the work paper itself shows one caption for several accounts, so use the attached schedule where the return needs the line itemised.`,
            target: `${sheetName}!${row}`,
          });
          log.push(`${poolKey}: ${shared.length} accounts share row ${row} — listed on the Attached schedules sheet`);
        }

        /* A column that belongs to neither the current nor the opening year is
           correctly not booked — but it was read, and dropping it without
           saying so is how a set of accounts one year ahead of the engagement
           passes unnoticed. Name the year and how many figures it carried. */
        {
          const seenByYear = new Map<number, number>();
          for (const list of Object.values(contributions)) {
            for (const c of list) {
              for (const y of c.srcYears || []) {
                if (typeof y === "number") seenByYear.set(y, (seenByYear.get(y) || 0) + 1);
              }
            }
          }
          const spare = [...seenByYear.entries()]
            .filter(([y]) => y !== caseYears.cy && y !== caseYears.py)
            .sort((a, b) => b[0] - a[0]);
          if (spare.length && caseYears.cy) {
            rv({
              id: "year-columns-unused", level: "info", category: "consistency",
              message: `${spare.map(([y, n]) => `${n} figure(s) dated ${y}`).join(", ")} ${spare.length === 1 ? "was" : "were"} read from the documents and NOT booked: this work paper is for ${caseYears.cy}, so only the ${caseYears.cy} and ${caseYears.py} columns are used. Nothing was discarded quietly — if one of those years is the year you are preparing, set the year end in Basic Information and process again.`,
              target: `${SHEET.basic}!B1`,
            });
            log.push(`Columns not booked: ${spare.map(([y, n]) => `${y} (${n} figure(s))`).join(", ")} — outside the ${caseYears.cy}/${caseYears.py} pair`);
          }
        }
        /* The outcome, said first and said plainly. A run that booked nothing
           used to report "0 schedule lines populated" in the middle of a list
           of cheerful counts — "22 entity detail(s) detected", "32 schedule
           cell(s) prepared" — and then finish with the entity marked ready. */
        {
          const statementDocs = Object.values(state.entities.find((e) => e.id === entityId)?.docClasses || {})
            .filter((c) => !c.duplicateOf && ["cfc-financial-statements", "trial-balance"].includes(c.kind));
          if (!Object.keys(lines).length && statementDocs.length) {
            log.push(`NOTHING WAS BOOKED: ${statementDocs.length} statement document(s) were read and no schedule line was populated \u00b7 ${unmatched.length} caption(s) unmatched`);
            rv({
              id: "nothing-booked", level: "block", category: "mapping",
              message: `${statementDocs.length} set(s) of financial statements were read — ${statementDocs.map((c) => c.fileName).join(", ")} — and NOT ONE schedule line was populated from them. The work paper would carry only what the prior return and your own entries supply. Check the Review tab for the captions that could not be placed, and the Documents tab for any document that could not be classified, before generating.`,
              target: `${SHEET.is}!F7`,
            });
          } else {
            log.push(`${Object.keys(lines).length} schedule lines populated \u00b7 ${unmatched.length} unmatched`);
          }
        }
        updateEntity(entityId, { lines, relabels, sourceLabels, contributions, unmatched, statedResults, formResults, log: [...log] });

        // Entity particulars — from profile-allowed pages and the prior-year
        // 5471 — proposals only, and only into fields left blank.
        const fresh = state.entities.find((e) => e.id === entityId);
        if (fresh) {
          const profile = { ...fresh.profile };
          const ownership = { ...fresh.ownership };
          const categories = { ...fresh.categories };
          const detected = { ...fresh.detected };
          let filled = 0;
          const propose = (bucket: Record<string, string>, key: string, value: string, sourceLabel: string) => {
            if (!value || (bucket[key] !== undefined && bucket[key] !== "")) return;
            bucket[key] = value;
            detected[key] = { key, value, sourceLabel, confidence: "high" };
            filled++;
          };

          // Statement periods. A FISCAL accounting period on the prior 5471
          // (end month ≠ 12) wins the period shape — the classified statement
          // year still wins the case YEAR, and a disagreement is surfaced
          // instead of guessed away. Calendar 5471 periods propose LAST, so
          // they only fill seed-only cases with no statements at all.
          const periodEndYear = cf?.periodEnd ? Number(cf.periodEnd.slice(-4)) : null;
          const fiscalSeed = !!cf?.periodEnd && isFiscalPeriod(cf.periodEnd);

          /* FIRST: the period end the statements themselves print. They are
             the current-year source of truth, they carry the DAY and MONTH,
             and they need no assumption. Only when no statement states one
             does a prior return's period (rolled forward) or, last, 12/31
             have to stand in. A 30 June entity dated 12/31 pulls the wrong
             FX tables and files the wrong period, and nothing on the face of
             the work paper shows it. */
          const stmtPeriod = (() => {
            let best: { end: string; doc: string } | null = null;
            for (const c of Object.values(fresh.docClasses || {}) as DocClass[]) {
              const end = c.statementPeriodEnd;
              if (!end || c.duplicateOf) continue;
              /* A statement spreadsheet (read as a trial balance) states its
                 period in the column header — "December 31," over "2024". */
              if (c.kind !== "cfc-financial-statements" && c.kind !== "cfc-tax-return" && c.kind !== "trial-balance") continue;
              if (caseYears.cy && Number(end.slice(-4)) !== caseYears.cy) continue;
              if (!best) best = { end, doc: c.fileName };
            }
            return best;
          })();
          if (stmtPeriod) {
            propose(profile, "cyEnd", shortPeriod(stmtPeriod.end), `${stmtPeriod.doc} · period end printed on the statements`);
            const prior = periodMinusOneYear(stmtPeriod.end);
            if (prior) propose(profile, "pyEnd", shortPeriod(prior), `${stmtPeriod.doc} · the year before the period the statements report on`);
            /* Two documents stating two different period ends is a real
               question, not a preference: one of them is not this year's. */
            if (cf?.periodEnd && shortPeriod(cf.periodEnd) !== shortPeriod(periodMinusOneYear(stmtPeriod.end) || "")
                && shortPeriod(cf.periodEnd) !== shortPeriod(stmtPeriod.end)) {
              rv({
                id: "period-end-disagreement", level: "warn", category: "consistency",
                message: `${stmtPeriod.doc} reports on the period ended ${stmtPeriod.end}, but the prior 5471 in ${cfSource} states an annual accounting period ending ${cf.periodEnd}. The statements were used. If the entity changed its year end, say so in Basic Information; otherwise check that both documents belong to this entity.`,
                source: stmtPeriod.doc,
              });
            }
          }

          if (fiscalSeed && periodEndYear && caseYears.cy && caseYears.cy !== periodEndYear + 1) {
            rv({
              id: "cf-period-year-mismatch", level: "warn", category: "consistency",
              message: `The statements report on ${caseYears.cy} but the prior 5471's accounting period ends ${cf!.periodEnd} — confirm the engagement year and the period ends in Basic Information.`,
              source: cfSource,
            });
          } else if (fiscalSeed) {
            const nextEnd = periodPlusOneYear(cf!.periodEnd!);
            if (nextEnd) {
              /* Provenance that says what actually happened. This value was
                 NOT read from the return — the return states the year before
                 it. A citation naming only the document reads as a quotation
                 and gets reviewed as one. */
              propose(profile, "cyEnd", shortPeriod(nextEnd), `${cfSource} · annual accounting period ended ${cf!.periodEnd}, rolled forward one year`);
              propose(profile, "pyEnd", shortPeriod(cf!.periodEnd!), `${cfSource} · annual accounting period`);
            }
          }
          if (caseYears.cy) propose(profile, "cyEnd", `12/31/${String(caseYears.cy).slice(2)}`, `statement year ${caseYears.cy} — no period end stated, 31 December assumed`);
          if (caseYears.py) propose(profile, "pyEnd", `12/31/${String(caseYears.py).slice(2)}`, `statement year ${caseYears.py} — no period end stated, 31 December assumed`);
          if (cf?.periodEnd && !fiscalSeed) {
            const nextEnd = periodPlusOneYear(cf.periodEnd);
            if (nextEnd) {
              propose(profile, "cyEnd", shortPeriod(nextEnd), `${cfSource} · annual accounting period ended ${cf.periodEnd}, rolled forward one year`);
              propose(profile, "pyEnd", shortPeriod(cf.periodEnd), `${cfSource} · annual accounting period`);
            }
          }

          /* The prior year end is one year before the current one — always,
             for every year pair. Each proposal above already derives it that
             way, but a proposal only fills a BLANK field, so a prior year end
             proposed for the year the documents report on survived a later
             change of the work paper year: a 2024 work paper built from 2025
             statements kept 03/31/24 as its OPENING date, which is its closing
             date. The prior year end therefore follows the current one
             whenever the preparer has not typed it by hand. */
          {
            const want = priorPeriodEnd(profile.cyEnd);
            const pyTyped = !!profile.pyEnd && !detected.pyEnd;
            if (want && !pyTyped && profile.pyEnd !== want) {
              const was = profile.pyEnd;
              profile.pyEnd = want;
              detected.pyEnd = {
                key: "pyEnd", value: want, confidence: "high",
                sourceLabel: `the year before ${profile.cyEnd}, the period this work paper is prepared for`,
              };
              filled++;
              if (was) {
                log.push(`Prior year end moved ${was} → ${want} to follow the work paper year ${profile.cyEnd}`);
                rv({
                  id: "prior-year-end-followed", level: "info", category: "consistency", applied: true,
                  message: `The prior year end was ${was}, which belongs to a different work paper year. This work paper closes ${profile.cyEnd}, so it opens ${want}. Type a different date in Basic Information B2 only if the entity changed its year end.`,
                  target: `${SHEET.basic}!B2`,
                });
              }
            }
          }

          /* The year end decides the FX tables, Schedule E and J dates and the
             period the work paper is filed for. When no document stated one,
             say so plainly rather than letting an AUTO badge imply it was
             read from a document. */
          if (profile.cyEnd && /assumed/i.test(detected.cyEnd?.sourceLabel || "")) {
            rv({
              id: "period-end-assumed", level: "warn", category: "consistency",
              message: `No document states the period end, so 31 December was assumed and Basic Information reads ${profile.cyEnd}. If this entity has a fiscal year end — 30 June and 31 March are the common ones — correct B1 and B2 before generating: the year end selects the exchange-rate tables and dates Schedules E and J.`,
              target: `${SHEET.basic}!B1`,
            });
          }
          if (cf && !cf.periodEnd) {
            rv({
              id: "cf-period-unread", level: "info", category: "carry-forward",
              message: `The prior 5471's annual accounting period line could not be read from ${cfSource} — the period ends were taken from the statements instead. Confirm Basic Information B1/B2.`,
              source: cfSource,
            });
          }

          // The prior-year 5471's identity block is more authoritative for the
          // CFC's particulars than generic caption detection — propose it FIRST
          // so a cover page can't claim the address with the accountant's.
          if (cf) {
            propose(profile, "legalName", cf.cfcName || "", `${cfSource} · 5471 face`);
            const cfAddr = addressLines(cf.cfcAddress);
            propose(profile, "addr1", cfAddr[0] || "", `${cfSource} · 5471 face`);
            propose(profile, "addr2", cfAddr[1] || "", `${cfSource} · 5471 face`);
            propose(profile, "addr3", cfAddr[2] || "", `${cfSource} · 5471 face`);
            propose(profile, "formed", cf.formed || "", `${cfSource} · 5471 face`);
            propose(profile, "countryInc", cf.countryInc || "", `${cfSource} · 5471 item 1c (country under whose laws incorporated)`);
            {
              const byCode = !cf.activity ? naicsDescription(cf.activityCode) : null;
              propose(profile, "activity", cf.activity || byCode || "",
                byCode ? `${cfSource} · 5471 face item f, activity code ${cf.activityCode} — description from the code, confirm` : `${cfSource} · 5471 face`);
            }
            propose(profile, "booksPerson", cf.booksPerson || "", `${cfSource} · 5471 item 2d`);
            propose(profile, "booksAddr1", cf.booksAddress[0] || "", `${cfSource} · 5471 item 2d`);
            propose(profile, "booksAddr2", cf.booksAddress[1] || "", `${cfSource} · 5471 item 2d`);
            propose(profile, "currency", cf.functionalCurrency || "", `${cfSource} · 5471 face`);
            // No template cells exist for these three — they live on the
            // profile (and refId keys the fan-out idempotence + Sch E E16).
            propose(profile, "refId", cf.referenceIds[0] || "", `${cfSource} · 5471 face`);
            propose(profile, "principalPlace", cf.principalPlace || "", `${cfSource} · 5471 face`);
            propose(profile, "activityCode", cf.activityCode || "", `${cfSource} · 5471 face`);
            // The filing person is the client. Overwrite only the untouched
            // stakeholder default — a hand-typed client name always survives.
            if (cf.holderName && profile.clientName === state.stakeholder) {
              profile.clientName = cf.holderName;
              detected.clientName = { key: "clientName", value: cf.holderName, sourceLabel: `${cfSource} · person filing`, confidence: "high" };
              filled++;
            }
            /* Item C on the face can include stock attributed to the filer
               from family members. Stock a NON-U.S. relative owns is not
               attributed to a U.S. person for CFC purposes (section
               958(b)(1)), so a mother holding 40% whose UK son holds 50% can
               print 90% on item C while Schedule B Part I — the U.S.
               shareholders — lists her at 40%. Attribution between U.S.
               persons is real (a U.S. spouse's 25.5% makes 51%), so item C is
               only lowered to what the U.S. shareholders hold between them,
               never below it; the difference is raised, not hidden. */
            const filerName = cf.holderName || "";
            const filerPartI = (cf.usHolders || []).find((h) => typeof h.pct === "number" && !!filerName
              && (samePerson(h.name, filerName) || entitySimilarity(h.name, filerName) >= 0.5));
            const usHeld = (cf.usHolders || []).reduce((n, h) => n + (typeof h.pct === "number" ? h.pct : 0), 0);
            /* The difference has to be held by someone who is not a U.S.
               shareholder: Schedule B Part II names them. A return whose Part
               I percentage simply disagrees with item C (5 shares of 5 printed
               as "5.00%") has no such holder, and item C stands. */
            const usList = cf.usHolders || [];
            const partII = (cf.holders || []).filter((h) => !h.fromPartI);
            const totalShares = partII.reduce((n, h) => n + (Number(h.eoy) || 0), 0);
            const nonUsPct = totalShares > 0
              ? partII.filter((h) => !usList.some((u) => samePerson(u.name, h.name) || entitySimilarity(u.name, h.name) >= 0.5))
                .reduce((n, h) => n + (Number(h.eoy) || 0), 0) / totalShares * 100
              : 0;
            let ownPct = cf.pctVoting;
            if (filerPartI && typeof filerPartI.pct === "number") {
              if (ownPct === undefined) ownPct = filerPartI.pct;
              else if (ownPct > usHeld + 0.01 && nonUsPct > 0.01 && ownPct - usHeld <= nonUsPct + 0.5) {
                if (filerPartI.pct >= 10) {
                  /* The filer is a U.S. shareholder on its own Part I stake:
                     item C comes down to what the U.S. shareholders hold. */
                  rv({
                    id: "cf-own-pct", level: "warn", category: "carry-forward", applied: true,
                    message: `The prior-year Form 5471 prints ${ownPct}% on item C, but the U.S. shareholders its Schedule B Part I lists hold ${usHeld}% between them (${filerPartI.name} ${filerPartI.pct}%). The difference can only be stock attributed from non-U.S. persons, which is not attributed for CFC purposes, so the ownership percentage was set to ${usHeld}% — confirm it.`,
                    source: cfSource,
                  });
                  ownPct = usHeld;
                } else {
                  /* Below 10% directly, the filer is only a filer through the
                     attributed stock: lowering item C would contradict the
                     reason the prior return was filed at all. The filed
                     position stands and the attribution question is raised. */
                  rv({
                    id: "cf-own-pct", level: "warn", category: "carry-forward", applied: true,
                    message: `The prior-year Form 5471 prints ${ownPct}% on item C, while its Schedule B Part I lists ${filerPartI.name} directly at ${filerPartI.pct}% — the rest is stock attributed from a non-U.S. holder. ${filerPartI.pct}% alone is under the 10% U.S.-shareholder threshold, so the return was filed on the attributed stock: Basic Information keeps the ${ownPct}% as filed. For CFC status, section 958(b)(1) does not attribute a nonresident alien's stock to a U.S. person; confirm the ownership and the CFC answer before filing.`,
                    source: cfSource,
                  });
                }
              }
            }
            /* Neither item C nor a Part I percentage was read, but Schedule B
               lists the shares: the filer's own shares over all shares held
               is the percentage ("SEAN DE CUIRTEIS 100 of 100"). */
            let fromShares = false;
            if (ownPct === undefined && filerName) {
              const list = (cf.holders && cf.holders.length ? cf.holders : cf.usHolders) || [];
              const total = list.reduce((n, h) => n + (Number(h.eoy) || 0), 0);
              const mine = list.filter((h) => samePerson(h.name, filerName) || entitySimilarity(h.name, filerName) >= 0.5)
                .reduce((n, h) => n + (Number(h.eoy) || 0), 0);
              if (total > 0 && mine > 0) { ownPct = Math.round((mine / total) * 10000) / 100; fromShares = true; }
            }
            if (ownPct !== undefined) {
              const src = fromShares ? `${cfSource} · Sch B shares held by the filer`
                : ownPct === cf.pctVoting ? `${cfSource} · 5471 face` : `${cfSource} · Sch B Part I`;
              propose(ownership, "ownStart", String(ownPct), src);
              propose(ownership, "ownEnd", String(ownPct), src);
            }
            /* CFC status from the prior return's own evidence: category 5
               (U.S. shareholder of a CFC) checked means it was one; otherwise
               the U.S. shareholders of 10% or more that Part I lists must hold
               more than 50% between them. Neither known — the prior filing
               alone is the only evidence, as before. */
            const partIPcts = (cf.usHolders || []).map((h) => h.pct).filter((v): v is number => typeof v === "number");
            const usTenPct = partIPcts.filter((v) => v >= 10).reduce((n, v) => n + v, 0);
            /* The filer's own item C above 50% (as filed, attribution
               included) answers it the same way the reviewed work paper does. */
            const itemCControl = typeof ownPct === "number" && ownPct > 50;
            const cfcAnswer = cf.categories.some((c) => /^5/.test(c)) ? "Yes"
              : itemCControl ? "Yes"
              : partIPcts.length ? (usTenPct > 50 ? "Yes" : "No")
              : "Yes";
            propose(ownership, "cfc", cfcAnswer,
              cf.categories.some((c) => /^5/.test(c)) ? `${cfSource} · category 5 filer`
              : itemCControl ? `${cfSource} · item C ${ownPct}% as filed`
              : partIPcts.length ? `${cfSource} · Sch B Part I U.S. shareholders hold ${usTenPct}%`
              : `${cfSource} · prior-year filing`);
            /* "Does the entity have a 10% CORPORATE shareholder?" is a question
               about the holders' legal form, not the filer's own percentage —
               the old rule answered Yes for any 10% holder, individuals
               included. Yes only when a Schedule B holder is a company. */
            {
              /* The register first. The form truncates a long name at the
                 column edge -- "ARCK TRUST (ARCK LEGACY TRUS" no longer ENDS
                 in "trust", so the corporate test failed on it and the answer
                 came out No although the entity is 98% owned by a trust. */
              const holders = [...directory, ...(cf.holders || []), ...(cf.usHolders || [])];
              const corporate = holders.filter((h) => isCorporateName(h.name));
              if (corporate.length) {
                propose(ownership, "tenPct", "Yes", `${cfSource} · Schedule B holder ${corporate.map((h) => h.name).join(", ")}`);
              } else if (holders.length) {
                propose(ownership, "tenPct", "No", `${cfSource} · Schedule B holders are individuals`);
              }
            }
            /* Item H on the face: the filer's own Shareholder / Officer /
               Director boxes. Parsed for years and never proposed. */
            {
              const filer = cf.holderName;
              const people = cf.itemH || [];
              const mine = people.find((p) => !!filer && entitySimilarity(p.name, filer) >= 0.5)
                ?? (people.length === 1 ? people[0] : undefined);
              if (mine) {
                propose(ownership, "isOfficer", mine.isOfficer || mine.isDirector ? "Yes" : "No", `${cfSource} · Item H boxes for ${mine.name}`);
              }
              /* Item H could not answer it. The accounts name their directors
                 on the same page as the shareholder register, and that is the
                 current year's answer rather than the prior return's. */
              if (directors.length) {
                const me = directors.find((n) => !!filer && samePerson(n, filer));
                if (me) propose(ownership, "isOfficer", "Yes", `${directorySource} · named as a director`);
              }
            }
            // The transition tax (section 965) was a 2017/2018 event.
            if (caseYears.cy && caseYears.cy >= 2019) propose(ownership, "transition", "No", `tax year ${caseYears.cy} is after the 2017–18 transition years`);
            if (cfcAnswer === "Yes" && cf.pctVoting !== undefined && cf.pctVoting <= 50) {
              rv({
                id: "cf-cfc-status", level: "warn", category: "carry-forward",
                message: `CFC = Yes was carried from the prior filing, but this filer's voting share is ${cf.pctVoting}% — CFC status depends on COMBINED US-shareholder ownership (more than 50%). Confirm it still holds for the current year.`,
                source: cfSource, applied: true,
              });
            }
            const fiscalDays = fiscalSeed ? daysBetweenPeriods(profile.pyEnd, profile.cyEnd) : null;
            // Not a CFC: there are no CFC days to count.
            if (ownership.cfc === "No") { /* left blank */ }
            else if (fiscalDays) {
              propose(ownership, "daysCfc", String(fiscalDays), "full fiscal-year CFC");
              propose(ownership, "daysOwned", String(fiscalDays), "full fiscal-year ownership");
            } else if (caseYears.cy) {
              const days = String(daysInYear(caseYears.cy));
              propose(ownership, "daysCfc", days, "full-year CFC");
              propose(ownership, "daysOwned", days, "full-year ownership");
            }
            if (cf.filerIdMasked) {
              rv({
                id: "cf-filer-id", level: "info", category: "carry-forward",
                message: `The filing person's identifying number ${cf.filerIdMasked} appears on the prior 5471 face (shown masked — the tool never stores the full number).`,
                source: cfSource,
              });
            }
            const hasCurrentDocs = bundles.some((b) =>
              !b.cls.duplicateOf && (b.cls.kind === "cfc-financial-statements" || b.cls.kind === "cfc-tax-return" || b.cls.kind === "trial-balance"));
            if (!hasCurrentDocs) {
              rv({
                id: "cf-seed-only", level: "warn", category: "source-gap",
                message: `This work paper was seeded from the prior-year Form 5471 only — upload ${profile.legalName || fresh.name}'s current-year financial statements and re-process to fill the income statement and balance sheet.`,
                source: cfSource,
              });
            }
            for (const cat of cf.categories) if (!categories[cat]) {
              categories[cat] = true;
              // Provenance handle for the staleness prune: an auto-seeded
              // category clears when its source 5471 is removed.
              detected["cat:" + cat] = { key: "cat:" + cat, value: "Yes", sourceLabel: `${cfSource} · Item B`, confidence: "high", src: { doc: cfSource } };
              filled++;
            }
            if (cf.categories.length) {
              rv({
                id: "cf-categories", level: "warn", category: "carry-forward",
                message: `Filer categories ${cf.categories.join(", ")} pre-filled from the prior-year 5471 checkbox row ("${(cf.categoriesRaw || "").replace(/^.*?(1a)/, "$1")}") — confirm they still apply for ${caseYears.cy ?? "the current year"}.`,
                target: `${SHEET.basic}!B42:B50`, source: cfSource, applied: true,
              });
            }
          }

          /* The questionnaire answers questions the statements and the prior
             return never do. Blank fields only, like every other source —
             except the entity's name, where the return's UPPERCASE print is
             replaced by the questionnaire's own casing when the two are
             clearly the same company. */
          const isUpper = (v: string) => v === v.toUpperCase() && /[A-Z]/.test(v);
          /* The statements' own header is the name as the company writes it;
             the IRS-printed return shouts it in capitals. Same name, better
             case — the questionnaire, read next, may improve on it again. */
          const stmtName = bundles.find((x) => x.cls.kind === "cfc-financial-statements" && x.cls.entityName)?.cls.entityName || "";
          if (stmtName && !isUpper(stmtName) && profile.legalName && isUpper(profile.legalName) && entitySimilarity(profile.legalName, stmtName) >= 0.8) {
            profile.legalName = stmtName;
            detected.legalName = { key: "legalName", value: stmtName, sourceLabel: "financial statements · header", confidence: "high" };
            log.push(`entity name re-cased from the statements' header: ${stmtName}`);
          }
          if (questionnaire) {
            const qs = `${questionnaire.fileName} · client questionnaire`;
            if (questionnaire.corporationName) {
              if (profile.legalName && isUpper(profile.legalName) && entitySimilarity(profile.legalName, questionnaire.corporationName) >= 0.6) {
                profile.legalName = questionnaire.corporationName;
                detected.legalName = { key: "legalName", value: questionnaire.corporationName, sourceLabel: qs, confidence: "high" };
                log.push(`entity name re-cased from the questionnaire: ${questionnaire.corporationName}`);
              } else {
                propose(profile, "legalName", questionnaire.corporationName, qs);
              }
            }
            if (questionnaire.countryInc) propose(profile, "countryInc", questionnaire.countryInc, qs);
            if (questionnaire.currency) propose(profile, "currency", questionnaire.currency, qs);
            if (questionnaire.activity) propose(profile, "activity", questionnaire.activity, qs);
            if (questionnaire.formed) propose(profile, "formed", questionnaire.formed, qs);
            if (questionnaire.address.length) {
              propose(profile, "addr1", questionnaire.address[0], qs);
              if (questionnaire.address[1]) propose(profile, "addr2", questionnaire.address[1], qs);
            }
            if (questionnaire.isOfficer !== undefined) propose(ownership, "isOfficer", questionnaire.isOfficer ? "Yes" : "No", `${qs} · "${questionnaire.roles}"`);
            if (questionnaire.filerShares && questionnaire.sharesOutstanding?.eoy) {
              const pct = Math.round((questionnaire.filerShares.eoy ?? 0) / questionnaire.sharesOutstanding.eoy * 10000) / 100;
              if (pct > 0) { propose(ownership, "ownEnd", String(pct), qs); propose(ownership, "ownStart", String(pct), qs); }
            }
          }

          const profileCandidates: ProfileCandidate[] = [];
          for (const { rows, doc } of profileGrids) {
            const found = detectProfile(rows, { doc });
            for (const cand of found.unmatched) profileCandidates.push(cand);
            for (const d of found.profile) propose(profile, d.key, d.value, d.sourceLabel);
            for (const d of found.ownership) propose(ownership, d.key, d.value, d.sourceLabel);
            for (const cat of found.categories) if (!categories[cat]) {
              categories[cat] = true;
              detected["cat:" + cat] = { key: "cat:" + cat, value: "Yes", sourceLabel: "profile documents", confidence: "medium" };
              filled++;
            }
          }

          if (!profile.currency) {
            for (const { rows } of profileGrids) {
              const sniff = sniffCurrency(rows);
              if (sniff) { propose(profile, "currency", sniff.value, sniff.sourceLabel); break; }
            }
          }
          /* A functional currency names its country, and the rate tables
             already carry the mapping. Chile's Form 22 has no "country of
             incorporation" caption at all, so the field stayed blank on a
             filing that says REPUBLICA DE CHILE across the top — and Schedule
             E's "country to which tax is paid" reads from it. A shared
             currency names no single country, so those are left alone. */
          if (profile.currency && !profile.countryInc) {
            const meta = FX_META[profile.currency];
            const country = meta?.country;
            if (country && !/\b(zone|union|area)\b/i.test(country)) {
              propose(profile, "countryInc", country, `functional currency ${profile.currency}`);
            }
          }
          // C-02: ONE legal-name input drives the header. The card name and
          // the B4 header follow legalName while still default-ish; renaming
          // the card by hand stops the follow (renameEntity sets both).
          if (profile.legalName && (!profile.entityShort || /^Entity \d+$/.test(profile.entityShort))) {
            profile.entityShort = profile.legalName;
          }
          const nameSync = profile.legalName && /^Entity \d+$/.test(fresh.name) ? { name: profile.legalName } : {};

          /* Candidates for the AI profile pass: deduped, capped at 60 for
             the whole entity, and dropped when a mapping rule already claims
             the caption — that one is a line item, not a particular. */
          const seenCand = new Set<string>();
          const unmatchedProfile: ProfileCandidate[] = [];
          for (const cand of profileCandidates) {
            if (unmatchedProfile.length >= 60) break;
            if (seenCand.has(cand.norm)) continue;
            seenCand.add(cand.norm);
            if (matchRule(cand.caption, state.rules) !== null) continue;
            unmatchedProfile.push(cand);
          }

  /* The engagement year the preparer entered against the year the documents
             are for. The column routing follows the DOCUMENTS -- a set of accounts
             headed "year ended 31 March 2025" books its 2025 column as the current
             year whatever Basic Information says -- so a year end typed over the
             detected one produces a work paper dated one year and filled with
             another's figures. Nothing about that is visible on the face of it, which
             is why it blocks rather than warns. */
          {
            const typed = yearOfShortPeriod(profile.cyEnd);
            if (typed && caseYears.cy && typed !== caseYears.cy) {
              rv({
                id: "profile-year-vs-documents", level: "block", category: "consistency",
                message: `Basic Information gives the current year end as ${profile.cyEnd} — year ${typed} — but every figure booked here comes from documents reporting on ${caseYears.cy}. The work paper would be dated ${typed} and filled with ${caseYears.cy} figures. Either set the year end back to the documents' year, or supply the ${typed} statements and re-process.`,
                target: `${SHEET.basic}!B1`,
              });
            }
          }

          updateEntity(entityId, { profile, ownership, categories, detected, unmatchedProfile, ...nameSync });
          if (filled) {
            log.push(`${filled} entity detail(s) detected from the documents`);
            logEvent("Entity details detected", `${filled} field(s) auto-filled`, fresh.name, "system");
            updateEntity(entityId, { log: [...log] });
          }
          if (profile.currency) actions.autoFillRates(entityId, false);
          inLieuIncomeTax(entityId, profile, review, rv, log);
        }
      }

      /* Step 4 — materialize schedule writes and the review record. */
      if (step === 4) {
        /* Beginning-of-year Schedule F column.
           A single-period statement (Yuki, most software exports) carries only
           the current year, so column (a) has no source in the CURRENT-year
           documents. The prior return's closing column IS the opening column,
           and the tool already read it — it was only ever used to print a
           comparison note, never written. Carry it AS FILED per the agreed
           policy: no re-splitting across lines, source stamped, and one review
           item where the prior grouping differs from this year's.
           Filed figures are USD; column (a) is local currency, so multiply by
           the prior year-end rate (EUR = USD x 0.905). */
        /* Deduction lines are summed into row 51 and subtracted from income, so
           a line whose total came out negative would ADD to profit. Correct it
           once every contribution is in — see negativeDeductionTotals. */
        {
          const curD = state.entities.find((e) => e.id === entityId);
          const flip = curD ? negativeDeductionTotals(curD.lines) : [];
          if (curD && flip.length) {
            const lines = { ...curD.lines };
            for (const k of flip) {
              const amt = lines[k].amount as number;
              lines[k] = { ...lines[k], amount: -amt };
              const spec = IS_LINES.find((l) => `IS:${l.row}` === k);
              rv({
                id: `deduction-sign-${k}`, level: "warn", category: "mapping", applied: true,
                message: `${spec?.label ?? k} totalled ${amt.toLocaleString()} — a negative deduction. Total deductions (row 51) is subtracted from income, so that would ADD ${Math.abs(amt).toLocaleString()} to profit; it has been booked as ${Math.abs(amt).toLocaleString()}. Statements commonly print financial costs as negatives while operating costs print positive. If this line is genuinely a net credit, edit it in the Exception Center.`,
                target: `${SHEET.is}!F${k.split(":")[1]}`, suggestedValue: Math.abs(amt),
              });
            }
            updateEntity(entityId, { lines });
            log.push(`${flip.length} deduction line(s) re-signed so they reduce income`);
          }
        }

        if (cf?.priorClosingUSD && !cfStale) {
          const cur0 = state.entities.find((e) => e.id === entityId);
          /* WHICH rate turns the prior return's filed USD back into opening
             local currency, in order of authority:

               1. the rate the prior return itself printed (Sch H line 5e or
                  the Schedule M header). Dividing the filed USD by anything
                  else does not reproduce the local-currency figures that
                  return was built from, and the difference is pure noise;
               2. the currency's dollar peg, where there is one;
               3. the published table.

             Using the table where the filing stated its own rate is what put
             the opening column 1.6% out on the reconciliation test. */
          const rateSource = openingRateFor(cur0?.profile?.currency, numeric(cur0?.fx?.pyRate), cf.priorRate?.value)
            ?? { rate: NaN, why: "no usable prior-year rate" };
          const rate = rateSource.rate;
          if (cur0 && isFinite(rate) && rate > 0) {
            type BoyKey = "cash" | "ar" | "oca" | "depreciable" | "accumDep"
              | "ap" | "ocl" | "commonStock" | "re"
              | "badDebts" | "inventories" | "loansToShareholders" | "land"
              | "otherAssets" | "loansFromShareholders" | "otherLiabilities"
              | "preferredStock" | "paidInSurplus" | "treasuryStock";
            /* Each key lists the template row(s) that can hold it. Sch F lines 5
               and 16 print as one figure but are =SUM() subtotals here (rows 15
               and 47) and are absent from BS_LINES, so a value seeded on the
               subtotal is dropped before it ever reaches the writer. Carry the
               filed aggregate onto the first free detail row the subtotal spans
               instead — the subtotal then computes it, and column (a) balances. */
            /* Signs follow the template's own totals, not the form's brackets:
               D42 sums D10:D15 and D28:D38, so bad debts and the accumulated
               contra lines must be NEGATIVE; D63 ends "- D62", so treasury
               stock enters POSITIVE and the formula does the subtracting. */
            const boyMap: Array<[BoyKey, number[], boolean, string?]> = [
              ["cash", [10], false], ["ar", [11], false], ["badDebts", [12], true],
              ["inventories", [14], false], ["oca", [16, 17, 18], false, "Other current assets"],
              ["loansToShareholders", [19], false],
              ["depreciable", [28], false], ["accumDep", [29], true],
              ["land", [32], false],
              ["otherAssets", [39, 40, 41], false, "Other assets"],
              ["ap", [46], false], ["ocl", [48, 49, 50], false, "Other current liabilities"],
              ["loansFromShareholders", [52], false],
              ["otherLiabilities", [54, 55, 56], false, "Other liabilities"],
              ["preferredStock", [58], false], ["commonStock", [59], false],
              ["paidInSurplus", [60], false], ["re", [61], false],
              ["treasuryStock", [62], false],
            ];
            const lines = { ...cur0.lines };
            const relabels = { ...cur0.relabels };
            const seeded: string[] = [];
            /* An asset is not negative. Where the prior return's own contra
               lines are concerned it is (bad debts, accumulated depreciation),
               and those carry `negate` above. Anywhere else a negative filed
               asset means the figure was read out of the wrong column of that
               return — a liability landing on the asset side — and the only
               visible symptom is Schedule F failing to balance at the
               beginning of the year, with nothing to say which line is wrong.
               The figure is still carried exactly as filed, because a carried
               balance is evidence and not ours to correct; the line is named
               instead. */
            const suspectAssets: Array<{ what: string; row: number; amount: number }> = [];
            const ASSET_KEY: Record<string, string> = {
              cash: "cash", ar: "trade receivables", inventories: "inventories",
              oca: "other current assets", loansToShareholders: "loans to shareholders",
              depreciable: "depreciable assets", land: "land",
              otherAssets: "other assets",
            };
            /* The statements' own prior-year column is the opening balance
               sheet in the entity's own captions and currency, and the
               preparer's paper takes it from there. When it has already
               opened the balance sheet, the prior return's closing figures
               are not layered on top — they are only used to cross-check it
               (the cf-boy reconciliation below). Carrying them onto whatever
               lines the statements left free put the same debtors on two
               lines. */
            const statementsOpened = Object.keys(lines).filter((k) => k.startsWith("BS:") && typeof lines[k]?.boy === "number").length;
            if (statementsOpened >= 3) {
              log.push(`Beginning-of-year balances taken from the statements' prior-year column (${statementsOpened} line(s)); the prior-year Form 5471 is used to cross-check them, not added on top`);
            }
            for (const [key, rows, negate, aggregateLabel] of boyMap) {
              if (statementsOpened >= 3) break;
              const filed = cf.priorClosingUSD[key]?.value;
              if (typeof filed !== "number") continue;
              // Never overwrite a value the documents or the preparer supplied.
              /* A group the statements already opened (their prior-year
                 column booked deferred tax to 48) is not topped up with the
                 prior return's whole group total on 49: that total contains
                 the same balance, and the opening column would count it
                 twice. */
              if (rows.length > 1 && rows.some((r) => typeof lines[`BS:${r}`]?.boy === "number")) continue;
              /* The attached statement lists the accounts behind the filed
                 total ("CREDIT CARD 11,410 / DEFERRED REVENUE 51,481" = line 16
                 62,891). Each opens on the row this year's statements booked
                 the same account to, so the two columns line up; an account
                 with no such row takes a free one under its filed caption. */
              const split = cf.statementCaptions?.[key as keyof NonNullable<CarryForward["statementCaptions"]>]?.lines;
              if (rows.length > 1 && split && split.length > 1) {
                const stmtName = cf.statementCaptions?.[key as keyof NonNullable<CarryForward["statementCaptions"]>]?.statement || "attached statement";
                const words = (s: string) => new Set(String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/)
                  .filter((w) => w.length >= 4).map((w) => w.replace(/s$/, "")));
                const shares = (a: string, b: string) => { const x = words(a); return [...words(b)].some((w) => x.has(w)); };
                const taken = new Set<number>();
                for (const ln of split) {
                  const localLn = Math.round(ln.value * rate * 100) / 100;
                  let r = rows.find((x) => !taken.has(x) && typeof lines[`BS:${x}`]?.boy !== "number" && shares(relabels[`BS:${x}`] || "", ln.label));
                  if (r === undefined) r = rows.find((x) => !taken.has(x) && lines[`BS:${x}`] === undefined && !relabels[`BS:${x}`]);
                  if (r === undefined) r = rows[rows.length - 1];
                  taken.add(r);
                  const kk = `BS:${r}`;
                  const prevBoy = typeof lines[kk]?.boy === "number" ? lines[kk]!.boy as number : 0;
                  lines[kk] = { ...(lines[kk] || {}), boy: Math.round((prevBoy + (negate ? -Math.abs(localLn) : localLn)) * 100) / 100 };
                  if (!relabels[kk]) relabels[kk] = `${titleCaseCaption(ln.label)} (per prior-year Form 5471, ${stmtName})`;
                  seeded.push(`${kk}=${localLn.toLocaleString()}`);
                }
                continue;
              }
              const row = rows.find((r) => typeof lines[`BS:${r}`]?.boy !== "number");
              if (row === undefined) continue;      // every detail row already taken
              const k = `BS:${row}`;
              const local = Math.round(filed * rate * 100) / 100;
              lines[k] = { ...(lines[k] || {}), boy: negate ? -Math.abs(local) : local };
              // An aggregate parked on a detail row must not keep that row's
              // stock caption ("Prepaid expenses"), or the attached statement
              // would describe money that is not there.
              const stmt = cf.statementCaptions?.[key as keyof NonNullable<CarryForward["statementCaptions"]>];
              if (rows.length > 1 && !relabels[k]) {
                if (stmt) relabels[k] = `${titleCaseCaption(stmt.label)} (per prior-year Form 5471, ${stmt.statement})`;
                else if (aggregateLabel) relabels[k] = `${aggregateLabel} (per prior-year Form 5471)`;
              }
              seeded.push(`${k}=${local.toLocaleString()}`);
              if (!negate && local < 0 && ASSET_KEY[key]) suspectAssets.push({ what: ASSET_KEY[key], row, amount: local });
            }
            for (const a of suspectAssets) {
              rv({
                id: `cf-negative-asset-${a.row}`, level: "warn", category: "carry-forward",
                message: `The prior-year Form 5471 carries a NEGATIVE opening ${a.what} of ${a.amount.toLocaleString()} (Schedule F line ${a.row}, column (a)). An asset line is not negative unless it is a contra account, so this is usually a liability read from the wrong column of that return's Schedule F — and it is why the opening column does not balance. The figure was carried exactly as filed, because a carried balance is evidence: check it against the prior return's Schedule F column (b) and move it to the liabilities side if it belongs there.`,
                target: `${SHEET.bs}!D${a.row}`, source: cfSource,
              });
            }
            /* One balance, two lines. The prior return filed an opening
               balance on one line, and this year's statements booked a closing
               balance of the SAME amount (within the return's whole-dollar
               rounding) on another line of the same side, with no opening of
               its own — "Due to Shareholders 57,226.88" on line 18 against the
               filed 57,228 on line 19. It is one account, and a column that
               moves it between lines makes both lines look like movements. The
               closing balance follows the line the return was filed on, and
               the preparer is told, so either line can still be chosen. */
            const contributions = { ...cur0.contributions };
            const sourceLabels = { ...cur0.sourceLabels };
            const aligned: string[] = [];
            const tol = Math.max(1, rate) * 1.01;
            for (const kb of Object.keys(lines)) {
              const lb = lines[kb];
              if (!kb.startsWith("BS:") || typeof lb?.boy !== "number" || typeof lb?.eoy === "number" || !lb.boy) continue;
              const ob = cur0.lines[kb];
              if (ob && ob.boy === lb.boy) continue;      // not opened by this carry-forward
              const side = bsSide(kb) || (/^BS:(1[6-8])$/.test(kb) ? "assets" : /^BS:(4[89]|5[0-6])$/.test(kb) ? "liabilities" : null);
              const cands = Object.keys(lines).filter((ke) => {
                const le = lines[ke];
                if (ke === kb || !ke.startsWith("BS:") || typeof le?.eoy !== "number" || typeof le?.boy === "number") return false;
                const s2 = bsSide(ke) || (/^BS:(1[6-8])$/.test(ke) ? "assets" : /^BS:(4[89]|5[0-6])$/.test(ke) ? "liabilities" : null);
                return !!side && s2 === side && Math.abs(Math.abs(le.eoy as number) - Math.abs(lb.boy as number)) <= tol;
              });
              if (cands.length !== 1) continue;
              const ke = cands[0];
              const caption = (contributions[ke] || [])[0]?.label || relabels[ke] || ke;
              lines[kb] = { ...lb, eoy: lines[ke]!.eoy };
              delete lines[ke];
              if (contributions[ke]) { contributions[kb] = [...(contributions[kb] || []), ...contributions[ke]]; delete contributions[ke]; }
              if (sourceLabels[ke]) { sourceLabels[kb] = sourceLabels[ke]; delete sourceLabels[ke]; }
              relabels[kb] = relabels[ke] && !/^BS:/.test(relabels[ke]) ? relabels[ke] : caption;
              delete relabels[ke];
              aligned.push(`${ke}→${kb}`);
              rv({
                id: `boy-eoy-line-${kb}`, level: "info", category: "carry-forward", applied: true,
                sourceLabel: caption,
                message: `"${caption}" closes at ${(lines[kb]!.eoy as number).toLocaleString()} and the prior-year Form 5471 filed the same balance (${(lb.boy as number).toLocaleString()} opening) on Schedule F line ${kb.split(":")[1]}. This year's statements would have put it on line ${ke.split(":")[1]}; it was kept on the line the return was filed on so both columns show one account. Move it on Mapping & adjustments if the other line is right — and move the opening balance with it.`,
                target: `${SHEET.bs}!F${kb.split(":")[1]}`, source: cfSource,
              });
            }
            if (aligned.length) log.push(`Closing balance(s) kept on the line the prior return filed them on: ${aligned.join(", ")}`);
            if (seeded.length) {
              updateEntity(entityId, { lines, relabels, openingRate: { rate, why: rateSource.why, source: cfSource },
                ...(aligned.length ? { contributions, sourceLabels } : {}) });
              log.push(`${seeded.length} beginning-of-year balance(s) carried from the prior-year Form 5471`);
              logEvent("Beginning-of-year balances carried forward",
                `${seeded.length} line(s) from ${cfSource} Sch F col (b), converted at ${rateSource.why}`,
                cur0.name, "system");
            }
          }
        }

        /* Capital stock keeps the class the prior return filed it under. */
        if (cf?.priorClosingUSD) {
          const curC = state.entities.find((e) => e.id === entityId);
          const moved = curC ? capitalClassFromPrior(curC, {
            preferredStock: cf.priorClosingUSD.preferredStock?.value,
            commonStock: cf.priorClosingUSD.commonStock?.value,
          }) : null;
          if (curC && moved) {
            updateEntity(entityId, moved);
            log.push("Capital stock booked on Schedule F line 20a (preferred), the class the prior-year Form 5471 filed it under");
            rv({
              id: "capital-class-prior", level: "info", category: "carry-forward", applied: true,
              message: `The statements print the capital without its class ("${(curC.contributions?.["BS:59"] || []).map((c) => c.label).filter((v, i, a) => a.indexOf(v) === i).join('", "')}"). The prior-year Form 5471 filed it on Schedule F line 20a (preferred stock) and left line 20b (common stock) blank, so it was kept on line 20a. If the shares are common stock, reassign the caption on Mapping & adjustments.`,
              target: `${SHEET.bs}!F58`, source: cfSource,
            });
          }
        }

        // Shareholders seed from the prior 5471's Sch B Part II first —
        // merge-by-name, so hand-edited or hand-added rows always survive.
        /* Direct holders. The accounts' own directory first when there is
           one: it is this year's register, where the return's Schedule B Part
           II is last year's or older. On the filing that prompted this, Part
           II named only the trust and left two of the three holders out, so
           the direct total came to 98 of 100 shares. */
        if (directory.length || cf?.holders?.length) {
          const cur = state.entities.find((e) => e.id === entityId);
          if (cur) {
            const merged = [...(cur.shareholders || [])];
            const fromDirectory = directory.map((h) => ({
              name: h.name, classOfShares: h.classOfShares, boy: h.boy, eoy: h.eoy,
              source: `${directorySource} p.${h.page} · shareholder register · one holding printed, taken as BOY = EOY — confirm`,
            }));
            const fromReturn = (cf?.holders || []).map((h) => ({
              name: h.name, classOfShares: h.classOfShares, boy: h.boy, eoy: h.eoy,
              source: `${cfSource} · Sch B p.${h.page}${h.single ? " · single printed count taken as BOY = EOY — confirm" : ""}`,
            }));
            /* The form's column width cuts a long name off mid-word, so the
               return calls the trust "ARCK TRUST (ARCK LEGACY TRUS" while the
               register calls it "ARCK Trust". An exact comparison treats them
               as two holders and doubles the share count. One name being the
               start of the other is the same holder. */
            const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            const sameHolder = (a: string, b: string) => {
              const x = nameKey(a), y = nameKey(b);
              if (!x || !y) return false;
              const [short, long] = x.length <= y.length ? [x, y] : [y, x];
              return short.length >= 4 && (long === short || long.startsWith(short + " "));
            };
            for (const h of [...fromDirectory, ...fromReturn]) {
              if (!merged.some((s) => sameHolder(s.name, h.name))) {
                merged.push({ id: uid(), ...h });
              }
            }
            if (merged.length !== (cur.shareholders || []).length) updateEntity(entityId, { shareholders: merged });
            if (directory.length) {
              const missed = fromReturn.filter((r) => !directory.some((d) => sameHolder(d.name, r.name)));
              log.push(
                `${directory.length} direct shareholder(s) read from the ${directorySource} shareholder register` +
                (missed.length ? `; ${missed.length} further holder(s) came from ${cfSource} Schedule B Part II` : "") +
                ` (the register is this year's; Schedule B Part II is the prior return's)`,
              );
            }
          }
        }

        /* Schedule B Part I — the U.S. shareholders, which drive rows 7-14.
           Seeded into their own list, never merged into the direct holders:
           the same person commonly appears in both parts (directly and again
           through a trust) and merging would double-count ownership. */
        if (cf?.usHolders?.length) {
          const cur = state.entities.find((e) => e.id === entityId);
          if (cur) {
            const merged = [...(cur.usShareholders || [])];
            for (const h of cf.usHolders) {
              if (!merged.some((s) => s.name.toLowerCase() === h.name.toLowerCase())) {
                merged.push({
                  id: uid(), name: h.name, classOfShares: h.classOfShares, boy: h.boy, eoy: h.eoy,
                  ...(h.pct !== undefined ? { pct: h.pct } : {}),
                  source: `${cfSource} · Sch B Part I p.${h.page}${h.single ? " · single printed count taken as BOY = EOY — confirm" : ""}`,
                });
              }
            }
            if (merged.length !== (cur.usShareholders || []).length) {
              updateEntity(entityId, { usShareholders: merged });
              log.push(`${merged.length} U.S. shareholder(s) carried from ${cfSource} Sch B Part I into the U.S. Shareholders block (rows 7-14)`);
            }
          }
        }
        /* The questionnaire lists the filer and the other shareholders with
           their shares. It seeds the Shareholders tab only when nothing else
           has — a prior return's Schedule B outranks it — and records each
           holder's relationship and citizenship, which no other document
           states and which decide whether the corporation is a CFC at all. */
        if (questionnaire) {
          const cur = state.entities.find((e) => e.id === entityId);
          if (cur && !(cur.shareholders || []).length) {
            const seeded: Shareholder[] = [];
            if (questionnaire.taxpayerName && questionnaire.filerShares && (questionnaire.filerShares.eoy ?? questionnaire.filerShares.boy) !== null) {
              seeded.push({ id: uid(), name: questionnaire.taxpayerName, classOfShares: "Common",
                boy: questionnaire.filerShares.boy ?? questionnaire.filerShares.eoy ?? 0, eoy: questionnaire.filerShares.eoy ?? questionnaire.filerShares.boy ?? 0,
                source: `${questionnaire.fileName} · "Your Shares"` });
            }
            for (const h of questionnaire.additionalHolders) {
              if (h.shares === null) continue;
              seeded.push({ id: uid(), name: h.name, classOfShares: "Common", boy: h.shares, eoy: h.shares,
                source: `${questionnaire.fileName} · additional shareholder${h.relationship ? ` (${h.relationship})` : ""}` });
            }
            if (seeded.length) {
              updateEntity(entityId, { shareholders: seeded });
              log.push(`${seeded.length} shareholder(s) seeded from the questionnaire — one share count per holder, taken as both beginning and end of year`);
            }
          }
          const related = questionnaire.additionalHolders.filter((h) => h.name);
          if (related.length) {
            rv({
              id: "q-holders", level: "info", category: "carry-forward", applied: true,
              message: `The questionnaire names ${related.length} other shareholder(s): ${related.map((h) => `${h.name}${h.shares !== null ? ` (${h.shares} shares` : " ("}${h.relationship ? `, ${h.relationship}` : ""}${h.usCitizen !== undefined ? `, ${h.usCitizen ? "US citizen" : "not a US citizen"}` : ""})`).join("; ")}. Citizenship decides whether their holdings count toward CFC status; the template's Shareholding tab carries the names and counts only.`,
              target: `${SHEET.shareholding}!B19`, source: questionnaire.fileName,
            });
          }
        }
        /* The filer is a U.S. person — that is why the return is filed. When
           no Schedule B Part I names the U.S. shareholders (a category 2/3
           return does not carry one), the filer's own holding among the
           direct shareholders still belongs in the U.S. block: left empty,
           rows 7-14 said the corporation had no U.S. shareholder at all while
           Basic Information called it a CFC. Only the filer is added; nobody
           else's citizenship is assumed. */
        {
          const cur = state.entities.find((e) => e.id === entityId);
          const filer = String(cf?.holderName || cur?.profile.clientName || "").trim();
          if (cur && filer && !(cur.usShareholders || []).length) {
            const own = (cur.shareholders || []).find((h) => h.name && samePerson(h.name, filer));
            if (own && ((Number(own.eoy) || 0) > 0 || (Number(own.boy) || 0) > 0)) {
              const usShareholders = [{
                id: uid(), name: own.name, classOfShares: own.classOfShares, boy: own.boy, eoy: own.eoy,
                source: `the filer (${filer}) — a U.S. person by filing this return; no Schedule B Part I lists the U.S. shareholders — confirm`,
              }];
              updateEntity(entityId, { usShareholders });
              log.push(`U.S. Shareholders block: the filer ${own.name} (${own.eoy} shares) added from the direct shareholders — no Schedule B Part I was available`);
              rv({
                id: "us-holder-filer", level: "info", category: "carry-forward", applied: true,
                message: `No Schedule B Part I lists the U.S. shareholders, so the U.S. Shareholders block (rows 7-14) carries the filer, ${own.name}, with the ${own.boy}/${own.eoy} shares shown among the direct shareholders. Add any other U.S. shareholder by hand — citizenship is not assumed for anyone else.`,
                target: `${SHEET.shareholding}!B7`,
              });
            }
          }
        }
        const ent = state.entities.find((e) => e.id === entityId);
        if (!ent) return;   // removed mid-run
        /* The year may only have become known during the run (the prior
           return's own period end is read from its face). The schedules are
           built for the work paper year, so it is asked for again here. */
        if (!caseYears.cy) {
          const again = resolveCaseYears(ent);
          if (again.cy) caseYears = { cy: again.cy, py: again.py };
        }
        const writes = await materializeCaseWrites(ent, { caseYears, equity, ato, cf, cfSource, cfStale, ledger, questionnaire, salary, rv });
        log.push(`${writes.list.length} schedule cell(s) prepared beyond the core statements`);
        // Sign-offs AND value edits survive re-processing, keyed by stable id.
        const prior = new Map(
          before.reviewItems.filter((r) => r.dismissed || r.resolution).map((r) => [r.id, r]),
        );
        const merged = review.map((r) => {
          const p = prior.get(r.id);
          return p
            ? {
                ...r,
                dismissed: p.dismissed,
                dismissedNote: p.dismissedNote,
                resolution: p.resolution,
                editedValue: p.editedValue,
                priorValue: p.priorValue,
              }
            : r;
        });
        for (const p of before.reviewItems) {
          if (p.dismissed && DERIVED_IDS.has(p.id) && !merged.some((r) => r.id === p.id)) merged.push(p);
        }
        // Re-apply edited values onto the regenerated writes. reviewId-keyed,
        // so labelKey row re-resolution at generation time cannot detach it.
        for (const w of writes.list) {
          const p = w.reviewId ? prior.get(w.reviewId) : undefined;
          if (p?.resolution === "edited" && p.editedValue !== undefined) {
            const m = merged.find((r) => r.id === w.reviewId);
            if (m) m.priorValue = w.value;      // Restore reverts to the FRESH computed number
            w.value = p.editedValue;
          }
        }
        updateEntity(entityId, { extraWrites: writes.list, dividends: writes.dividends, reviewItems: merged, log: [...log] });
      }

      /* Step 6 — the model places what the rules could not. Last, so every
         deterministic answer is already fixed before it runs, and failure-safe
         because a work paper without the AI pass is still a work paper. */
      if (step === 5) {
        /* The agent first: it reads the cached extraction, proposes with
           evidence, and routes what it is unsure of to the Exception Centre.
           The AI mapping pass then takes only what the agent did not read. */
        try {
          await agentRun(entityId, log);
        } catch (err) {
          log.push(`AI agent did not run — ${(err as Error).message}`);
        }
        try {
          await aiRun(entityId, log);
        } catch (err) {
          log.push(`AI mapping did not run — ${(err as Error).message}`);
        }
        updateEntity(entityId, { log: [...log] });
      }
    }

    updateEntity(entityId, {
      progress: PROCESS_STEPS.length,
      status: "ready",
      processedAt: new Date().toLocaleString(),
      // Everything on the entity was just rebuilt under the current year.
      yearStale: false,
      log: [...log],
    });
    const done = state.entities.find((e) => e.id === entityId);
    if (done) {
      logEvent("Processing completed", `${Object.keys(done.lines).length} lines mapped · ${done.unmatched.length} unmatched · ${done.reviewItems.length} review items`, done.name, "system");
      toast(`${done.name} processed — ${Object.keys(done.lines).length} lines mapped`, "ok");
    }
    // Additional 5471s fan out AFTER this entity is ready; a fan-out failure
    // must never mark the (already finished) parent as errored.
    if (done && siblingPlans.length && !fanningOut) {
      fanningOut = true;
      try {
        await fanOutSiblings(entityId, siblingPlans);
        /* The agent raised the missing corporation as a blocking risk at the
           start of this run, because at that point the case had no entity for
           it. The tool has now created one, which is the very action the agent
           recommended — so the block clears here rather than standing over a
           situation that has been resolved. */
        const after = state.entities.find((e) => e.id === entityId);
        if (after) {
          const made = new Set(siblingPlans.map((c) => `agent-risk-second-entity-${String(c.cfcName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`));
          const left = (after.reviewItems || []).filter((i) => !made.has(i.id));
          if (left.length !== (after.reviewItems || []).length) {
            updateEntity(entityId, { reviewItems: left });
            logEvent(
              "Second corporation prepared",
              `${siblingPlans.map((c) => c.cfcName).join(", ")} — the agent flagged it as a separate filing and the entity was created, so the blocking risk is cleared`,
              after.name, "system",
            );
          }
        }
        /* This entity was mapped while it was the only one in the case, so
           every page in the file was its own. Now that its siblings exist,
           read it again: page attribution can keep each corporation's pages
           to its own entity, which is the difference between a work paper for
           one corporation and a work paper for two added together. The
           fan-out guard is still set, so this run cannot fan out again. */
        await actions.processEntity(entityId);
      } catch (err) {
        toast("Additional 5471 work papers could not all be created: " + (err as Error).message, "bad");
      } finally {
        fanningOut = false;
      }
    }
    } catch (err) {
      // Restore the pre-run state — a failed re-process must not leave the
      // entity stripped of everything it had before.
      updateEntity(entityId, { ...before, status: "error" });
      toast("Processing failed: " + (err as Error).message, "bad");
    }
  },

  /* ---------------- Groq ---------------- */
  setGroq(patch: Partial<GroqState>) { set({ groq: { ...state.groq, ...patch } }); },

  /** The agent's only setting: whether it runs during processing. It has no
      key of its own — it uses the Groq credential above. */
  setAgent(patch: Partial<AgentSettings>) { set({ agent: { ...state.agent, ...patch } }); },
  agentInfo: () => agentInfo(),

  async testGroq() {
    if (!state.groq.key) { toast("Add a Groq API key first", "bad"); return; }
    set({ groq: { ...state.groq, status: "testing" } });
    try {
      await groqCall([{ role: "user", content: "Reply with the single word: ready" }]);
      toast(`Groq online — ${state.groq.latency} ms`, "ok");
    } catch (err) {
      toast("Groq error: " + (err as Error).message, "bad");
    }
  },

  /** Manual "map the remaining captions with AI". Same pass processing runs
      as step 6, forced so it ignores the auto-map preference. */
  async resolveWithGroq(entityId: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) { toast("Nothing unmatched to resolve"); return; }
    if (ent.status === "processing") { toast("Processing is running — AI mapping runs automatically"); return; }
    if (!ent.unmatched.length && !(ent.unmatchedProfile || []).length) { toast("Nothing unmatched to resolve"); return; }
    if (!aiReady()) { toast("No AI key available — this deployment has no server key, so add your own in Settings", "bad"); return; }
    if (state.busy) return;
    set({ busy: true });
    try {
      const r = await aiRun(entityId, undefined, true);
      if (r.considered) {
        toast(`Groq mapped ${r.applied} of ${r.considered} caption(s)${r.low ? ` · ${r.low} need review` : ""}`, r.applied ? "ok" : "");
      } else {
        toast("Nothing eligible for AI mapping");
      }
    } catch (err) {
      toast("Groq mapping failed: " + (err as Error).message, "bad");
    }
    set({ busy: false });
  },

  /** Translate every non-English caption via Groq. Labels only — never amounts. */
  async translateLabels() {
    if (!state.groq.key) { toast("Add a Groq API key in Settings first", "bad"); return; }
    const work: Array<{ entityId: string; labels: string[] }> = state.entities.map((ent) => {
      // collectCaptionLabels covers contributions + sourceLabels + unmatched,
      // so the work list can never be narrower than the evidence table.
      const all = collectCaptionLabels(ent);
      const poisoned = new Set(poisonedTranslationKeys(ent.translations));
      return { entityId: ent.id, labels: all.filter((l) => !ent.translations[l] || poisoned.has(l)) };
    }).filter((w) => w.labels.length);

    if (!work.length) { toast("Nothing left to translate"); return; }
    set({ busy: true });
    try {
      for (const w of work) {
        const ent = state.entities.find((e) => e.id === w.entityId);
        if (!ent) continue;
        const raw = await groqCall([
          { role: "system", content: "You translate accounting captions into English. Reply with JSON only." },
          {
            role: "user",
            content: `Translate each caption to English. Keep accounting terminology. If already English, repeat it unchanged.\n\n${w.labels.map((l, i) => `${i}. ${l}`).join("\n")}\n\nReturn {"t":{"<index>":"<english>"}}`,
          },
        ], true);
        const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
        const translations = { ...ent.translations };
        const failures = { ...ent.translationFailures };
        let n = 0;
        w.labels.forEach((label, i) => {
          const v = parsed?.t?.[String(i)];
          const value = typeof v === "string" ? v.trim() : "";
          if (value && !isServiceErrorText(value) && !(isMostlyNonLatin(label) && isMostlyNonLatin(value))) {
            translations[label] = value;
            delete failures[label];
            n++;
          } else {
            failures[label] = value
              ? "Unreadable characters or unsupported text — the model stayed in the source script."
              : "The model returned no translation — unsupported text or missing context.";
          }
        });
        updateEntity(w.entityId, { translations, translationFailures: failures });
        logEvent("Captions translated", `${n} caption(s) via ${state.groq.model}`, ent.name, "groq");
      }
      toast("Translation complete", "ok");
    } catch (err) {
      toast("Translation failed: " + (err as Error).message, "bad");
    }
    set({ busy: false });
  },

  /** Translate captions with the free, keyless services. Falls back through
      the configured order; Groq is only used when it is first in the order. */
  async translateFreeLabels() {
    const work = state.entities.map((ent) => {
      const all = collectCaptionLabels(ent);
      const poisoned = new Set(poisonedTranslationKeys(ent.translations));
      return { entityId: ent.id, labels: all.filter((l) => !ent.translations[l] || poisoned.has(l)) };
    }).filter((w) => w.labels.length);

    if (!work.length) { toast("Nothing left to translate"); return; }
    set({ busy: true });
    let done = 0, failed = 0;
    let lastError = "";
    let consecutive = 0;

    for (const w of work) {
      const ent = state.entities.find((e) => e.id === w.entityId);
      if (!ent) continue;
      const translations = { ...ent.translations };
      const failures = { ...ent.translationFailures };
      for (const label of w.labels) {
        // Never guess: a caption too short to carry meaning is not sent out.
        if (label.trim().length < 3) {
          failures[label] = "Missing context — the caption is too short to translate reliably.";
          continue;
        }
        const t0 = Date.now();
        const { result, attempts } = await translateFree(label, state.translateOrder, translateSourceCode(label));
        const latency = Date.now() - t0;
        for (const a of attempts) recordProvider(a.provider, 0, false, a.error, null);
        if (result.ok) {
          const value = result.value.trim();
          const unusable =
            !value ||
            isServiceErrorText(value) ||
            (isMostlyNonLatin(label) && (value === label.trim() || isMostlyNonLatin(value)));
          if (unusable) {
            delete translations[label];   // clear any error string saved earlier
            // The service echoed the input or stayed in the source script —
            // that is not a translation, and storing it would be a guess.
            failures[label] = "Unreadable characters or unsupported text — the service returned nothing usable.";
            recordProvider(result.provider, result.units, true, "", latency);
          } else {
            recordProvider(result.provider, result.units, true, "", latency);
            translations[label] = value;
            delete failures[label];
            done++;
            consecutive = 0;
          }
        } else {
          recordProvider("mymemory", 0, false, result.error, latency);
          failures[label] = `Translation service unavailable (${result.error}) — retry later.`;
          lastError = result.error;
          failed++;
          consecutive++;
          // One bad caption must not strand the rest of the queue. Only give up
          // when the provider is clearly down, not on a single refusal.
          if (consecutive >= 3) break;
          continue;
        }
        set({ usage: { ...state.usage, api: state.usage.api + 1 } });
      }
      updateEntity(w.entityId, { translations, translationFailures: failures });
      if (done) logEvent("Captions translated", `${done} caption(s) via free service`, ent.name, "system");
    }

    set({ busy: false });
    if (done) toast(`Translated ${done} caption${done === 1 ? "" : "s"}`, "ok");
    else toast(`Translation unavailable — ${lastError || "no provider responded"}`, "bad");
  },

  /** Pull a live quote and optionally write it into the entity's rates. */
  async fetchLiveRate(entityId: string, apply: boolean) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const code = (ent.profile.currency || "").toUpperCase().trim();
    if (!code) { toast("Set the functional currency first", "bad"); return; }

    set({ busy: true });
    const t0 = Date.now();
    const { result, attempts } = await fetchLiveRate(code, state.fxOrder);
    const latency = Date.now() - t0;
    for (const a of attempts) recordProvider(a.provider, 1, false, a.error, null);
    set({ usage: { ...state.usage, api: state.usage.api + 1 } });

    if (!result.ok) {
      set({ busy: false });
      toast(`Live rate unavailable — ${result.error}`, "bad");
      logEvent("Live rate lookup failed", result.error, ent.name, "system");
      return;
    }
    recordProvider(result.provider, 1, true, "", latency);
    set({ liveRates: { ...state.liveRates, [code]: result.value } });
    logEvent("Live rate retrieved", `${code} ${result.value.rate} via ${result.provider} (${result.value.asOf})`, ent.name, "system");

    if (apply) {
      updateEntity(entityId, { fx: { ...ent.fx, cyRate: String(result.value.rate) }, fxAuto: false });
      logEvent("Live rate applied to C60", `${code} ${result.value.rate} — overrides the published Treasury spot rate`, ent.name);
      toast(`${code} ${result.value.rate} applied to C60`, "ok");
    } else {
      toast(`${code} ${result.value.rate} via ${result.provider} — ${result.value.asOf}`, "ok");
    }
    set({ busy: false });
  },

  setProviderOrder(kind: "translate" | "fx", order: string[]) {
    set(kind === "translate" ? { translateOrder: order } : { fxOrder: order });
    logEvent("Provider order changed", `${kind}: ${order.join(" → ")}`);
  },

  /* ---------------- rules ---------------- */
  setRuleKeywords(index: number, csv: string) {
    logEvent("Mapping rule edited", `${state.rules[index]?.t} keywords updated`);
    const rules = state.rules.map((r, i) =>
      i === index ? { ...r, kw: csv.split(",").map((s) => s.trim()).filter(Boolean) } : r,
    );
    set({ rules });
  },
  resetRules() {
    logEvent("Mapping rules reset", `${DEFAULT_RULES.length} rules restored to defaults`);
    set({ rules: DEFAULT_RULES.map((r) => ({ t: r.t, kw: [...r.kw] })) });
    toast("Mapping rules reset to defaults");
  },

  /* ---------------- exception policies ---------------- */
  addPolicyRule(rule: Omit<PolicyRule, "id">) {
    const full: PolicyRule = { ...rule, id: uid() };
    logEvent("Policy rule added", describePolicyRule(full));
    set({ policies: [...state.policies, full] });
    toast("Policy rule added — edit it under Settings ▸ Policies", "ok");
  },

  updatePolicyRule(id: string, patch: Partial<Omit<PolicyRule, "id">>) {
    const cur = state.policies.find((p) => p.id === id);
    if (!cur) return;
    const next = { ...cur, ...patch, match: { ...cur.match, ...(patch.match || {}) } };
    logEvent("Policy rule updated", describePolicyRule(next));
    set({ policies: state.policies.map((p) => (p.id === id ? next : p)) });
  },

  removePolicyRule(id: string) {
    const cur = state.policies.find((p) => p.id === id);
    if (!cur) return;
    logEvent("Policy rule removed", describePolicyRule(cur));
    set({ policies: state.policies.filter((p) => p.id !== id) });
  },

  movePolicyRule(id: string, dir: -1 | 1) {
    const i = state.policies.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.policies.length) return;
    const next = [...state.policies];
    [next[i], next[j]] = [next[j], next[i]];
    set({ policies: next });
  },

  resetPolicies() {
    logEvent("Exception policies cleared", `${state.policies.length} rule(s) removed — every exception keeps its computed level`);
    set({ policies: [] });
    toast("Policies cleared", "ok");
  },

  /* ---------------- generation ---------------- */
  /** Overview "Preview format": the untouched master template, so the output
      shape can be inspected before anything is processed. */
  downloadBlankTemplate() {
    try {
      const blob = new Blob([templateBytes() as BlobPart],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      if (!safeDownload(blob, "5471_Workpaper_Blank_Format.xlsx")) {
        toast("Download was blocked by the browser", "bad");
        return;
      }
      logEvent("Blank template downloaded", "5471_Workpaper_Blank_Format.xlsx — untouched master template");
      toast("Blank master template downloaded", "ok");
    } catch (err) {
      toast((err as Error).message, "bad");
    }
  },

  async generateOne(entityId: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    if (cellCount(ent) === 0) { toast(`${ent.name} has nothing to write yet`, "bad"); return; }
    const blockers = blockingIssues(ent);
    if (blockers.length) {
      logEvent("Generation blocked", blockers[0].message, ent.name, "system");
      toast(blockers[0].message, "bad");
      return;
    }
    logPolicyOverriddenBlocks(ent);
    if (ent.excludedSheets?.length) {
      logEvent("Sheets excluded from generation", ent.excludedSheets.join(", "), ent.name, "system");
    }
    set({ busy: true });
    try {
      const { blob, report } = await buildWorkbook(ent);
      const fname = `5471_Workpaper_${safeName(state.stakeholder)}_${safeName(ent.name)}.xlsx`;
      downloadBlob(blob, fname);
      logEvent("Work paper generated", `${fname} · ${report.written} cells written`, ent.name, "system");
      if (report.skippedSheets.length || report.refusedFormula.length) {
        const detail = [
          report.skippedSheets.length ? `sheets not found: ${report.skippedSheets.join(", ")}` : "",
          report.refusedFormula.length ? `formula cells refused: ${report.refusedFormula.join(", ")}` : "",
        ].filter(Boolean).join(" · ");
        logEvent("Generation warnings", detail, ent.name, "system");
        toast(`Generated with warnings — ${detail}`, "bad");
      }
      set({ usage: { ...state.usage, generated: state.usage.generated + 1 } });
      toast(`${ent.name} — ${report.written} cells populated`, "ok");
    } catch (err) {
      toast("Generation failed: " + (err as Error).message, "bad");
    }
    set({ busy: false });
  },

  async generateWorkpapers() {
    let targets = state.entities.filter((e) => cellCount(e) > 0);
    if (!targets.length) { toast("Nothing to write yet — process an entity or fill its profile", "bad"); return; }
    const blocked = targets.filter((e) => blockingIssues(e).length);
    // One blocked entity used to abort the whole batch. Only refuse outright
    // when NOTHING can be written; otherwise name the entities being left out
    // and generate the rest, so a single unresolved exception on one CFC does
    // not hold up every other work paper in the case.
    if (blocked.length === targets.length) {
      const first = blockingIssues(blocked[0])[0];
      logEvent("Generation blocked", `${blocked[0].name}: ${first.message}`, blocked[0].name, "system");
      toast(`${blocked[0].name}: ${first.message}`, "bad");
      return;
    }
    if (blocked.length) {
      toast(`Skipping ${blocked.map((e) => e.name).join(", ")} — blocking issues open. Generating the rest.`, "bad");
      for (const e of blocked) logEvent("Generation skipped", `${e.name}: ${blockingIssues(e)[0].message}`, e.name, "system");
    }
    targets = targets.filter((e) => !blockingIssues(e).length);
    for (const t of targets) logPolicyOverriddenBlocks(t);
    set({ busy: true });
    try {
      if (targets.length === 1) {
        const { blob, report } = await buildWorkbook(targets[0]);
        const fname = `5471_Workpaper_${safeName(state.stakeholder)}_${safeName(targets[0].name)}.xlsx`;
        downloadBlob(blob, fname);
        logEvent("Work paper generated", `${fname} · ${report.written} cells written`, targets[0].name, "system");
        toast(`Work paper generated — ${report.written} cells populated`, "ok");
      } else {
        const bundle = new JSZip();
        let total = 0;
        for (const ent of targets) {
          const { blob, report } = await buildWorkbook(ent);
          total += report.written;
          bundle.file(`5471_Workpaper_${safeName(state.stakeholder)}_${safeName(ent.name)}.xlsx`, blob);
          // Per-entity event: task auto-advance keys on the entity name.
          logEvent("Work paper generated", `${report.written} cells written (bundled)`, ent.name, "system");
        }
        const outBuf: ArrayBuffer = await bundle.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
        downloadBlob(new Blob([outBuf], { type: "application/zip" }), `5471_Workpapers_${safeName(state.stakeholder)}.zip`);
        logEvent("Work papers generated", `${targets.length} workbooks · ${total} cells written · delivered as .zip`, null, "system");
        toast(`${targets.length} work papers generated — ${total} cells populated`, "ok");
      }
      set({ usage: { ...state.usage, generated: state.usage.generated + targets.length } });
    } catch (err) {
      toast("Generation failed: " + (err as Error).message, "bad");
    }
    set({ busy: false });
  },
};

/* `actions` is complete by the time this runs; at module scope it would not
   be. A macrotask rather than a microtask so React's first render is not
   competing with it. */
if (typeof window !== "undefined") setTimeout(() => { try { actions.EN9_expose(); } catch { /* no window */ } }, 0);

/* ---------------- mapping helpers ---------------- */

/** Caption key for user overrides — case/whitespace insensitive. */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** A caption that names cost of goods itself, or the stock movement that
    makes it up — line 2 wherever the statement prints it. */
/* Delivery to customers (outbound) versus freight on purchases (inbound). */
/** Schedule F contra lines and the form reference each one carries. */
const CONTRA_ASSET_LINES = new Map<string, string>([["BS:12", "2b"], ["BS:29", "9b"], ["BS:31", "10b"], ["BS:37", "12d"]]);
const OUTBOUND_DELIVERY = /\b(delivery|deliveries|shipping|carriage\s+out(wards?)?|freight\s+out(wards?)?)\b/i;
const INBOUND_FREIGHT = /\b(inward|inwards|inbound|freight[-\s]+in|on\s+purchases|import|customs|duty)\b/i;
const EXPLICIT_COGS = /\b(cost of (goods|sales|revenue)|cogs|direct (costs?|labou?r|materials?)|opening|closing|stocks?|inventor(y|ies)|costos? de (la )?ventas?|costo directo|existencias)\b/i;

/** What a preparer needs to know about one document, in five words.
 *
 * The order of the tests is the point. "text read" is checked BEFORE
 * processedAt, so a document that WAS read but could not be identified reads
 * green rather than "could not be read" — the reading worked; the
 * classification is a separate question, and conflating them sent people
 * hunting for a file problem that did not exist. */
export type ReadStatus = "unsupported format" | "not read yet" | "text read" | "text read (OCR)" | "scan — needs OCR" | "could not be read";

export function readState(ent: Entity | undefined, file: EntityFile): ReadStatus {
  if (!file || !file.parsable) return "unsupported format";
  if (ent?.docClasses?.[file.id]) {
    // An OCR'd copy reads like any digital PDF, but the preparer must be able
    // to see at a glance that its text was recognised, not printed.
    if (file.ocr) return "text read (OCR)";
    return "text read";
  }
  if (!ent || !ent.processedAt) return "not read yet";
  // A scan is distinguishable from a genuine read failure, and the difference
  // matters: one has a remedy in the app, the other does not.
  for (const item of ent.reviewItems || []) {
    if (item?.source === file.name && /no text layer/i.test(String(item.message || ""))) return "scan — needs OCR";
  }
  return "could not be read";
}

/** What the document actually gave this work paper, under the read status.
 *
 * "Text read" answers one question only: did the reader run. It said nothing
 * about whether anything was found or whether any of it was used, so a
 * document that produced nothing at all still read green while its type said
 * UNKNOWN — two statements that cannot both be comfortable. This is the
 * second line: how much text, how many figures, and where they went. */
export function readDetail(ent: Entity | undefined, file: EntityFile): string {
  const cls = ent?.docClasses?.[file.id];
  if (!cls) return "";
  const parts: string[] = [];
  if (typeof cls.textChars === "number") parts.push(`${cls.textChars.toLocaleString()} characters`);
  if (typeof cls.textRows === "number") parts.push(`${cls.textRows.toLocaleString()} lines`);
  if (cls.amountRows) parts.push(`${cls.amountRows.toLocaleString()} with figures`);
  const booked = Object.values(ent?.contributions || {}).flat().filter((c) => c.docId === file.id).length;
  const loose = (ent?.unmatched || []).filter((u) => u.docId === file.id).length;
  if (cls.duplicateOf) parts.push("duplicate — not used");
  else if (booked) parts.push(`${booked} booked`);
  else if (loose) parts.push(`${loose} in Review, none booked`);
  else if (cls.kind === "unknown") parts.push("NOT USED — type unknown");
  else parts.push("nothing booked");
  return parts.join(" \u00b7 ");
}

/** The prior filing's Schedule F lines re-translated at two rates — the
    table's and the one the prior filing states — so a rate warning can say
    exactly what it costs line by line. Current items only, signed the way
    Schedule F carries them, so `net` is net current assets. */
export function rateEffectLines(
  filed: Partial<Record<string, { value: number }>>,
  tableRate: number,
  priorRate: number,
): { lines: { label: string; atTable: number; atPrior: number; diff: number }[]; net: { atTable: number; atPrior: number; diff: number } } {
  const ORDER: [string, string, 1 | -1][] = [
    ["cash", "cash", 1], ["ar", "trade notes and accounts receivable", 1], ["badDebts", "allowance for bad debts", 1],
    ["inventories", "inventories", 1], ["oca", "other current assets", 1],
    ["ap", "accounts payable", -1], ["ocl", "other current liabilities", -1],
  ];
  const lines: { label: string; atTable: number; atPrior: number; diff: number }[] = [];
  let netT = 0, netP = 0;
  for (const [key, label, sign] of ORDER) {
    const usd = filed[key]?.value;
    if (usd === undefined) continue;
    const atTable = Math.round(usd * tableRate), atPrior = Math.round(usd * priorRate);
    lines.push({ label, atTable, atPrior, diff: atTable - atPrior });
    netT += sign * atTable; netP += sign * atPrior;
  }
  return { lines, net: { atTable: netT, atPrior: netP, diff: netT - netP } };
}

/** The statement a caption was printed on decides which schedule it can
    reach. A caption read on an income-statement page is income or expense; a
    model that books it to a Schedule F balance ("Petit matériel et
    fournitures" to inventories) moves the figure out of the P&L and unbalances
    the balance sheet by the same amount. Keyed on the unmatched row's own
    reason, which names the page it was read on. */
export function statementSideVeto(reason: string | undefined, target: string): string | null {
  const r = String(reason || "");
  if (/on an income-statement page/.test(r) && /^BS:/.test(target))
    return "the caption was printed on the income statement — a Schedule F balance cannot come from a profit-and-loss line; refused.";
  if (/on a balance-sheet page/.test(r) && /^IS:/.test(target))
    return "the caption was printed on the balance sheet — a Schedule C line cannot come from a balance; refused.";
  return null;
}

/** Net income as the Income Statement tab will compute it from the booked
    lines: gross profit (1a − 1b − COGS) + lines 4–9, less lines 11–17, plus
    the signed items on lines 20–21b. null when nothing is booked. */
export function bookNetIncome(lines: Record<string, LineValue>): number | null {
  const amt = (row: number) => { const v = lines[`IS:${row}`]?.amount; return typeof v === "number" ? v : 0; };
  if (!Object.keys(lines).some((k) => k.startsWith("IS:"))) return null;
  const grossProfit = amt(7) - amt(8) - (amt(10) + amt(11) + amt(12));
  const income = grossProfit + [14, 15, 16, 17, 18, 19, 20, 22, 23, 24].reduce((n, r) => n + amt(r), 0);
  const deductions = [26, 27, 28, 29, 30, 31, 32].reduce((n, r) => n + amt(r), 0)
    + POOLS["IS:OD"].rows.reduce((n, r) => n + amt(r), 0);
  /* Rows 61-63 mirror the template's line 22: the unusual-items row adds and
     the two tax rows subtract, because line 21a now carries a POSITIVE
     expense (it used to be booked negative so a plain SUM came out right). */
  const below = amt(61) - amt(62) - amt(63);
  return r2(income - deductions + below);
}

/** Booked net income against the result the balance sheet states in its
    equity block, current year only; null when they agree or nothing states
    one. Candidates are unassigned P&L rows whose figure is the difference. */
export function pnlTieOut(ent: Entity): { booked: number; stated: number; diff: number; label: string; where: string; candidates: string[]; unassigned: number; suspects: string[] } | null {
  const booked = bookNetIncome(ent.lines);
  if (booked === null) return null;
  /* The P&L's own bottom line first — it is the statement Schedule C is
     built from. The equity line on the balance sheet only when the P&L
     printed none. */
  const pnl = (ent.statedResults || []).filter((x) => x.feed === "is");
  const rows = pnl.length ? [] : (ent.contributions["BS:61"] || []).filter((c) => c.field === "eoy" && isProfitLine(c.label));
  if (!pnl.length && !rows.length) return null;
  const stated = r2(pnl.length ? pnl.reduce((n, x) => n + x.value, 0) : rows.reduce((n, c) => n + c.value, 0));
  const label = pnl.length ? pnl[0].label : rows[0].label;
  const diff = r2(stated - booked);
  if (Math.abs(diff) <= Math.max(1, Math.abs(stated) * 0.001)) return null;
  const pnlRows = (ent.unmatched || []).filter((u) => /income-statement page/.test(u.reason || ""));
  const cy = entityCaseCy(ent);
  const current = (u: Entity["unmatched"][number]): number | null => {
    const vals = u.values || [];
    if (!vals.length) return null;
    const i = cy && u.years ? u.years.indexOf(cy) : -1;
    return i >= 0 ? vals[i] : vals[0];
  };
  const candidates = pnlRows.filter((u) => { const v = current(u); return v !== null && Math.abs(Math.abs(v) - Math.abs(diff)) <= 1; })
    .map((u) => u.label).slice(0, 3);
  return { booked, stated, diff, label, where: pnl.length ? "profit and loss" : "balance sheet", candidates, unassigned: pnlRows.length, suspects: tieSuspects(ent, diff) };
}

/** Schedule F's two sides at one end of the year, as the template adds them. */
export function bsBalance(lines: Record<string, LineValue>, field: "eoy" | "boy"): { assets: number; liabEquity: number; diff: number } {
  let assets = 0, liabEquity = 0;
  for (const ln of BS_LINES) {
    const v = lines[`BS:${ln.row}`]?.[field];
    if (typeof v !== "number" || !isFinite(v)) continue;
    if (/assets/i.test(ln.group)) assets += v; else liabEquity += v;
  }
  return { assets: r2(assets), liabEquity: r2(liabEquity), diff: r2(assets - liabEquity) };
}

/** Schedule F lines whose amount alone explains an imbalance: counted twice
    (or its partner missing) when it equals the gap, on the wrong side or
    with the wrong sign when it is half of it. "" when none does. */
export function bsSuspectText(lines: Record<string, LineValue>, field: "eoy" | "boy", diff: number): string {
  const gap = Math.abs(diff);
  if (gap < 1) return "";
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 1e-5);
  const out: string[] = [];
  for (const ln of BS_LINES) {
    const v = lines[`BS:${ln.row}`]?.[field];
    if (typeof v !== "number" || !v) continue;
    const name = `line ${ln.ref} ${ln.label} (${v.toLocaleString()})`;
    if (near(Math.abs(v), gap)) out.push(`${name} — counted twice, or its matching line is missing`);
    else if (near(2 * Math.abs(v), gap)) out.push(`${name} — on the wrong side or with the wrong sign`);
  }
  if (!out.length) return "";
  return ` ${field === "boy" ? "The opening column comes from the prior-year return or the statements' prior-year column; " : ""}line(s) whose amount alone explains the gap: ${out.slice(0, 3).join("; ")}.`;
}

/** Booked P&L rows that alone explain a net-income gap. A row booked twice,
    or booked when the statement does not count it, moves net income by its
    own amount; a row with the wrong sign, or on the wrong side (income booked
    as a deduction), moves it by twice its amount. Naming the row turns "go and
    compare the whole P&L" into one thing to check. */
export function tieSuspects(ent: Entity, diff: number): string[] {
  const gap = Math.abs(diff);
  if (gap < 1) return [];
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 1e-5);
  const out: string[] = [];
  for (const [line, cs] of Object.entries(ent.contributions || {})) {
    if (!line.startsWith("IS:")) continue;
    for (const c of cs) {
      if (c.field !== "amount" || !c.value) continue;
      const v = Math.abs(c.value);
      if (near(v, gap)) out.push(`"${c.label}" (${c.value.toLocaleString()} on ${line}) — booked twice, or not part of the statement's result`);
      else if (near(2 * v, gap)) out.push(`"${c.label}" (${c.value.toLocaleString()} on ${line}) — wrong sign, or income booked as a deduction (or the reverse)`);
    }
  }
  return out.slice(0, 3);
}

/** The P&L's bottom line against the result the balance sheet carries in
    equity. Two reports of one year that disagree were run at different
    times or with different settings; null when they agree or one is missing. */
export function resultsDisagree(ent: Entity): { pnl: number; bs: number; pnlLabel: string; bsLabel: string; diff: number } | null {
  const pnl = (ent.statedResults || []).filter((x) => x.feed === "is");
  const bs = (ent.contributions["BS:61"] || []).filter((c) => c.field === "eoy" && isProfitLine(c.label));
  if (!pnl.length || !bs.length) return null;
  const p = r2(pnl.reduce((n, x) => n + x.value, 0)), b = r2(bs.reduce((n, c) => n + c.value, 0));
  const diff = r2(b - p);
  if (Math.abs(diff) <= Math.max(1, Math.abs(p) * 0.001)) return null;
  return { pnl: p, bs: b, pnlLabel: pnl[0].label, bsLabel: bs[0].label, diff };
}

/** A dividend printed as a line of the balance sheet's equity, current year. */
export function equityDividendLine(ent: Entity): { amount: number; label: string; addsToEquity: boolean; closing?: number; opening?: number; openingBasis?: string } | null {
  const isDiv = (c: Contribution) => /\b(dividends?|distributions?)\b/i.test(c.label) && !/\b(payable|reserve|receivable)\b/i.test(c.label);
  const bs61 = ent.contributions["BS:61"] || [];
  const rows = bs61.filter((c) => c.field === "eoy" && isDiv(c));
  const closing = r2(rows.reduce((n, c) => n + Math.abs(c.value), 0));
  /* A distribution paid reduces equity and is printed negative ("Dividend
     disbursed (100,000)"). A dividend line printed POSITIVE adds to total
     equity: the statements record it, but it is no proof of a payment. */
  const addsToEquity = rows.reduce((n, c) => n + c.value, 0) > 0;
  if (!(closing > 0)) return null;
  /* A dividends ACCOUNT is a running balance until the books close it into
     retained earnings. QuickBooks never does: "Dividends (728,941.18)" was
     every dividend since the last close, and booking all of it as this year's
     distribution overstated Schedule R, J and M by the 376,000 paid in earlier
     years. The year's distribution is the account's movement. Its opening
     balance comes from the statements' own prior-year column when they print
     one; otherwise, when the books are visibly unclosed (equity prints the
     year's result and a retained-earnings account beside it), it is what the
     retained-earnings account holds beyond the retained earnings the prior
     return filed — the distributions not yet closed into it. */
  let opening: number | null = null;
  let openingBasis = "";
  const boyRows = bs61.filter((c) => c.field === "boy" && isDiv(c));
  if (boyRows.length) {
    opening = r2(boyRows.reduce((n, c) => n + Math.abs(c.value), 0));
    openingBasis = "the statements' prior-year column";
  } else {
    const reAcct = bs61.filter((c) => c.field === "eoy" && /\b(retained\s+(earnings?|profits?)|accumulated\s+(profits?|earnings?))\b/i.test(c.label));
    const result = bs61.filter((c) => c.field === "eoy" && /\b(net\s+(income|earnings|profit|loss)|profit\s+for\s+the\s+(year|period)|current\s+year\s+(earnings|profit))\b/i.test(c.label));
    const filedOpening = ent.lines["BS:61"]?.boy;
    const hasBooksBoy = bs61.some((c) => c.field === "boy");
    if (reAcct.length && result.length && typeof filedOpening === "number" && !hasBooksBoy) {
      const undistributed = r2(reAcct.reduce((n, c) => n + c.value, 0) - filedOpening);
      if (undistributed > 0.01 && undistributed < closing - 0.01) {
        opening = undistributed;
        openingBasis = "the retained-earnings account less the retained earnings the prior-year Form 5471 filed";
      }
    }
  }
  /* An account that opened at nil moved by its whole closing balance: that
     is the plain case, and it reads as one. */
  if (opening !== null && !(opening > 0.01 && opening < closing - 0.01)) opening = null;
  const amount = opening !== null ? r2(closing - opening) : closing;
  return { amount, label: rows[0].label, addsToEquity, ...(opening !== null ? { closing, opening, openingBasis } : {}) };
}

/** Does a shareholder name read as a company rather than a person? The
    suffixes the world's registries actually use, plus the bare words. */
export function isCorporateName(name: string): boolean {
  return /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|l\.l\.c|plc|pty|pte|gmbh|ag|s\.?a\.?|s\.?r\.?l|b\.?v|n\.?v|s\.?p\.?a|oy|ab|as|kk|k\.k|sdn|bhd|holdings?|trust|partners(hip)?|lp|l\.p|fund|group)\b\.?$/i.test(String(name || "").trim())
    || /\b(inc|corp|ltd|llc|gmbh|b\.v\.|n\.v\.|s\.a\.|pty|plc)\b/i.test(String(name || ""));
}

/** Same strings in the same order. */
const sameList = (a: string[] | undefined, b: string[]) =>
  !!a && a.length === b.length && a.every((x, i) => x === b[i]);

/** The entity's current year: profile cyEnd first, classified years second. */
export function entityCaseCy(ent: Entity): number | null {
  const y = yearFromPeriod(ent.profile.cyEnd || "");
  if (y) {
    const n = Number(y);
    if (isFinite(n) && n > 1990) return n;
  }
  return resolveCaseYears(ent).cy;
}

/** First matching policy rule decides; "suppress" removes the item. Pure. */
export function applyPolicy(item: ReviewItem, policies: PolicyRule[]): ReviewItem | null {
  for (const rule of policies) {
    const m = rule.match;
    let hit = false;
    if (m.id) hit = item.id === m.id;
    else if (m.category) hit = item.category === m.category;
    else if (m.message) {
      try {
        hit = m.regex
          ? new RegExp(m.message, "i").test(item.message)
          : item.message.toLowerCase().includes(m.message.toLowerCase());
      } catch {
        hit = false;   // a bad user regex must never break the render
      }
    }
    if (!hit) continue;
    if (rule.action === "suppress") return null;
    if (rule.action === "keep" || rule.action === item.level) {
      return { ...item, policy: { ruleId: rule.id, from: item.level } };
    }
    return { ...item, level: rule.action, policy: { ruleId: rule.id, from: item.level } };
  }
  return item;
}

type Routed = { field: "amount" | "boy" | "eoy"; value: number; year: number | null };

/** Year-aware routing: a current-year value books to the income statement or
    the balance-sheet END column; a prior-year value books to the balance-sheet
    BEGINNING column and NEVER to the income statement. PDF rows with several
    numbers but no year identity are ambiguous and go to review instead of
    being guessed; spreadsheet rows keep the legacy positional behavior. */
/** WHICH rate turns the prior return's filed USD back into opening local
 *  currency, in order of authority:
 *
 *    1. the rate the prior return itself printed (Sch H line 5e, or the
 *       Schedule M header). Dividing the filed USD by anything else does not
 *       reproduce the local-currency figures that return was built from, and
 *       the difference is noise with no accounting event behind it;
 *    2. the currency's dollar peg, where there is one — the published table
 *       rounds it, and the rounding moves every opening line;
 *    3. the prior year-end rate in use.
 *
 * ONE definition, because the opening figure reaches three cells — Schedule F
 * D61, Schedule J F15 and the Retained Earnings tab F10 — and two of them
 * deriving it separately is what wrote the same figure twice with different
 * values. Everything downstream reads this. */
export function openingRateFor(
  currency: string | null | undefined,
  pyRate: number | null,
  priorRate?: number | null,
): { rate: number; why: string } | null {
  const peg = peggedRate(currency || "");
  if (peg) return { rate: peg.rate, why: peg.note };
  if (typeof pyRate === "number" && pyRate > 0) {
    return { rate: pyRate, why: `the approved prior year-end rate (${pyRate})` };
  }
  if (typeof priorRate === "number" && priorRate > 0) {
    return { rate: priorRate, why: `the prior return printed (${priorRate}); no approved year-end rate was available` };
  }
  return null;
}

function routeRow(
  row: ExtractedRow,
  isBS: boolean,
  years: { cy: number | null; py: number | null },
  kind: "pdf" | "grid",
): Routed[] | "ambiguous" {
  const sign = signForLabel(row.label);
  const vals = row.values.map((v, i) => ({
    v: v > 0 ? v * sign : v,
    y: row.years ? row.years[i] ?? null : null,
  }));
  const hasYears = !!row.years && row.years.some((y) => y !== null);
  const out: Routed[] = [];

  if (hasYears) {
    // When the case years are unknown (grid-only engagements), the row's own
    // detected header years still identify the columns: newest = current.
    const cy = years.cy ?? Math.max(...vals.filter((x) => x.y !== null).map((x) => x.y as number));
    const py = years.cy ? years.py : cy - 1;
    for (const { v, y } of vals) {
      if (y === cy) out.push(isBS ? { field: "eoy", value: v, year: y } : { field: "amount", value: v, year: y });
      else if (y === py && isBS) out.push({ field: "boy", value: v, year: y });
      // Prior-year income and un-snapped values are correctly ignored.
    }
    return out;
  }
  if (kind === "grid") {
    const last = vals[vals.length - 1];
    if (!isBS) return [{ field: "amount", value: last.v, year: null }];
    out.push({ field: "eoy", value: last.v, year: null });
    if (vals.length > 1) out.push({ field: "boy", value: vals[vals.length - 2].v, year: null });
    return out;
  }
  // PDF without a usable ruler: a single value on a page classified as a
  // current-year statement is current year; anything wider is ambiguous.
  if (vals.length === 1) {
    return [isBS ? { field: "eoy", value: vals[0].v, year: null } : { field: "amount", value: vals[0].v, year: null }];
  }
  return "ambiguous";
}

/* Pool allocation: one relabel row per distinct caption, in document order.
   The template gives each "attach schedule" line a fixed number of relabel
   rows (three on Schedule F line 16, twenty-five on Schedule C line 17), and a
   statement with more accounts than that has to share the last one. Sharing is
   allowed — the form line is a single line and the total stays right — but it
   is never silent: every caption that lands on a shared row is recorded here,
   named on the row, listed with its amount in an exception, and written out in
   full on the generated workbook's "Attached schedules" sheet. */
type PoolState = Record<string, { byLabel: Map<string, number>; free: number[]; shared: string[]; groups?: Record<string, string[]> }>;

function makePoolState(): PoolState {
  const s: PoolState = {};
  for (const [key, pool] of Object.entries(POOLS)) {
    s[key] = { byLabel: new Map(), free: [...pool.rows], shared: [] };
  }
  return s;
}

/** Every caption sharing one aggregated row, in the order they were read. */
export const sharedPoolCaptions = (pools: PoolState, poolKey: string): string[] =>
  [...(pools[poolKey]?.shared || [])];

export function resolvePool(
  pools: PoolState,
  target: string,
  label: string,
  group?: string,
): { target: string; relabel?: string; overflowNote?: string; shared?: string[] } {
  const pool = POOLS[target];
  if (!pool) return { target };
  const st = pools[target];
  /* Accounts of one statement group share one row; the row takes the
     group's caption once a second account of the group arrives, and keeps
     the account's own caption while it holds only one. */
  const key = group ? `group:${group.toLowerCase().trim()}` : label.toLowerCase().trim();
  const prefix = pool.sheet === "is" ? "IS" : "BS";
  const existing = st.byLabel.get(key);
  if (existing !== undefined) {
    if (group) {
      const seen = ((st.groups ||= {})[key] ||= []);
      if (!seen.includes(label)) seen.push(label);
      if (seen.length >= 2 && !st.shared.length) return { target: `${prefix}:${existing}`, relabel: group };
    }
    /* A group whose first account reached the shared row brings the rest of
       its accounts there too. Each one is an account on that row, so the
       caption counts it: the label said "10 accounts" over a row the attached
       schedule listed 14 on. */
    if (st.shared.length && existing === st.free[0] && !st.shared.includes(label)) {
      st.shared.push(label);
      const shared = [...st.shared];
      return {
        target: `${prefix}:${existing}`,
        relabel: `Other (${shared.length} accounts — see Attached schedules)`,
        overflowNote: `${shared.length} separate accounts share one "${target}" row because the template offers ${pool.rows.length}: ${shared.join(" · ")}`,
        shared,
      };
    }
    return { target: `${prefix}:${existing}` };
  }
  if (group) (st.groups ||= {})[key] = [label];
  if (st.free.length > 1) {
    const row = st.free.shift()!;
    st.byLabel.set(key, row);
    return { target: `${prefix}:${row}`, relabel: label };
  }
  /* The last slot takes everything that no longer fits. The caption that got
     there first is part of the sharing too — counting only the ones that
     arrived after it under-reported the row by one and left the preparer
     looking for two accounts in a row that held three. */
  const row = st.free[0];
  st.byLabel.set(key, row);
  if (!st.shared) st.shared = [];
  st.shared.push(label);
  const shared = [...st.shared];
  if (shared.length < 2) return { target: `${prefix}:${row}`, relabel: label };
  return {
    target: `${prefix}:${row}`,
    relabel: `Other (${shared.length} accounts — see Attached schedules)`,
    overflowNote: `${shared.length} separate accounts share one "${target}" row because the template offers ${pool.rows.length}: ${shared.join(" · ")}`,
    shared,
  };
}

const STEM_STOP = new Set(["pty", "ltd", "limited", "inc", "llc", "corp", "corporation", "the", "and", "solutions", "americas", "group"]);

function groupNameStems(names: string[]): Set<string> {
  const stems = new Set<string>();
  for (const n of names) {
    for (const t of String(n || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)) {
      if (t.length >= 4 && !STEM_STOP.has(t)) stems.add(t);
    }
  }
  return stems;
}

/** A balance-sheet caption naming a group entity AND carrying receivable/
    payable context is a related-party balance. A bare name hit is not enough
    — common words leak into name stems, and defaulting to an asset would
    fabricate balances. */
function relatedPartyTarget(label: string, stems: Set<string>): "BS:19" | "BS:52" | null {
  const l = label.toLowerCase();
  if (![...stems].some((s) => new RegExp(`\\b${s}\\b`).test(l))) return null;
  if (/\bdr\b|debtor|receivable|owed by|due from|loan to/.test(l)) return "BS:19";
  if (/\bcr\b|creditor|payable|owed to|due to|loan from/.test(l)) return "BS:52";
  return null;
}

/** The sign of the nearest row above this one, on the same page of the same
    document, that is printed further left and carries a figure — the total
    the row belongs to. 0 when there is none. */
function parentTotalSign(rows: MapRow[], m: MapRow): -1 | 0 | 1 {
  const at = rows.indexOf(m);
  const x = typeof m.x0 === "number" ? m.x0 : null;
  if (at < 0 || x === null) return 0;
  for (let i = at - 1; i >= 0; i--) {
    const p = rows[i];
    if (p.docId !== m.docId || p.row.page !== m.row.page) break;
    const v = (p.row.values || [])[0];
    if (typeof p.x0 === "number" && p.x0 < x - 1 && typeof v === "number" && v !== 0) return v < 0 ? -1 : 1;
  }
  return 0;
}

const daysInYear = (y: number) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);

/** Valid explicit-assignment targets — a hallucinated "IS:9" (subtotal) or
    "IS:99" from Groq must never reach the write path. */
const VALID_TARGETS = new Set([
  ...IS_LINES.map((l) => `IS:${l.row}`),
  ...BS_LINES.map((l) => `BS:${l.row}`),
]);

const specFor = (target: string) =>
  target.startsWith("IS")
    ? IS_LINES.find((l) => `IS:${l.row}` === target)
    : BS_LINES.find((l) => `BS:${l.row}` === target);

/** Sum contributions per field; used to keep line values honest. */
function sumContribs(list: Contribution[]) {
  const total = { amount: 0, boy: 0, eoy: 0 };
  const has = { amount: false, boy: false, eoy: false };
  for (const c of list) { total[c.field] += c.value; has[c.field] = true; }
  return { total, has };
}

function linesFromContribs(list: Contribution[]): LineValue | null {
  const { total, has } = sumContribs(list);
  const out: LineValue = {};
  if (has.amount) out.amount = total.amount;
  if (has.boy) out.boy = total.boy;
  if (has.eoy) out.eoy = total.eoy;
  return Object.keys(out).length ? out : null;
}

/** Apply an explicitly assigned row (manual or Groq) with provenance.
    Returns false when the assignment could not be applied safely. */
/* The U.S. Shareholders block, template rows 7-14.

   Schedule B counts two different populations. Part I is the U.S.
   shareholders — direct AND indirect — and is the only place the pro rata
   Subpart F percentage appears. Part II is the direct legal owners. The
   template has a block for each, but ships rows 7-14 as B7=B19, H7=H19,
   J7=J19: a one-row mirror of the FIRST direct holder. On HMC Communications
   that printed a New Zealand trust as a 100% U.S. shareholder, while the two
   real U.S. shareholders named in Part I appeared nowhere and the Subpart F
   column stayed blank. Writing the Part I rows replaces the mirror.

   Returns nothing when there is no Part I data: the mirror is then the best
   the file has, and a review item says so rather than blanking the block. */
const US_ROWS = 8;

/** Total shares outstanding, as the return itself implies it.

    Schedule B Part I states BOTH a share count (columns (c)/(d)) and the pro
    rata percentage (column (e)) for the SAME holder, so the denominator the
    preparer worked to is shares ÷ (pct/100). HMC Communications: 25.5 ÷ 0.255
    = 100 shares issued, which makes the trust's 98 direct shares 98% — not the
    100% you get by dividing by the direct-holder total, and makes each U.S.
    shareholder 25.50% rather than 26.02%.

    Returns null when Part I states no percentage, or when the holders imply
    different totals. The template then falls back to the direct-holder total,
    which is what it always did. */
export function outstandingFromPartI(list: Shareholder[] | undefined, field: "boy" | "eoy"): number | null {
  const implied: number[] = [];
  for (const h of list || []) {
    const shares = Number(h[field]);
    const pct = Number(h.pct);
    if (!isFinite(shares) || shares <= 0 || !isFinite(pct) || pct <= 0) continue;
    implied.push(shares / (pct / 100));
  }
  if (!implied.length) return null;
  // Every holder must point at the same denominator, allowing for the rounding
  // the form prints to (25.50% is stated to 2 dp, so tolerate half a share).
  const first = implied[0];
  if (implied.some((v) => Math.abs(v - first) > Math.max(0.5, first * 0.005))) return null;
  return r2(implied.reduce((n, v) => n + v, 0) / implied.length);
}

export function usShareholderWrites(list: Shareholder[] | undefined, fallbackSource?: string,
                                    directTotals?: { boy: number; eoy: number }): CellWrite[] {
  const holders = (list || []).slice(0, US_ROWS);
  if (!holders.length) return [];
  const add: CellWrite[] = [];
  holders.forEach((h, i) => {
    const row = 7 + i;
    const src = h.source || fallbackSource || "US shareholders tab";
    add.push({ sheet: SHEET.shareholding, ref: `B${row}`, value: h.name, source: src });
    add.push({ sheet: SHEET.shareholding, ref: `F${row}`, value: h.classOfShares, source: src });
    add.push({ sheet: SHEET.shareholding, ref: `H${row}`, value: h.boy, source: src });
    add.push({ sheet: SHEET.shareholding, ref: `J${row}`, value: h.eoy, source: src });
    // The cell is formatted as a percentage, so 25.5% is stored as 0.255.
    if (typeof h.pct === "number" && isFinite(h.pct)) {
      /* dp: a percentage stored as a fraction needs more than the default 2 dp -
         25.5% is 0.255, and rounding to 2 shipped 0.26 (26%). */
      add.push({ sheet: SHEET.shareholding, ref: `P${row}`, value: r2(h.pct) / 100, dp: 6, source: `${src} · Sch B Part I col (e)` });
    } else {
      /* Part I stated no percentage for this holder. Clear the cell rather
         than leave one behind from an earlier run or from the template. */
      add.push({ sheet: SHEET.shareholding, ref: `P${row}`, value: "", source: `${src} · no pro rata % stated in Part I` });
    }
  });
  /* Clear every row the list does not fill. Row 7 is the only one carrying a
     mirror formula, but a shorter list on a re-run must not leave a previous
     run's holder behind either. */
  for (let row = 7 + holders.length; row <= 7 + US_ROWS - 1; row++) {
    for (const col of ["B", "F", "H", "J", "P"]) {
      add.push({ sheet: SHEET.shareholding, ref: `${col}${row}`, value: "", source: "US shareholder row not used" });
    }
  }

  /* H4/J4 — total shares outstanding, the denominator for every % Ownership
     cell in BOTH blocks. Written only when Part I implies it consistently AND
     it is at least what the direct holders already hold; a smaller figure
     would be nonsense and is left for the preparer, with a review item. */
  for (const [field, ref] of [["boy", "H4"], ["eoy", "J4"]] as const) {
    const implied = outstandingFromPartI(holders, field);
    const held = directTotals ? directTotals[field] : 0;
    if (implied === null || implied + 0.005 < held) continue;
    add.push({
      sheet: SHEET.shareholding, ref, value: implied, dp: 4,
      source: `${fallbackSource || "Sch B Part I"} · shares ÷ pro rata % from Sch B Part I column (e)`,
    });
  }
  return add;
}

/** Regenerate the Shareholding-row writes after a shareholders-tab edit —
    the workbook must always reflect the CURRENT list without a re-process. */
function rebuildShareholderWrites(ent: Entity): CellWrite[] {
  const keep = ent.extraWrites.filter((w) => !(w.sheet === SHEET.shareholding
    && (/^[BFHJ](19|2[0-6])$/.test(w.ref) || /^[BFHJP](?:[7-9]|1[0-4])$/.test(w.ref) || w.ref === "H4" || w.ref === "J4")));
  const add: CellWrite[] = [];
  ent.shareholders.slice(0, 8).forEach((h, i) => {
    const row = 19 + i;
    add.push({ sheet: SHEET.shareholding, ref: `B${row}`, value: h.name, source: h.source || "shareholders tab" });
    add.push({ sheet: SHEET.shareholding, ref: `F${row}`, value: h.classOfShares, source: h.source || "shareholders tab" });
    add.push({ sheet: SHEET.shareholding, ref: `H${row}`, value: h.boy, source: h.source || "shareholders tab" });
    add.push({ sheet: SHEET.shareholding, ref: `J${row}`, value: h.eoy, source: h.source || "shareholders tab" });
  });
  for (let row = 19 + Math.min(ent.shareholders.length, 8); row <= 22; row++) {
    add.push({ sheet: SHEET.shareholding, ref: `B${row}`, value: "", source: "template demo data cleared" });
    add.push({ sheet: SHEET.shareholding, ref: `J${row}`, value: "", source: "template demo data cleared" });
    if (row > 19) add.push({ sheet: SHEET.shareholding, ref: `H${row}`, value: "", source: "template demo data cleared" });
  }
  const dt = { boy: (ent.shareholders || []).reduce((n, h) => n + (Number(h.boy) || 0), 0),
               eoy: (ent.shareholders || []).reduce((n, h) => n + (Number(h.eoy) || 0), 0) };
  return [...keep, ...add, ...usShareholderWrites(ent.usShareholders, undefined, dt)];
}

/** The staleness prune: drop AUTO-derived data whose source document is no
    longer attached. Hand-typed values (no detected entry, or value drifted
    from the detection), sign-offs, mapOverrides, translations and
    excludedSheets are untouched. Returns null when nothing changed. */
function pruneRemovedDocData(ent: Entity): Partial<Entity> | null {
  const names = ent.files.map((f) => f.name);
  const cites = (label?: string, src?: { doc?: string | null }): boolean => {
    if (src?.doc) return names.includes(src.doc);
    if (!label) return true;
    // Only doc-shaped provenance is prunable; "statement year" and friends
    // are conservatively kept (recomputed every run anyway).
    if (!/\.(pdf|xlsx|xlsm|xls|csv)/i.test(label)) return true;
    return names.some((nm) => label.startsWith(nm));
  };
  const detected = { ...ent.detected };
  const profile = { ...ent.profile };
  const ownership = { ...ent.ownership };
  const categories = { ...ent.categories };
  let currencyConfirmed = ent.currencyConfirmed;
  let fxPatch: Partial<Entity> = {};
  let changed = false;
  for (const k of Object.keys(detected)) {
    const d = detected[k];
    if (!d || cites(d.sourceLabel, d.src)) continue;
    delete detected[k];
    changed = true;
    if (k.startsWith("cat:")) {
      const code = k.slice(4);
      if (categories[code]) categories[code] = false;
      continue;
    }
    if (profile[k] !== undefined && profile[k] === d.value) {
      profile[k] = "";
      if (k === "currency") {
        currencyConfirmed = false;
        if (ent.fxAuto) fxPatch = { fx: {}, fxMeta: {} };
      }
    } else if (ownership[k] !== undefined && ownership[k] === d.value) {
      ownership[k] = "";
    }
  }
  const shareholders = (ent.shareholders || []).filter(
    (s) => !s.source || names.some((nm) => s.source!.startsWith(nm)),
  );
  if (shareholders.length !== (ent.shareholders || []).length) changed = true;
  if (!changed) return null;
  return { detected, profile, ownership, categories, shareholders, currencyConfirmed, ...fxPatch };
}

/** Schedule C line 21a is an EXPENSE and the form takes it positive, which is
    what the hand-prepared work papers show. The template used to compute row 56
    as a plain SUM of rows 52-55, which forced the tax to be booked negative to
    come out right; row 56 now subtracts rows 54 and 55, so the figure is booked
    exactly as the statement prints it. A statement that prints the tax negative
    is stating a credit, and a credit still belongs on the line as a negative —
    flagged, because the other reading is a presentation artifact. */
const TAX_TARGETS = new Set(["IS:62", "IS:63"]);
/** Total deductions (row 51) is SUM(F26:F33) and net income is F25 − F51, so
    every deduction must book POSITIVE. Statements that present financial costs
    as negatives — "86000 Interest paid  −49,00" in the 2Hats accounts, where
    operating costs print positive but financial ones print negative — would
    otherwise ADD to income: that €49 booked as −49 understated deductions by
    €98 and turned a €153.53 loss into a €55.53 one. */
const DEDUCTION_TARGETS = new Set(
  IS_LINES.filter((l) => l.group === "Deductions").map((l) => `IS:${l.row}`),
);
const taxBookValue = (_target: string, _field: "amount" | "eoy" | "boy", value: number): number => value;
/** A tax line the statement printed as a negative. Row 56 subtracts it, so it
    will ADD to profit — right for a real credit, wrong for a presentation
    artifact, and only the preparer can tell which. */
const taxPrintedNegative = (target: string, field: "amount" | "eoy" | "boy", value: number): boolean =>
  field === "amount" && TAX_TARGETS.has(target) && value < 0;

/** Correct a deduction line whose AGGREGATED total came out negative.
    This runs after every contribution is summed, never per contribution: a
    negative detail inside a positive aggregate is a real credit and must
    survive ("40990 Other personnel costs −9,37" nets against +2,400 of WKR
    expenses inside compensation, and 186,640.63 is right). A line whose whole
    total is negative is the presentation artifact — the 2Hats accounts print
    operating costs positive but financial ones negative, so €49 of interest
    arrived as −49, and row 51 being subtracted from income turned that into
    €98 of extra profit. Returns the lines to flip, so the caller can log it. */
function negativeDeductionTotals(lines: Record<string, LineValue>): string[] {
  const out: string[] = [];
  for (const key of DEDUCTION_TARGETS) {
    const amt = lines[key]?.amount;
    if (typeof amt === "number" && isFinite(amt) && amt < 0) out.push(key);
  }
  return out;
}

/** The company's books printed under another name.

    A prior-year return with ONE Form 5471 says which corporation this case
    is about. When every current document then names one other company (and
    never the corporation itself), that other name is how the same company's
    books are kept — a trading name, the name of its disregarded LLC, the
    bookkeeping file's name. It is not a second foreign corporation: a second
    corporation would have its own Form 5471, or its own statements beside
    this one's. Treating it as one held back every statement page and booked
    nothing. The preparer is still asked to confirm the legal name; a "no,
    different company" answer switches this off. Returns null whenever the
    papers could be two companies. */
export function booksNameAlias(
  docs: Array<{ kind: string; entityName?: string | null; foreignCorpName?: string | null; duplicateOf?: string | null;
    blocks5471?: Array<{ cfcName?: string | null }> }>,
  otherEntityNames: string[],
  decision?: { sameEntity: boolean } | null,
): { alias: string; cfcName: string } | null {
  if (decision && decision.sameEntity === false) return null;
  const live = docs.filter((d) => !d.duplicateOf);
  const distinct = (names: string[]) => {
    const out: string[] = [];
    for (const n of names) {
      const t = String(n || "").trim();
      if (t && !out.some((o) => entitySimilarity(o, t) >= 0.5)) out.push(t);
    }
    return out;
  };
  const prior = distinct(live.filter((d) => d.kind === "prior-year-us-return").flatMap((d) => {
    const blocks = (d.blocks5471 || []).map((b) => String(b.cfcName || "")).filter(Boolean);
    return blocks.length ? blocks : [String(d.foreignCorpName || d.entityName || "")];
  }));
  if (prior.length !== 1) return null;
  const current = live.filter((d) => d.kind !== "prior-year-us-return");
  if (current.some((d) => d.entityName && entitySimilarity(String(d.entityName), prior[0]) >= 0.5)) return null;
  const others = distinct(current.map((d) => String(d.entityName || "")));
  if (others.length !== 1) return null;
  const real = otherEntityNames.map((n) => String(n || "").trim()).filter((n) => n && !/^entity \d+$/i.test(n));
  if (real.some((n) => entitySimilarity(n, others[0]) >= 0.5 || entitySimilarity(n, prior[0]) >= 0.5)) return null;
  return { alias: others[0], cfcName: prior[0] };
}

/** Schedule F at whole US dollars.

    Every line is rounded on its own (the template's USD columns), so a
    balance sheet that ties to the cent can be a dollar or two out once
    rounded — the form then does not foot. The preparer is told by how much
    and where the usual fix goes (retained earnings), instead of finding a
    stray figure on the check row. Rounding only: nothing when the
    functional-currency columns do not tie, or when the gap is bigger than
    the number of rounded lines could make it. */
export function usdRoundingGaps(lines: Entity["lines"], cyRate: number | null, pyRate: number | null): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const [field, rate, col] of [["eoy", cyRate, "H"], ["boy", pyRate, "G"]] as const) {
    if (!rate || !isFinite(rate) || rate <= 0) continue;
    let assets = 0, lc = 0, assetsUsd = 0, lcUsd = 0, n = 0;
    for (const l of BS_LINES) {
      const v = lines[`BS:${l.row}`]?.[field];
      if (typeof v !== "number" || !isFinite(v)) continue;
      const usd = Math.round(v / rate);
      n++;
      if (/assets/i.test(l.group)) { assets += v; assetsUsd += usd; }
      else if (l.row === 62) { lc -= v; lcUsd -= usd; }
      else { lc += v; lcUsd += usd; }
    }
    const gap = assetsUsd - lcUsd;
    if (!n || Math.abs(assets - lc) >= 0.01 || gap === 0 || Math.abs(gap) > n) continue;
    out.push({
      id: `usd-rounding-${field}`, level: "warn", category: "tie-out",
      message: `At whole US dollars Schedule F is out by ${gap} at the ${field === "eoy" ? "end" : "beginning"} of the year (assets ${assetsUsd.toLocaleString()}, liabilities and equity ${lcUsd.toLocaleString()}), although it ties to the cent in the local-currency column: each line is rounded on its own. The filed form must foot — adjust retained earnings (line 22, USD column ${col}61) by ${gap > 0 ? "+" : ""}${gap} when filing, the usual home for a rounding difference.`,
      target: `${SHEET.bs}!${col}61`,
    });
  }
  return out;
}

/** Which class of stock the capital is, as the prior return filed it.
 *
 * A statement prints "Contributed capital" or "Share capital" without saying
 * preferred or common, and the catalogue's default is common stock (line
 * 20b). When last year's filed Schedule F carried the capital on line 20a
 * (preferred) and nothing on 20b, this year follows the filing: the same
 * shares do not change class between years, and the reviewed paper that
 * prompted this kept them on 20a. A caption that names its class, a
 * preparer's own assignment, and a line 20a the documents already fill are
 * all left alone. Returns the moved maps, or null when nothing moves. */
export function capitalClassFromPrior(
  ent: Pick<Entity, "lines" | "contributions" | "sourceLabels" | "relabels" | "mapOverrides">,
  prior: { preferredStock?: number; commonStock?: number },
): Pick<Entity, "lines" | "contributions" | "sourceLabels" | "relabels"> | null {
  const pf = prior.preferredStock, cs = prior.commonStock;
  if (!(typeof pf === "number" && pf > 0) || (typeof cs === "number" && cs !== 0)) return null;
  const from = ent.lines["BS:59"];
  if (!from) return null;
  const to = ent.lines["BS:58"] || {};
  const fields = (["boy", "eoy"] as const).filter((f) => typeof from[f] === "number");
  if (!fields.length || fields.some((f) => typeof to[f] === "number")) return null;
  const caps = ent.contributions?.["BS:59"] || [];
  const ov = ent.mapOverrides || {};
  if (caps.some((c) => c.via === "manual" || c.via === "groq"
      || /\b(common|ordinary|preferred|preference)\b/i.test(c.label)
      || ov[norm(c.label)] !== undefined)) return null;
  const lines: Entity["lines"] = { ...ent.lines, "BS:58": { ...to, ...Object.fromEntries(fields.map((f) => [f, from[f]])) } };
  delete lines["BS:59"];
  const contributions = { ...(ent.contributions || {}) };
  contributions["BS:58"] = [...(contributions["BS:58"] || []), ...caps];
  delete contributions["BS:59"];
  const sourceLabels = { ...(ent.sourceLabels || {}) };
  if (sourceLabels["BS:59"] && !sourceLabels["BS:58"]) sourceLabels["BS:58"] = sourceLabels["BS:59"];
  delete sourceLabels["BS:59"];
  const relabels = { ...(ent.relabels || {}) };
  if (relabels["BS:59"] && !relabels["BS:58"]) relabels["BS:58"] = relabels["BS:59"];
  delete relabels["BS:59"];
  return { lines, contributions, sourceLabels, relabels };
}

/* The same figure, read twice off one page.
 *
 * A rule booked "Net turnover 10,400" from page 10 of a scanned Dutch annual
 * statement. The OCR of that same page also yielded the fragment "Gross
 * 10,400", which the model proposed for the same line — so gross receipts
 * carried the amount twice and came out overstated by its whole value.
 *
 * Same document, same page, same line, same amount is the same money,
 * whatever caption the reader attached to it. Two genuinely different
 * accounts that happen to print an identical figure are still booked
 * separately by the rules; this only stops a SECOND reader re-booking a
 * figure the first one already placed. */
export function figureAlreadyBooked(
  contributions: Record<string, Contribution[]>,
  target: string,
  row: { docId?: string; page?: number; values?: Array<number | null> },
): number | null {
  const here = contributions[target] || [];
  for (const v of row.values || []) {
    if (typeof v !== "number" || !isFinite(v) || v === 0) continue;
    const hit = here.find((c) =>
      c.docId === (row.docId || "") && c.page === row.page &&
      Math.abs(Math.abs(c.value) - Math.abs(v)) <= 0.005);
    if (hit) return v;
  }
  return null;
}

export function manualApply(
  ent: Entity,
  lines: Record<string, LineValue>,
  contributions: Record<string, Contribution[]>,
  relabels: Record<string, string>,
  target: string,
  row: ExtractedRow & { docId?: string; docName?: string },
  via: "manual" | "groq",
): boolean {
  if (!VALID_TARGETS.has(target)) return false;
  // Year identity survives into unmatched rows — honour it, never guess the
  // prior-year column into the current year.
  const caseYears = resolveCaseYears(ent);
  const routed = routeRow(row, target.startsWith("BS"), caseYears, row.years?.some((y) => y !== null) ? "pdf" : "grid");
  if (routed === "ambiguous" || !routed.length) return false;
  for (const r of routed) {
    const booked = taxBookValue(target, r.field, r.value);
    const cur = lines[target] || {};
    // Round at each accumulation: a line built from twenty contributions
    // otherwise carries twenty float errors into the cell.
    if (r.field === "amount") lines[target] = { amount: r2add(cur.amount, booked) };
    else if (r.field === "eoy") lines[target] = { ...cur, eoy: r2add(cur.eoy, booked) };
    else lines[target] = { ...cur, boy: r2add(cur.boy, booked) };
    (contributions[target] ||= []).push({
      docId: row.docId || "", docName: row.docName || "manual entry", page: row.page,
      label: row.label, value: booked, field: r.field, year: r.year, via,
      srcValues: row.values, srcYears: row.years, period: row.period,
    });
  }
  // Relabel-capable rows carry the source caption into the workbook.
  const spec = target.startsWith("IS")
    ? IS_LINES.find((l) => `IS:${l.row}` === target)
    : BS_LINES.find((l) => `BS:${l.row}` === target);
  if (spec?.relabel && !relabels[target]) relabels[target] = row.label;
  return true;
}

/** The filer's share of a distribution to all shareholders: its own
    ownership percentage, or the whole when that is unknown or 100%. */
function filerShare(ent: Entity): number {
  const pct = Number(ent.ownership.ownEnd || ent.ownership.ownStart || 0);
  return pct > 0 && pct < 100 ? pct / 100 : 1;
}

/** Who received a distribution, by the register of direct holders. A
    dividend is paid on the shares a person holds directly, so when the
    register names two or more holders the distribution splits by their
    closing share counts — the filer's stock ownership for the filer
    categories may be larger (family attribution), but that is not what they
    were paid. One or no named holder: null, and the caller keeps its old
    single-recipient behaviour. The last holder takes the rounding so the
    parts add back to the whole. */
export function distributionSplit(ent: Entity, amount: number): Array<{ name: string; share: number; amount: number }> | null {
  const holders = (ent.shareholders || []).filter((h) => (Number(h.eoy) || Number(h.boy) || 0) > 0 && String(h.name || "").trim());
  const total = holders.reduce((n, h) => n + (Number(h.eoy) || Number(h.boy) || 0), 0);
  if (holders.length < 2 || !(total > 0)) return null;
  /* Only when every holder is a U.S. shareholder of the work paper: then the
     parts are the distributions the U.S. persons received and they add up to
     the whole. With a foreign holder in the register the schedule keeps the
     single row of the whole distribution, as the reviewed papers do. */
  const key = (n: string) => String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const us = ent.usShareholders || [];
  if (!holders.every((h) => us.some((u) => samePerson(u.name, h.name) || key(u.name) === key(h.name)))) return null;
  let left = amount;
  return holders.slice(0, 14).map((h, i, arr) => {
    const share = (Number(h.eoy) || Number(h.boy) || 0) / total;
    const part = i === arr.length - 1 ? r2(left) : r2(amount * share);
    left = r2(left - part);
    return { name: h.name, share, amount: part };
  });
}

/** The filer's own part of a distribution: the register's direct share when
    the filer is one of two or more named holders, else the ownership share. */
function dividendShareOfFiler(ent: Entity): number {
  const split = distributionSplit(ent, 1);
  const me = split && ent.profile.clientName ? split.find((h) => samePerson(h.name, ent.profile.clientName || "")) : null;
  return me ? me.share : filerShare(ent);
}

/* ---------------- targeted document facts ---------------- */

type EquityFacts = {
  openingCY: number | null;
  profitCY: number | null;
  dividendsCY: number | null;   // positive amount
  closingCY: number | null;
};

function pullEquityFacts(pdf: NonNullable<ParsedDoc["pdf"]>, pages: Set<number>, rulers: ReturnType<typeof detectRulers>, cy: number | null): EquityFacts {
  const rows = extractPositionedRows(pdf, rulers, { pages, raw: true });
  const out: EquityFacts = { openingCY: null, profitCY: null, dividendsCY: null, closingCY: null };
  const cyVal = (r: ExtractedRow): number | null => {
    if (r.years && cy) {
      const i = r.years.findIndex((y) => y === cy);
      return i >= 0 ? r.values[i] : null;
    }
    return r.values.length === 1 ? r.values[0] : null;
  };
  for (const r of rows) {
    const l = r.label.toLowerCase();
    const v = cyVal(r);
    if (v === null) continue;
    if (out.openingCY === null && /(opening|beginning of).*retained (profits|earnings)|retained (profits|earnings).*(beginning|start) of/.test(l)) out.openingCY = v;
    else if (out.closingCY === null && /(closing|end of).*retained (profits|earnings)|retained (profits|earnings).*end of/.test(l)) out.closingCY = v;
    else if (out.dividendsCY === null && /dividend/.test(l)) out.dividendsCY = Math.abs(v);
    else if (out.profitCY === null && /(net )?(profit|loss)/.test(l) && !/retained/.test(l)) {
      // "Loss for the year 25,164" prints positive; a loss-only caption means negative.
      out.profitCY = /\bloss\b/.test(l) && !/\bprofit\b/.test(l) ? -Math.abs(v) : v;
    }
  }
  if (out.dividendsCY === null || out.profitCY === null) {
    const col = columnarEquityFacts(pdf, pages);
    if (out.dividendsCY === null && col.dividends !== null) out.dividendsCY = col.dividends;
    if (out.profitCY === null && col.profit !== null) out.profitCY = col.profit;
  }
  return out;
}

/* A UK statement of changes in equity runs its columns by RESERVE (Share
   capital | Share premium | Retained earnings | Total equity) and prints no
   year header: its two years are told apart only by the balance lines
   between them ("At 1 December 2022", "At 30 November 2023 and 1 December
   2023", "At 30 November 2024"). The current year is the block between the
   last two of those lines. A movement that touches one reserve prints the
   same figure in that reserve's column and in the total, so a line whose
   figures all agree is read; anything else is left alone. */
function columnarEquityFacts(pdf: NonNullable<ParsedDoc["pdf"]>, pages: Set<number>): { dividends: number | null; profit: number | null } {
  const out = { dividends: null as number | null, profit: null as number | null };
  const lines: { label: string; nums: number[] }[] = [];
  for (const r of pdf.rows) {
    if (!pages.has(r.page)) continue;
    let label = "";
    const nums: number[] = [];
    for (const c of r.cells) {
      const t = c.text.trim();
      const n = label ? numericCell(t) : null;
      if (n !== null) nums.push(n);
      else if (!label && /[a-z]/i.test(t)) label = t;
    }
    lines.push({ label, nums });
  }
  const bounds = lines.map((l, i) => (/^(?:balance\s+)?(?:at|as\s+at)\s+\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+/i.test(l.label) ? i : -1)).filter((i) => i >= 0);
  if (bounds.length < 2) return out;
  const block = lines.slice(bounds[bounds.length - 2] + 1, bounds[bounds.length - 1]);
  const one = (nums: number[]) =>
    nums.length && nums.every((v) => Math.abs(Math.abs(v) - Math.abs(nums[0])) <= 0.5) ? nums[0] : null;
  for (const l of block) {
    const v = one(l.nums);
    if (v === null) continue;
    const lab = l.label.toLowerCase();
    if (out.dividends === null && /dividend/.test(lab)) out.dividends = Math.abs(v);
    else if (out.profit === null && /\b(profit|loss)\b/.test(lab) && !/retained/.test(lab)) {
      out.profit = /\bloss\b/.test(lab) && !/\bprofit\b/.test(lab) ? -Math.abs(v) : v;
    }
  }
  return out;
}

type AtoFacts = {
  totalDebt?: number;
  paygRefundable?: number;
  taxPayable?: number;
  frankedDividendsPaid?: number;
  dividendDate?: string;          // "12/18/24" (converted from AU d/m/y)
  frankingOpening?: number;
  frankingClosing?: number;
  frankingCredit?: number;
  relatedPartyYes?: boolean;
};

function pullAtoFacts(pdf: NonNullable<ParsedDoc["pdf"]>, pages: Set<number>): AtoFacts {
  const out: AtoFacts = {};
  const rows = pdf.rows.filter((r) => pages.has(r.page)).map((r) => ({ page: r.page, cells: r.cells.map((c) => c.text) }));
  const val = (re: RegExp): number | undefined => {
    for (const r of rows) {
      const idx = r.cells.findIndex((c) => re.test(c));
      if (idx < 0) continue;
      const nums = r.cells.slice(idx).map((c) => numericLoose(c)).filter((n): n is number => n !== null);
      if (nums.length) return nums[nums.length - 1];
    }
    return undefined;
  };
  // Assign only when found — an undefined-valued property would override a
  // fact found in an earlier document when the objects are spread-merged.
  const setFact = (k: keyof AtoFacts, re: RegExp) => {
    const v = val(re);
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  };
  setFact("totalDebt", /^total debt\b/i);
  setFact("paygRefundable", /total amount of tax refundable|payg instalments raised/i);
  setFact("taxPayable", /^tax payable\b/i);
  setFact("frankedDividendsPaid", /franked (dividends|distributions) paid/i);
  setFact("frankingOpening", /opening franking account balance/i);
  setFact("frankingClosing", /closing franking account balance/i);
  setFact("frankingCredit", /franking credit\b/i);
  if (rows.some((r) => /international related parties/i.test(r.cells.join(" ")))) out.relatedPartyYes = true;

  // The dividend payment date: the franking worksheet logs "Dividend Paid"
  // with its date; the dividend schedule may carry the amount and a date too.
  if (out.frankedDividendsPaid) {
    for (const r of rows) {
      const t = r.cells.join(" ");
      const dm = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(t);
      if (!dm) continue;
      const isDividendRow =
        /dividend/i.test(t) || r.cells.some((c) => numericLoose(c) === out.frankedDividendsPaid);
      if (isDividendRow) {
        out.dividendDate = `${parseInt(dm[2], 10)}/${parseInt(dm[1], 10)}/${dm[3].slice(2)}`;   // AU d/m/y → m/d/yy
        break;
      }
    }
  }
  return out;
}

/** numeric() with the ATO's trailing " / X" code letters stripped first,
    and date-like strings rejected. */
function numericLoose(s: string): number | null {
  const t = String(s).replace(/\s*\/\s*[A-Z]?$/i, "").trim();
  if (/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(t)) return null;
  return numeric(t);
}

/* ---------------- schedule-write materialization ---------------- */

type CaseFacts = {
  caseYears: { cy: number | null; py: number | null };
  equity: EquityFacts | null;
  ato: AtoFacts;
  cf: CarryForward | null;
  cfSource: string;
  /** The prior return does not close where this work paper opens, so nothing
      may be carried from it. Optional: absent means it lines up. */
  cfStale?: boolean;
  ledger: LedgerSummary | null;
  questionnaire: Questionnaire | null;
  salary: SalarySchedule | null;
  rv: (item: Omit<ReviewItem, "id"> & { id?: string }) => void;
};

/* Exported for the tests: this is where every Schedule J/M/R/E/P/H write is
   created, and the Schedule M inference in particular is worth exercising
   directly rather than through a whole document run. */
export async function materializeCaseWrites(
  ent: Entity,
  facts: CaseFacts,
): Promise<{ list: CellWrite[]; dividends: DividendRec[] }> {
  const { caseYears, equity, ato, cf, cfSource, cfStale, ledger, questionnaire, salary, rv } = facts;
  const list: CellWrite[] = [];
  const dividends: DividendRec[] = [];
  const avgRate = numeric(ent.fx.avgRate);
  const cyRate = numeric(ent.fx.cyRate);
  const pyRate = numeric(ent.fx.pyRate);
  const w = (write: CellWrite) => list.push(write);
  /* The year's distribution: an equity-movement statement, an Australian
     return's franked dividends, or — when neither — a dividend line printed
     inside the balance sheet's equity ("Dividend Payouts 43,478"). */
  const eqDiv = equityDividendLine(ent);
  const divPlanned = equity?.dividendsCY ?? ato.frankedDividendsPaid ?? eqDiv?.amount ?? null;

  /* ---- carry-forward: separate-category code ---- */
  /* The template ships with "FB - Foreign Branch" selected on Schedule J,
     which is the rare case. The filed code is on the prior return's Schedules
     J, E, H and P; carry it to every tab that asks. */
  if (cf) {
    const CATEGORY_LABEL: Record<string, string> = {
      GEN: "GEN - General", PAS: "PAS - Passive", FB: "FB - Foreign Branch",
      "901j": "901j", RBT: "RBT - Re-sourced by Treaty", "951A": "951A",
    };
    const code = cf.separateCategory && CATEGORY_LABEL[cf.separateCategory];
    if (code) {
      w({ sheet: SHEET.schJ, ref: "C10", value: code, source: `${cfSource} · separate category as filed` });
      w({ sheet: SHEET.schP, ref: "B10", value: code, source: `${cfSource} · separate category as filed` });
      w({ sheet: SHEET.schH, ref: "C8", value: code, source: `${cfSource} · separate category as filed` });
      // Schedule Q asks the same question from the same dropdown.
      w({ sheet: SHEET.schQ, ref: "C10", value: code, source: `${cfSource} · separate category as filed` });
    } else {
      rv({
        id: "cf-category-code", level: "info", category: "carry-forward",
        message: `The separate-category code (GEN / PAS / FB / 901j / RBT / 951A) could not be read from ${cfSource}. Schedule J C10, Schedule P B10, Sch-H C8 and Schedule Q C10 keep the template default "GEN - General" — confirm against the prior filing.`,
        target: `${SHEET.schJ}!C10`, source: cfSource,
      });
    }
  }

  /* ---- Schedule Q's tested-income unit ----
     Schedule Q reports by unit, and the first unit of a single-CFC work paper
     is the corporation itself: its name, and the country it is incorporated
     in as the IRS's own two-letter code. Both are already answered on Basic
     Information, and both were being left blank for the preparer to copy
     across by hand. Nothing is written that is not already known. */
  {
    /* A corporation whose accounts are kept under another company's name
       (a disregarded LLC, a trading name — see booksNameAlias) reports that
       business as its tested unit; the reviewed paper named the unit after
       the books, not the corporation. */
    const legal = String(ent.profile.legalName || "");
    const booksName = (ent.nameAliases || []).find((a) => entitySimilarity(a, legal) < 0.5)
      || (ent.nameMismatch && entitySimilarity(ent.nameMismatch.priorName, legal) >= 0.5 ? ent.nameMismatch.statementName : "")
      || "";
    const unitName = booksName || ent.profile.legalName;
    const code = irsCountryCode(ent.profile.countryInc);
    if (unitName) {
      w({ sheet: SHEET.schQ, ref: "C57", value: unitName, source: booksName ? "the books name the statements are kept under — confirm it is the tested unit" : `Basic Information B11 · legal name`, reviewId: "schq-unit" });
    }
    if (code) {
      w({ sheet: SHEET.schQ, ref: "F57", value: code, source: `Basic Information B19 "${ent.profile.countryInc}" · IRS country code`, reviewId: "schq-unit" });
    }
    if (unitName || code) {
      rv({
        id: "schq-unit", level: "info", category: "profile", applied: true,
        message: `Schedule Q tested-income unit 1 defaulted from Basic Information: ${[unitName ? `name "${unitName}" (C57)` : "", code ? `country code ${code} (F57)` : ""].filter(Boolean).join(", ")}. Review if the corporation has more than one tested unit — the tool fills the first row only.`,
        target: `${SHEET.schQ}!C57`,
      });
    } else if (ent.profile.countryInc) {
      rv({
        id: "schq-country-unknown", level: "warn", category: "profile",
        message: `"${ent.profile.countryInc}" is not on the IRS country list, so Schedule Q F57 (country code) was left blank — enter the two-letter code from the Form 5471 instructions by hand.`,
        target: `${SHEET.schQ}!F57`,
      });
    }
  }

  /* ---- Schedule Q's tested-income unit: the figures ----
     Written when the workbook is generated (buildWrites), from the lines as
     they stand then, so a remap made after processing — "Business tax" moved
     to line 21a — reaches Schedule Q. Here only the note. */
  if (Object.keys(ent.lines).some((k) => k.startsWith("IS:"))) {
    rv({
      id: "schq-figures", level: "info", category: "consistency", applied: true,
      message: "Schedule Q unit 1 carries Schedule C's gross income (line 10 less line 8a), deductions (line 18) and income taxes (line 21a), taken when the workbook is generated. If the corporation has more than one tested unit, split them by hand.",
      target: `${SHEET.schQ}!H57`,
    });
  }

  /* ---- the GILTI high-tax exception: named, never elected ----
     A tax rate above 18.9% (90% of the 21% U.S. rate) lets the shareholder
     elect to exclude the income from tested income. That is the filer's
     election, not a figure the documents prove, so the tool does not make
     it; it says the test is met and what the election changes. */
  {
    const ni = bookNetIncome(ent.lines);
    const tax = Number(ent.lines["IS:62"]?.amount) || 0;
    if (ni !== null && tax > 0 && ni + tax > 0 && tax / (ni + tax) > 0.189) {
      const etr = r2((tax / (ni + tax)) * 100);
      rv({
        id: "hte-candidate", level: "warn", category: "consistency",
        message: `Income tax ${tax.toLocaleString()} on pre-tax income ${r2(ni + tax).toLocaleString()} is an effective rate of ${etr}%, above the 18.9% high-tax threshold (90% of the 21% U.S. rate). If the U.S. shareholder elects the GILTI high-tax exception, the income is excluded from tested income (Form 8992 nil) and the tax is shown in Schedule E Part III "Other" (row 38) instead of Part I row 16. The tool has not made the election — confirm it with the preparer and move the tax if it is elected.`,
        target: `${SHEET.schE}!Q38`,
      });
    }
  }

  /* ---- Schedule H line 2i: donations, offered — not written ----
     Reviewers differ: the Blue Water Grill paper adds its donations back as
     "Non Deductible", the HMC paper leaves a 114,000 donation in E&P (under
     U.S. principles a gift generally does reduce earnings and profits). So
     the add-back is offered with its amount; confirming it (Resubmit with the
     value) writes Schedule H C21/E21, acknowledging leaves E&P as booked. */
  {
    const gifts = Object.entries(ent.contributions).filter(([k]) => k.startsWith("IS:"))
      .flatMap(([, cs]) => cs).filter((c) => c.field === "amount" && /\b(donations?|charit(?:y|able)|gifts?\s+to)\b/i.test(c.label));
    const total = r2(gifts.reduce((n, c) => n + c.value, 0));
    if (total > 0) {
      rv({
        id: "schh-nondeductible", level: "warn", category: "consistency",
        suggestedValue: total,
        message: `${total.toLocaleString()} of donations (${gifts.map((c) => `"${c.label}"`).join(", ")}) is deducted on Schedule C. If your practice treats it as not deductible for earnings and profits, confirm this item with ${total.toLocaleString()} to add it back on Schedule H line 2i (C21/E21); otherwise acknowledge it and E&P keeps the deduction.`,
        target: `${SHEET.schH}!E21`,
      });
    }
  }

  /* ---- carry-forward: opening E&P, shareholding, prior-filed USD ---- */
  if (cf?.openingEP && !cfStale) {
    w({
      sheet: SHEET.schJ, ref: "F15", value: cf.openingEP.value,
      source: `${cfSource} p.${cf.openingEP.page} · prior Sch J line 14`, reviewId: "cf-opening-ep",
      prov: { docName: cfSource, page: cf.openingEP.page, rowText: cf.openingEP.rowText },
    });
    /* The previously taxed E&P the prior return closed with opens this year
       in the same column: (e)(i) is column N, each next numeral two columns
       on, (e)(x) is AF. Schedule P reads them from here. */
    const PTEP_COL: Record<string, string> = { b: "H", c: "J", d: "L", i: "N", ii: "P", iii: "R", iv: "T", v: "V", vi: "X", vii: "Z", viii: "AB", ix: "AD", x: "AF" };
    const carried: string[] = [];
    for (const [roman, v] of Object.entries(cf.priorPtep || {})) {
      const col = PTEP_COL[roman];
      if (!col || !v.value) continue;
      w({
        sheet: SHEET.schJ, ref: `${col}15`, value: v.value,
        source: `${cfSource} p.${v.page} · prior Sch J line 14, column ${/^[bcd]$/.test(roman) ? `(${roman})` : `(e)(${roman})`}`, reviewId: "cf-opening-ptep",
        prov: { docName: cfSource, page: v.page, rowText: v.rowText },
      });
      carried.push(`${/^[bcd]$/.test(roman) ? `(${roman})` : `(e)(${roman})`} ${v.value.toLocaleString()}`);
    }
    if (carried.length) {
      rv({
        id: "cf-opening-ptep", level: "warn", category: "carry-forward", applied: true,
        message: `Other Schedule J columns carried from ${cfSource} (prior-year Schedule J line 14): ${carried.join(", ")}. Each opens Schedule J line 1a in the same column, and Schedule P reads the previously taxed E&P from there. Confirm before filing.`,
        target: `${SHEET.schJ}!F15`, source: cfSource,
      });
    }
    const priorTax = cf.priorTaxAccruedFunctional?.value;
    const ccy = ent.profile.currency || "local";
    rv({
      id: "cf-opening-ep", level: "warn", category: "carry-forward", applied: true,
      message: `Schedule J opening E&P pre-filled at ${cf.openingEP.value.toLocaleString()} from ${cfSource} p.${cf.openingEP.page} (prior-year Sch J line 14).` +
        (priorTax !== undefined
          ? ` Caveat: check whether the prior Sch H subtracted the ${ccy} ${priorTax.toLocaleString()} tax accrued — if not, opening E&P should be ${(cf.openingEP.value - priorTax).toLocaleString()}.`
          : "") +
        " Confirm before filing.",
      target: `${SHEET.schJ}!F15`, source: cfSource, suggestedValue: cf.openingEP.value,
    });
  }
  /* ---- no prior return: the opening read from the balance sheet itself ----
     A Latin-American balance sheet closes equity with the year's result on
     its own row ("RESULTADO DEL EJERCICIO -90,666,927") beside the earnings
     brought forward ("UTILIDADES ACUMULADAS 30,010,429"). With no prior
     Form 5471 and no prior-year column, Schedule J line 1a and the Retained
     Earnings tab opened blank, so the tab could not tie and Schedule J closed
     at the year's loss alone. The earnings brought forward ARE the opening
     balance, less any distribution already taken out of them, so that is
     what is written — flagged, because E&P follows tax rules and a prior
     return, when one arrives, outranks it. Only when the equity's result row
     equals the booked net income: that is what proves the other rows are
     the opening balance and not this year's figures. */
  if (!cf && ent.lines["BS:61"]?.boy === undefined) {
    const re61 = (ent.contributions["BS:61"] || []).filter((c) => c.field === "eoy");
    const ni = bookNetIncome(ent.lines);
    const result = re61.filter((c) => isProfitLine(c.label));
    /* A dividend printed in equity is this year's movement too, like the
       result: the earnings row beside them is the opening balance as it
       stands ("Retained Earnings 824,781.28" next to "Dividends -728,941.18"). */
    const isDivRow = (c: Contribution) => /\b(dividends?|distributions?|drawings?|withdrawals?|dividendos?|retiros?)\b/i.test(c.label) && !/\b(payable|por pagar)\b/i.test(c.label);
    const divRows = re61.filter((c) => !isProfitLine(c.label) && isDivRow(c));
    const rest = re61.filter((c) => !isProfitLine(c.label) && !isDivRow(c));
    if (ni !== null && result.length === 1 && rest.length
      && Math.abs(result[0].value - ni) <= Math.max(2, Math.abs(ni) * 1e-5)) {
      // Distributions are added back only when equity does not print them.
      const distributions = divRows.length ? 0 : r2((ent.dividends || []).reduce((n, d) => n + (Number(d.amountFunctional) || 0), 0));
      const opening = r2(rest.reduce((n, c) => n + c.value, 0) + distributions);
      const source = `${rest.map((c) => `"${c.label}"`).join(" + ")} on the balance sheet${distributions ? ` + distributions ${distributions.toLocaleString()}` : ""}`;
      w({ sheet: SHEET.schJ, ref: "F15", value: opening, source, reviewId: "book-opening-ep" });
      w({ sheet: SHEET.re, ref: "F10", value: opening, source, reviewId: "book-opening-ep", replaceFormula: true });
      rv({
        id: "book-opening-ep", level: "warn", category: "carry-forward", applied: true,
        message: `No prior-year Form 5471 was supplied, so Schedule J line 1a and the opening retained earnings were taken from the balance sheet: ${source} = ${opening.toLocaleString()}. The statement shows this year's result ("${result[0].label}" ${result[0].value.toLocaleString()}) on its own row, so the remaining retained earnings are the balance brought forward. E&P follows tax rules and can differ from book retained earnings — replace it with the prior return's Schedule J line 14 when you have it.`,
        target: `${SHEET.schJ}!F15`, suggestedValue: opening,
      });
    }
  }
  /* Shareholding rows 19–26: the edited/seeded shareholder list first, the
     legacy single-holder facts second. Demo rows A/B/C/D (60/20/10/10) are
     cleared whenever a prior 5471 was recognized — NEH-007's "shareholders
     appear as A, B, C, D" was the template's own demo data surviving. */
  const holderRows: { name: string; classOfShares: string; boy: number; eoy: number; source?: string }[] =
    ent.shareholders?.length
      ? ent.shareholders
      : cf?.shares
        ? [{ name: cf.holderName || "Parent shareholder", classOfShares: cf.shares.classOfShares.replace(/\s*shares?$/i, ""), boy: cf.shares.boy, eoy: cf.shares.eoy, source: cfSource }]
        : [];
  holderRows.slice(0, 8).forEach((h, i) => {
    const row = 19 + i;
    w({ sheet: SHEET.shareholding, ref: `B${row}`, value: h.name, source: h.source || cfSource || "shareholders tab" });
    w({ sheet: SHEET.shareholding, ref: `F${row}`, value: h.classOfShares, source: h.source || cfSource || "shareholders tab" });
    w({ sheet: SHEET.shareholding, ref: `H${row}`, value: h.boy, source: h.source || cfSource || "shareholders tab" });
    w({ sheet: SHEET.shareholding, ref: `J${row}`, value: h.eoy, source: h.source || cfSource || "shareholders tab" });
  });
  /* U.S. Shareholders block, rows 7-14 — Schedule B Part I. Written from the
     entity's own list so a preparer edit survives a re-generate. */
  for (const uw of usShareholderWrites(ent.usShareholders, cfSource, {
    boy: holderRows.reduce((n, h) => n + (Number(h.boy) || 0), 0),
    eoy: holderRows.reduce((n, h) => n + (Number(h.eoy) || 0), 0),
  })) w(uw);
  if (cf || holderRows.length) {
    for (let row = 19 + Math.min(holderRows.length, 8); row <= 22; row++) {
      for (const col of ["B", "J"]) w({ sheet: SHEET.shareholding, ref: `${col}${row}`, value: "", source: "template demo data cleared" });
      if (row > 19) w({ sheet: SHEET.shareholding, ref: `H${row}`, value: "", source: "template demo data cleared" });
    }
    if (cf && !holderRows.length) {
      // Distinguish "the return has no Schedule B" from "we could not read it".
      // A second 5471 filed as page 1 only is common and is NOT a parse failure;
      // saying so stops the preparer hunting for a bug that does not exist.
      const itemH = (cf.itemH || []).filter((p) => p.isShareholder || p.isDirector || p.isOfficer);
      const message = cf.hasScheduleB === false
        ? `The prior-year return contains only page 1 for this corporation — no Schedule B was filed with it, so there are no shareholder rows to carry forward.${
            itemH.length
              ? ` Item H names ${itemH.map((p) => p.name).join(", ")}; share counts are not stated on that page.`
              : ""
          } Enter the holders in the Shareholders tab, or add this corporation's own prior return.`
        : "A prior-year 5471 was recognized but no shareholder rows could be read from its Schedule B — the template's DEMO shareholders were cleared. Enter the real holders in the Shareholders tab before generating.";
      rv({
        id: "cf-holders-missing", level: "warn", category: cf.hasScheduleB === false ? "source-gap" : "carry-forward",
        message, target: `${SHEET.shareholding}!B19`, source: cfSource,
      });
    }
    // Part I holders carry the pro rata % and the SSN — neither appears in
    // Part II. They drive rows 7-14 (the U.S. Shareholders block); rows 19-26
    // stay with the DIRECT holders from Part II.
    if (cf?.usHolders?.length) {
      rv({
        id: "cf-us-holders", level: "info", category: "carry-forward", applied: true,
        message: `Schedule B Part I lists ${cf.usHolders.length} U.S. shareholder(s): ${
          cf.usHolders.map((h) => `${h.name}${h.pct !== undefined ? ` (${h.pct}%)` : ""}`).join(", ")
        }${
          cf.usHolders.every((h) => h.pct !== undefined)
            ? ` — combined ${cf.usHolders.reduce((n, h) => n + (h.pct || 0), 0).toFixed(2)}%`
            : ""
        }. They were written to the U.S. Shareholders block (rows 7-14); rows 19-26 carry the DIRECT shareholders from Part II. The same person often appears in both, so the two blocks are kept separate rather than added together.`,
        target: `${SHEET.shareholding}!B7`, source: cfSource,
      });
      /* The percentages now divide by total shares outstanding, taken from
         Part I itself (shares ÷ pro rata %). Two things can still go wrong and
         both are worth saying out loud rather than leaving in a cell. */
      const outEoy = outstandingFromPartI(ent.usShareholders, "eoy");
      const dirEoy = (cf.holders || []).reduce((n, h) => n + (Number(h.eoy) || 0), 0);
      if (outEoy === null) {
        rv({
          id: "cf-us-holder-base", level: "warn", category: "carry-forward",
          message: `Schedule B Part I does not state a usable pro rata percentage for every U.S. shareholder, so total shares outstanding could not be derived. The % Ownership columns fall back to dividing by the DIRECT holders' total (${dirEoy || "0"}), which reads 100% whenever one holder owns all the listed shares. Enter the real total in Shareholding Details H4/J4 if it differs.`,
          target: `${SHEET.shareholding}!H4`, source: cfSource,
        });
      } else if (outEoy + 0.005 < dirEoy) {
        rv({
          id: "cf-us-holder-base", level: "warn", category: "carry-forward",
          message: `Schedule B Part I implies ${outEoy} total shares outstanding (shares ÷ pro rata %), but the direct holders in Part II already hold ${dirEoy}. Outstanding cannot be less than that, so it was NOT written and the percentages fall back to the direct total. Check Part I column (e) and enter the real figure in Shareholding Details H4/J4.`,
          target: `${SHEET.shareholding}!H4`, source: cfSource,
        });
      } else if (Math.abs(outEoy - dirEoy) > 0.005) {
        rv({
          id: "cf-us-holder-base", level: "info", category: "carry-forward", applied: true,
          message: `Total shares outstanding is taken as ${outEoy}, derived from Schedule B Part I (shares ÷ pro rata % in column (e)). The direct holders in Part II hold ${dirEoy} of them, so ${r2(outEoy - dirEoy)} share(s) are held by someone Part II does not list. Every % Ownership cell divides by ${outEoy}; override it in Shareholding Details H4/J4 if that is wrong.`,
          target: `${SHEET.shareholding}!H4`, source: cfSource,
        });
      }
    } else if (cf && holderRows.length) {
      /* No Part I to write, so rows 7-14 still show the template's built-in
         copy of the FIRST direct holder. That is right only when the direct
         holder is itself the U.S. shareholder — often it is a foreign trust or
         holding company, and the block then claims 100% U.S. ownership. */
      rv({
        id: "cf-us-holders-absent", level: "warn", category: "carry-forward",
        message: `No Schedule B Part I (U.S. shareholders) could be read from ${cfSource}, so the U.S. Shareholders block still shows the template's built-in copy of the first DIRECT shareholder — "${holderRows[0].name}". That is only correct if that holder is itself a U.S. person. Check it, and type the real U.S. shareholders into rows 7-14 if not.`,
        target: `${SHEET.shareholding}!B7`, source: cfSource,
      });
    }
  }
  /* The face states the filer's voting percentage; Schedule B states the
     holders and their shares. When the two disagree, one of them is wrong,
     and the 8992 pro-rata share is computed from the Schedule B figure — a
     filer shown as 100% on page 1 and 50% on page 2 has been carried, silently,
     by both the tool and a hand-prepared work paper. */
  if (cf?.pctVoting !== undefined && holderRows.length >= 2 && cf.holderName) {
    const total = holderRows.reduce((n, h) => n + (Number(h.eoy) || 0), 0);
    const mine = holderRows.find((h) => entitySimilarity(h.name, cf.holderName!) >= 0.5);
    if (total > 0 && mine) {
      const pct = Math.round((Number(mine.eoy) || 0) / total * 10000) / 100;
      if (Math.abs(pct - cf.pctVoting) > 1) {
        rv({
          id: "cf-ownership-mismatch", level: "warn", category: "consistency",
          message: `${cfSource} states on its face that the filer owned ${cf.pctVoting}% of the voting stock, but its Schedule B gives ${mine.name} ${mine.eoy} of ${total} shares = ${pct}%. Basic Information carries ${cf.pctVoting}%; Shareholding Details and the Form 8992 pro-rata share use ${pct}%. One of the two is wrong on the prior filing — resolve it before generating.`,
          target: `${SHEET.basic}!C34`, source: cfSource,
        });
      }
    }
  }

  /* Schedule A states the shares issued and outstanding for the corporation as
     a whole. The shareholder rows must add up to it. When they do not, a holder
     was dropped during extraction — which silently inflates everyone else's
     ownership percentage (one holder read out of two turns 50% into 100%).
     The tool can see this contradiction itself, so it must not wait to be told. */
  if (cf?.shares && holderRows.length) {
    const sumBoy = holderRows.reduce((n, h) => n + (Number(h.boy) || 0), 0);
    const sumEoy = holderRows.reduce((n, h) => n + (Number(h.eoy) || 0), 0);
    const tol = 0.01;
    const offBoy = Math.abs(sumBoy - cf.shares.boy) > tol;
    const offEoy = Math.abs(sumEoy - cf.shares.eoy) > tol;
    if (offBoy || offEoy) {
      const shortfall = cf.shares.eoy - sumEoy;
      rv({
        id: "cf-share-reconcile", level: "block", category: "carry-forward",
        message: `Shareholder rows do not reconcile to Schedule A. Schedule A reports ${cf.shares.boy} share(s) at the beginning and ${cf.shares.eoy} at the end of the year; the ${holderRows.length} shareholder row(s) total ${sumBoy} and ${sumEoy}.${
          shortfall > 0
            ? ` ${shortfall} share(s) are unaccounted for — a holder is probably missing from Schedule B, which would overstate the remaining holders' ownership (each row would compute against a total of ${sumEoy} instead of ${cf.shares.eoy}).`
            : ""
        } Add the missing holder(s) in the Shareholders tab before generating.`,
        target: `${SHEET.shareholding}!H19`, source: cfSource,
      });
    }
  }
  /* The form's column width truncates long names mid-word. Never guessed. */
  const truncated = (cf?.holders || []).filter((h) => h.truncated);
  if (truncated.length) {
    rv({
      id: "cf-holder-truncated", level: "warn", category: "carry-forward",
      message: `The prior return prints ${truncated.length === 1 ? "a shareholder name" : "shareholder names"} cut off at the column edge: ${
        truncated.map((h) => `"${h.name}"`).join(", ")
      }. The value was carried across exactly as printed — complete ${truncated.length === 1 ? "it" : "them"} in the Shareholders tab.`,
      target: `${SHEET.shareholding}!B19`, source: cfSource,
    });
  }
  if (holderRows.length && ent.shareholders?.length) {
    rv({
      id: "cf-holders", level: "info", category: "carry-forward", applied: true,
      message: `Shareholding rows carry ${holderRows.length} direct shareholder(s): ${holderRows.map((h) => `${h.name} (${h.boy}→${h.eoy})`).join(", ")}. Edit them in the Shareholders tab.`,
      target: `${SHEET.shareholding}!B19`,
    });
  }
  if (cf) {
    const cmp: [string, string, number | undefined, number | null][] = [
      ["cash", "G10", cf.priorClosingUSD.cash?.value, numeric(String(ent.lines["BS:10"]?.boy ?? ""))],
      ["trade receivables", "G11", cf.priorClosingUSD.ar?.value, numeric(String(ent.lines["BS:11"]?.boy ?? ""))],
      ["other current assets", "G15", cf.priorClosingUSD.oca?.value, null],
      ["total assets", "G42", cf.priorClosingUSD.totalAssets?.value, null],
      ["accounts payable", "G46", cf.priorClosingUSD.ap?.value, numeric(String(ent.lines["BS:46"]?.boy ?? ""))],
      ["other current liabilities", "G47", cf.priorClosingUSD.ocl?.value, null],
      ["retained earnings", "G61", cf.priorClosingUSD.re?.value, numeric(String(ent.lines["BS:61"]?.boy ?? ""))],
    ];
    for (const [label, gcell, filed, boyLocal] of cmp) {
      if (filed === undefined) continue;
      const translated = boyLocal !== null && pyRate ? Math.round(boyLocal / pyRate) : null;
      const ties = translated !== null && Math.abs(translated - filed) <= 1;
      rv({
        id: `cf-boy-${gcell}`, level: ties ? "info" : "warn", category: "carry-forward",
        message: `Beginning-of-year ${label}: prior year filed US$${filed.toLocaleString()};` +
          (translated !== null
            ? ` the template will compute ${translated.toLocaleString()} from the local balance at the ${ent.profile.pyEnd || "12/31"} spot rate — ${ties ? "ties" : "DOES NOT tie; reconcile with the accountant"}.`
            : ` compare against the template's computed ${gcell} after opening the workbook.`),
        target: `${SHEET.bs}!${gcell}`, source: cfSource,
      });
    }
    /* One review item where the prior return's line 15/16 split differs from
       this year's. Carried AS FILED by policy, so the two years can present
       the same money on different lines — the preparer decides, not the tool. */
    {
      const filedAp = cf.priorClosingUSD.ap?.value;
      const filedOcl = cf.priorClosingUSD.ocl?.value;
      const cyAp = numeric(String(ent.lines["BS:46"]?.eoy ?? ""));
      const cyOcl = numeric(String(ent.lines["BS:47"]?.eoy ?? ""));
      const priorAllOnOne = (!filedAp || filedAp === 0) && !!filedOcl;
      const currentSplit = !!cyAp && !!cyOcl;
      if (priorAllOnOne && currentSplit) {
        rv({
          id: "cf-boy-grouping", level: "warn", category: "carry-forward",
          message: `Beginning-of-year liabilities were carried exactly as filed: the prior-year return reports nothing on line 15 and US$${filedOcl!.toLocaleString()} on line 16, while the current year splits payables across lines 15 and 16. The two columns therefore present the same money on different lines. Re-split the opening column if you want the years shown consistently — the amounts are unchanged either way.`,
          target: `${SHEET.bs}!D46`, source: cfSource,
        });
      }
    }
    /* ---- the rate the prior filing used vs the table ----
       Decision (owner): the table stands; the preparer is told, line by
       line, what following it costs. KYD is pegged at 0.833 and the prior
       return says so on Schedule H; the Treasury table says 0.82. At 0.82
       every opening balance is ~1.6% lower in functional currency than the
       figure the prior filing carried, and the column no longer ties to
       last year's — while tying exactly in USD. */
    if (cf.priorRate && pyRate && Math.abs(pyRate - cf.priorRate.value) / cf.priorRate.value > 0.005) {
      const stated = cf.priorRate.value;
      const fx = rateEffectLines(cf.priorClosingUSD, pyRate, stated);
      const cy = cyRate && Math.abs(cyRate - stated) / stated > 0.005 ? ` The current year-end rate ${cyRate} differs from it in the same way.` : "";
      rv({
        id: "fx-prior-rate", level: "warn", category: "fx",
        message: `The prior filing states an exchange rate of ${stated} (${cfSource} p.${cf.priorRate.page}); the rate table gives ${pyRate} for the prior year end. One rate is used for the prior year end: the opening column is translated at the prior-year rate in Basic Information C61 (${pyRate}), the same cell the workbook's USD columns divide by. At the table rate instead of the filed rate: ${
          fx.lines.map((l) => `${l.label} ${l.atPrior.toLocaleString()} → ${l.atTable.toLocaleString()} (${l.diff > 0 ? "+" : ""}${l.diff.toLocaleString()})`).join("; ")
        }; net current assets ${fx.net.atPrior.toLocaleString()} → ${fx.net.atTable.toLocaleString()} (${fx.net.diff > 0 ? "+" : ""}${fx.net.diff.toLocaleString()}). The column ties to the prior filing in USD either way; at the table rate, functional-currency opening figures move by that amount.${cy} To continue the prior filing's rate instead, enter ${stated} in C61 and re-process — the opening column always follows C61.`,
        target: `${SHEET.basic}!C61`, source: cfSource, suggestedValue: stated,
      });
    }

    /* ---- retained-earnings roll-forward ----
       Within the books, opening + net income − distributions = closing. The
       prior filing's closing retained earnings is a different number from the
       books' opening whenever the accountant re-stated, the rate moved, or
       last year's return was prepared from something other than these books.
       That difference is real, it is usually unexplained, and until now it
       was visible only to a preparer who built a roll-forward by hand. The
       tab lays it out; the exception names the residual; nothing is plugged. */
    {
      const closing = numeric(String(ent.lines["BS:61"]?.eoy ?? ""));
      const filedUsd = cf.priorClosingUSD.re?.value;
      if (closing !== null && filedUsd !== undefined) {
        /* The same rate Schedule F's opening column was built with — see
           openingRateFor. Two derivations of one figure is the defect. */
        const opening = ent.openingRate
          ?? openingRateFor(ent.profile.currency, pyRate, cf.priorRate?.value);
        const rateUsed = opening?.rate ?? null;
        const priorFc = rateUsed ? r2(filedUsd * rateUsed) : null;
        const ni = bookNetIncome(ent.lines);
        const distributions = ent.dividends.length
          ? r2(ent.dividends.reduce((n, d) => n + (Number(d.amountFunctional) || 0), 0))
          : r2(divPlanned ?? 0);
        /* The books themselves, before any exchange rate: last year's closing
           column + this year's result − this year's distribution must equal
           this year's closing column. When it does not, the difference is in
           the client's own figures, and calling it translation would hide it. */
        /* Only an opening figure the statements print themselves (their
           prior-year column) is "the books": one carried from last year's
           return is exactly what the translation comparison below is for. */
        const boyRows = (ent.contributions["BS:61"] || []).filter((c) => c.field === "boy");
        const booksBoy = boyRows.length ? r2(boyRows.reduce((n, c) => n + c.value, 0)) : null;
        const localGap = booksBoy !== null && ni !== null ? r2(closing - (booksBoy + ni - distributions)) : null;
        const booksBroken = localGap !== null && Math.abs(localGap) > Math.max(1, Math.abs(closing) * 0.001);
        if (booksBroken && ni !== null && booksBoy !== null) {
          rv({
            id: "re-books-not-rolling", level: "warn", category: "consistency",
            message: `The client's own retained earnings do not add up, before any exchange rate: opening ${booksBoy.toLocaleString()} + net income ${ni.toLocaleString()} − distributions ${distributions.toLocaleString()} = ${r2(booksBoy + ni - distributions).toLocaleString()}, but the balance sheet closes with ${closing.toLocaleString()} (${ent.profile.currency || "functional currency"}) — ${localGap!.toLocaleString()} apart. Ask the client for corrected statements; Schedule F carries the balance sheet as printed and nothing has been adjusted.`,
            target: `${SHEET.bs}!F61`, source: cfSource,
          });
        }
        if (priorFc !== null && ni !== null) {
          w({
            sheet: SHEET.re, ref: "F10", value: priorFc, reviewId: "re-rollforward",
            source: `${cfSource} · Schedule F line 22 US$${filedUsd.toLocaleString()} at ${rateUsed} — ${opening?.why ?? "no stated rate"}`,
          });
          const booksOpening = r2(closing - ni + distributions);
          const residual = r2(booksOpening - priorFc);
          const ties = Math.abs(residual) <= 1;
          /* One rate for everything (a US-dollar corporation, or three equal
             rates) cannot produce a translation difference: the residual is
             an equity movement the books made — owner draws, a prior-period
             adjustment, capital moved into retained earnings. Offering it as
             "translation" put a -9,588 currency adjustment on a USD company. */
          const rateVals = [ent.fx?.avgRate, ent.fx?.cyRate, ent.fx?.pyRate].map((v) => Number(v)).filter((v) => isFinite(v) && v > 0);
          const oneRate = String(ent.profile.currency || "").toUpperCase() === "USD"
            || (rateVals.length === 3 && rateVals.every((v) => Math.abs(v - rateVals[0]) < 1e-9));
          const residualCell = oneRate ? "F25" : "F24";
          rv({
            id: "re-rollforward", level: ties ? "info" : "warn", category: "consistency", applied: true,
            message: ties
              ? `Retained earnings roll forward: prior filing ${priorFc.toLocaleString()} + net income ${ni.toLocaleString()} − distributions ${distributions.toLocaleString()} = ${closing.toLocaleString()} per Schedule F. Ties.`
              : `Retained earnings do not roll forward. Prior filing closed at US$${filedUsd.toLocaleString()} = ${priorFc.toLocaleString()} at ${rateUsed}; the books' closing ${closing.toLocaleString()} less net income ${ni.toLocaleString()} plus distributions ${distributions.toLocaleString()} implies an opening of ${booksOpening.toLocaleString()}. Difference ${residual.toLocaleString()} — ${oneRate ? "not a rate difference (one rate applies throughout), so a movement in the books themselves: owner draws, a prior-period adjustment, or capital moved into retained earnings" : "a re-statement, a rate difference, or a prior return prepared from other figures"}. Nothing has been plugged: confirm the cause and enter it on the Retained Earnings tab (${residualCell}) so the tab ties to Schedule F.`,
            target: `${SHEET.re}!${residualCell}`, source: cfSource, suggestedValue: residual,
          });
          /* The residual, offered as a single controlled action.
             Deliberately its OWN item: "re-rollforward" already owns the F10
             write, and resubmitting against that id would overwrite the prior
             filing's opening balance instead of booking an adjustment. This
             one carries no write until the preparer signs one off, so nothing
             is ever plugged on its own. */
          if (!ties && !booksBroken && oneRate) {
            rv({
              id: "re-equity-movement", level: "warn", category: "consistency",
              message: `Retained earnings moved by ${residual.toLocaleString()} beyond this year's net income and distributions. With one exchange rate throughout this is not currency translation — it is a movement in the client's own equity: owner draws or contributions, a prior-period adjustment, or capital reclassified into retained earnings. If it was a distribution, enter it on the Dividends tab instead (it then reaches Schedules J, M and R). Otherwise book it as an other adjustment on the Retained Earnings tab (F25): saving the figure signs it off in your name with its own audit line. Leave it alone to keep the difference visible.`,
              target: `${SHEET.re}!F25`, source: cfSource, suggestedValue: residual,
            });
          }
          if (!ties && !booksBroken && !oneRate) {
            rv({
              id: "re-translation-adjustment", level: "warn", category: "consistency",
              message: `Book the ${residual.toLocaleString()} difference as a translation adjustment on the Retained Earnings tab (F24)? Saving the figure signs it off in your name, writes it with its own audit line, and makes the tab tie to Schedule F. Do this only if the difference IS translation — a re-statement or a prior return built from other figures needs the cause fixed, not a plug. Leave it alone to keep the difference visible.`,
              target: `${SHEET.re}!F24`, source: cfSource, suggestedValue: residual,
            });
          }
        }
      }
      /* Schedule F's opening retained earnings (converted from the filed USD)
         and Schedule J's opening E&P (carried in functional currency) are
         two readings of the same prior-year figure. When they differ, the
         difference is exactly the rate. */
      const boyRe = numeric(String(ent.lines["BS:61"]?.boy ?? ""));
      if (boyRe !== null && cf.openingEP && Math.abs(boyRe - cf.openingEP.value) > 1) {
        const impliedRate = cf.priorClosingUSD.re?.value && cf.openingEP.value ? Math.round(cf.priorClosingUSD.re.value / cf.openingEP.value * 1e6) / 1e6 : null;
        /* Book retained earnings (Schedule F) and earnings and profits
           (Schedule J) are different measures: E&P follows tax rules and the
           two differ whenever there are tax adjustments. The gap is shown so
           it can be checked, not called an error. */
        rv({
          id: "re-opening-mismatch", level: "info", category: "consistency",
          message: `Schedule F opens book retained earnings at ${boyRe.toLocaleString()} (the filed US$${(cf.priorClosingUSD.re?.value ?? 0).toLocaleString()} at the ${ent.profile.pyEnd || "prior year-end"} rate ${pyRate ?? "—"}); Schedule J line 1a opens earnings and profits at ${cf.openingEP.value.toLocaleString()} as filed — ${r2(boyRe - cf.openingEP.value).toLocaleString()} apart. E&P follows tax rules, so the two usually differ; confirm the difference is the prior year's tax adjustments.`,
          target: `${SHEET.bs}!D61`, source: cfSource,
        });
      }
    }
    if (!cf.booksPerson) {
      rv({
        id: "cf-books-blank", level: "warn", category: "source-gap",
        message: "Item 2d (person with custody of the books and records) was blank on the prior-year Form 5471, so Basic Information B21-B23 could not be carried forward. Enter the custodian's name and address before filing — the field is required.",
        target: `${SHEET.basic}!B21`, source: cfSource,
      });
    }
    if (cf.referenceIds.length) {
      rv({
        id: "cf-refid", level: "info", category: "carry-forward",
        message: `Reference ID ${cf.referenceIds[0]} carried to Basic Information B5 — it must be identical on every year's filing.`,
        source: cfSource, suggestedValue: cf.referenceIds[0],
      });
    }
    if (cf.referenceIds.length > 1) {
      /* Two reference IDs on ONE Form 5471 block is an inconsistency to fix.
         Two of them because the return carries two Form 5471s is not: it is a
         second foreign corporation, and it gets its own entity. Saying "the
         Form 5472 names the entity differently" sent the preparer looking for
         a form that was not in the file while the second CFC went unfiled. */
      const blocks = Math.max(0, ...Object.values(ent.docClasses || {})
        .map((c) => (c.blocks5471 || []).length));
      rv(blocks > 1 ? {
        id: "cf-refid-multi", level: "info", category: "carry-forward",
        message: `${cfSource} covers ${blocks} foreign corporations, with reference IDs ${cf.referenceIds.join(", ")}. This entity carries out ${cf.referenceIds[0]}; the others are prepared as their own entities.`,
        source: cfSource,
      } : {
        id: "cf-refid-mismatch", level: "warn", category: "consistency",
        message: `Two different reference IDs appear on one Form 5471 in the prior-year return (${cf.referenceIds.join(" vs ")}). A reference ID must be identical on every year's filing for the same corporation — check which one belongs to this entity before filing.`,
        source: cfSource,
      });
    }
    if (cf.priorTaxAccruedFunctional) {
      rv({
        id: "cf-e1-redetermination", level: "warn", category: "carry-forward",
        message: `The prior year accrued ${ent.profile.currency || "local"} ${cf.priorTaxAccruedFunctional.value.toLocaleString()} of foreign tax (prior Sch E). If the amount finally assessed or paid differed from that accrual, a Schedule E-1 foreign tax redetermination is needed — compare against the tax payable in the current balance sheet.`,
        target: `${SHEET.schE}!E48`, source: cfSource,
      });
    }
  }

  /* ---- Schedule R with nothing to report ----
     The prior return filed the explicit row "NONE / 12/31/2023 / 0 / 0". When
     this year's statements show no distribution either, the work paper
     carries the same row, dated this year end, rather than an empty schedule
     that reads as "not considered". */
  const divAmount = divPlanned;
  /* A dividend seen only as a line of the balance sheet's equity proves a
     distribution was DECLARED, not that it was paid in the year. It goes on
     the Dividends tab; Schedule R and Schedule J line 9 stay as the prior
     filing had them until the preparer confirms the payment. */
  const fromEqLine = !!divAmount && !equity?.dividendsCY && !ato.frankedDividendsPaid && !!eqDiv && eqDiv.addsToEquity;
  if (fromEqLine && eqDiv) {
    rv({
      id: "dividend-from-equity-line", level: "warn", category: "consistency", applied: true,
      message: `The balance sheet prints "${eqDiv.label}" ${eqDiv.amount.toLocaleString()} inside equity for this year. It is recorded on the Dividends tab. Schedule R, Schedule J line 9 and Schedule M are left as the prior filing had them: a line in the balance sheet shows a dividend was declared, not that it was paid in the year — enter it there if it was paid. The statement adds it to equity rather than taking it out of retained earnings, so Schedule F line 22 carries it as printed; confirm the dividend and the equity figures with the client.${filerShare(ent) < 1 ? ` The filer holds ${r2(filerShare(ent) * 100)}%, so the filer's share is ${r2(eqDiv.amount * filerShare(ent)).toLocaleString()}.` : ""}`,
      target: `${SHEET.dividends}!C3`,
    });
  } else if (divAmount && eqDiv && !equity?.dividendsCY && !ato.frankedDividendsPaid && eqDiv.opening !== undefined) {
    rv({
      id: "dividend-from-equity-line", level: "warn", category: "consistency", applied: true,
      message: `The balance sheet's "${eqDiv.label}" account closes at ${(eqDiv.closing ?? 0).toLocaleString()} and opened the year at ${eqDiv.opening.toLocaleString()} (${eqDiv.openingBasis}), so this year's distribution is the movement, ${eqDiv.amount.toLocaleString()} — the rest was paid in earlier years and is still sitting in the account because the books have not closed it into retained earnings. It is recorded as the year's distribution (Dividends tab, Schedule R, Schedule J line 9). Confirm the payment dates and amounts with the client${eqDiv.openingBasis?.startsWith("the retained") ? ", and check the opening balance against last year's balance sheet: a figure derived from a return rounded to whole dollars can be a few units out" : ""}.`,
      target: `${SHEET.dividends}!C3`,
    });
  } else if (divAmount && eqDiv && !equity?.dividendsCY && !ato.frankedDividendsPaid) {
    rv({
      id: "dividend-from-equity-line", level: "warn", category: "consistency", applied: true,
      message: `The balance sheet prints "${eqDiv.label}" (${eqDiv.amount.toLocaleString()}) as a reduction of equity for this year. It is recorded as the year's distribution (Dividends tab, Schedule R, Schedule J line 9). Confirm the payment date and amount with the client.${filerShare(ent) < 1 ? ` The filer holds ${r2(filerShare(ent) * 100)}%, so the filer's share is ${r2(eqDiv.amount * filerShare(ent)).toLocaleString()}; Schedule R shows the whole distribution — reduce it if the return reports the filer's share only.` : ""}`,
      target: `${SHEET.dividends}!C3`,
    });
  }
  if ((!divAmount || fromEqLine) && cf?.schRNone && (fromEqLine || !ent.dividends.length)) {
    const cyEnd = ent.profile.cyEnd?.trim() || (caseYears.cy ? `12/31/${String(caseYears.cy).slice(2)}` : "");
    const src = `${cfSource} · Schedule R p.${cf.schRNone.page}`;
    w({ sheet: SHEET.schR, ref: "B10", value: "NONE", source: src, reviewId: "sch-r-none" });
    if (cyEnd) w({ sheet: SHEET.schR, ref: "E10", value: cyEnd, source: src });
    w({ sheet: SHEET.schR, ref: "G10", value: 0, source: src });
    w({ sheet: SHEET.schR, ref: "I10", value: 0, source: src });
    rv({
      id: "sch-r-none", level: "info", category: "carry-forward", applied: true,
      message: `Schedule R carries the explicit NONE row (${cyEnd || "this year end"} / 0 / 0), as the prior return filed it${cf.schRNone.date ? ` (${cf.schRNone.date})` : ""}: no distribution was found in the statements. If a dividend was paid this year, add it on the Dividends tab and this row is replaced.`,
      target: `${SHEET.schR}!B10`, source: src,
    });
  }

  /* ---- dividend: one record drives four schedules ---- */
  if (divAmount && caseYears.cy) {
    // An undated dividend defaults to the entity's own period end — only a
    // profile with no period at all falls back to the calendar year end.
    const fallbackDate = ent.profile.cyEnd?.trim() || `12/31/${String(caseYears.cy).slice(2)}`;
    const date = ato.dividendDate || fallbackDate;
    let usdPerUnit: number | null = null;
    let rateSource: DividendRec["rateSource"] = "none";
    const iso = toIsoDate(date, caseYears.cy);
    if (iso && ent.profile.currency) {
      try {
        const { result } = await fetchLiveRate(ent.profile.currency, ["frankfurter"], iso);
        if (result.ok && result.value.rate > 0) {
          usdPerUnit = Math.round((1 / result.value.rate) * 10000) / 10000;
          rateSource = "frankfurter";
        }
      } catch { /* offline — fall back to the year-end spot */ }
    }
    if (usdPerUnit === null && cyRate) {
      usdPerUnit = Math.round((1 / cyRate) * 10000) / 10000;
      rateSource = "eoy-fallback";
    }
    dividends.push({ date, amountFunctional: divAmount, usdPerUnit, rateSource });

    w({ sheet: SHEET.dividends, ref: "B3", value: date, source: "equity movement / AU return" });
    w({ sheet: SHEET.dividends, ref: "C3", value: divAmount, source: "equity movement / AU return" });
    if (usdPerUnit !== null) w({ sheet: SHEET.dividends, ref: "D3", value: usdPerUnit, dp: 4, reviewId: "dividend-rate", source: rateSource === "frankfurter" ? `ECB reference rate ${iso}` : "1 ÷ year-end spot (fallback)" });
    rv({
      id: "dividend-rate", level: rateSource === "frankfurter" ? "info" : "warn", category: "fx", applied: true,
      message: rateSource === "frankfurter"
        ? `Dividend of ${divAmount.toLocaleString()} paid ${date} translated at the ECB reference rate for that date (${usdPerUnit}).`
        : `Dividend of ${divAmount.toLocaleString()} paid ${date} was translated at the ${ent.profile.cyEnd || "year-end"} spot rate (${usdPerUnit ?? "n/a"}) because no payment-date rate was reachable — replace Dividends!D3 with the ${date} spot rate.`,
      target: `${SHEET.dividends}!D3`,
    });

    if (!fromEqLine) {
    const parts = distributionSplit(ent, divAmount);
    if (parts) {
      parts.forEach((p, i) => {
        const row = 10 + i;
        w({ sheet: SHEET.schR, ref: `B${row}`, value: `Cash dividend distribution to ${p.name}`, source: "equity movement · register of direct holders" });
        w({ sheet: SHEET.schR, ref: `E${row}`, value: date, source: "equity movement" });
        w({ sheet: SHEET.schR, ref: `G${row}`, value: p.amount, source: `${r2(p.share * 100)}% of ${divAmount.toLocaleString()} by shares held`, reviewId: "sch-r-split" });
        w({ sheet: SHEET.schR, ref: `I${row}`, value: p.amount, source: "distribution of E&P", reviewId: "sch-r-split" });
      });
      rv({
        id: "sch-r-split", level: "info", category: "consistency", applied: true,
        message: `Schedule R lists the ${divAmount.toLocaleString()} distribution by shareholder, split by the shares each holds directly: ${parts.map((p) => `${p.name} ${p.amount.toLocaleString()} (${r2(p.share * 100)}%)`).join(", ")}. Schedule J line 9 carries the whole distribution.`,
        target: `${SHEET.schR}!G10`,
      });
    } else {
    w({ sheet: SHEET.schR, ref: "B10", value: `Cash dividend distribution to ${cf?.holderName || "the US parent"}`, source: "equity movement / AU return" });
    w({ sheet: SHEET.schR, ref: "E10", value: date, source: "AU return dividend schedule" });
    w({ sheet: SHEET.schR, ref: "G10", value: divAmount, source: "equity movement / AU return" });
    w({ sheet: SHEET.schR, ref: "I10", value: divAmount, source: "distribution of E&P" });
    }

    w({
      sheet: SHEET.schJ, ref: "F33", value: -divAmount, reviewId: "dividend-schj-sign",
      source: "Sch J line 9 actual distributions",
    });
    rv({
      id: "dividend-schj-sign", level: "info", category: "carry-forward", applied: true,
      message: `Schedule J line 9 (actual distributions) entered as −${divAmount.toLocaleString()}: the template's closing balance is a plain SUM, so distributions must carry a minus sign.`,
      target: `${SHEET.schJ}!F33`,
    });
    }

    if (avgRate && !fromEqLine) {
      /* Schedule M reports what passed between the corporation and the
         FILER, so a dividend paid to every shareholder enters at the filer's
         own share of it (40% of 70,000 for a 40% holder). An unknown or 100%
         holding keeps the whole dividend, as before. */
      const share = dividendShareOfFiler(ent);
      const ownPct = r2(share * 100);
      w({
        sheet: SHEET.schM, ref: "E32", value: Math.round((divAmount * share) / avgRate),
        labelKey: { col: "B", contains: "dividends paid", excludes: "hybrid" },
        source: "dividend at the year-average rate", reviewId: "dividend-schm",
      });
      rv({
        id: "dividend-schm", level: "warn", category: "related-party", applied: true,
        message: `Schedule M dividends-paid entered in column (b) at the year-average rate (US$${Math.round((divAmount * share) / avgRate).toLocaleString()}${share < 1 ? `, the filer's ${ownPct}% share of the ${divAmount.toLocaleString()} paid` : ""}). Column (b) is an inference — the recipient is the filer itself; Schedule M instructions use the average rate, the 18-Dec spot alternative would be US$${dividends[0].usdPerUnit ? Math.round(divAmount * dividends[0].usdPerUnit).toLocaleString() : "n/a"}. Confirm both choices.`,
        target: `${SHEET.schM}!dividends-paid row`,
      });
    }
  }

  /* ---- the owner's compensation → Schedule M line 6 ----
     The questionnaire states what the filer was paid; a salary schedule
     states the same thing month by month; and a P&L wage caption equals it
     to the cent. That equality is the evidence: it ties a booked deduction to
     a named related person, which is a Schedule M transaction.

     It goes on LINE 6, the row the preparer's own work paper uses. Read
     strictly, line 6 is the compensation the corporation RECEIVED and line 19
     what it PAID, so the figure sits on the row the reviewer expects with a
     note recording that reading — the note is the honest part, and the row is
     the preparer's call, not the tool's.

     The column names the counterparty: (b) for the US person filing the
     return, (e) for a 10% US shareholder who is someone else. */
  {
    const facts: { amount: number; source: string; who: string | null; booked?: { label: string; docName: string } }[] = [];
    if (questionnaire?.wagesReceived !== undefined && questionnaire.wagesReceived > 0) {
      facts.push({ amount: questionnaire.wagesReceived, source: `${questionnaire.fileName} · "Wages you received from the company"`, who: questionnaire.taxpayerName || null });
    }
    if (salary) {
      const total = salary.statedTotal ?? salary.sumOfLines;
      if (total > 0 && !facts.some((f) => Math.abs(f.amount - total) <= 0.01)) {
        facts.push({ amount: total, source: `${salary.fileName} · salary schedule${salary.person ? ` for ${salary.person}` : ""}`, who: salary.person });
      }
    }
    /* Neither document supplied. The books still say a wage was paid, and
       when one person owns the corporation outright there is only one person
       it can have been paid to — which is a Schedule M transaction whether or
       not anybody sent us a questionnaire. The SHORI 2024 run booked 82,000
       on Schedule C line 11 for a 100% owner and shipped Schedule M blank.
       Deliberately narrow: a minority filer, or a corporation with more than
       one shareholder, gets nothing, because then the counterparty is a
       guess rather than an inference. */
    if (!facts.length) {
      const wages = (ent.contributions["IS:26"] || []).filter((c) => c.field === "amount");
      const pct = Number(ent.ownership.ownEnd || ent.ownership.ownStart || 0);
      if (wages.length && pct >= 50 && (ent.shareholders || []).length <= 1) {
        const amount = wages.reduce((n, c) => r2add(n, c.value), 0);
        if (amount > 0) {
          facts.push({
            amount,
            source: `Schedule C line 11 "${wages[0].label}" — inferred from the books, no questionnaire supplied`,
            who: cf?.holderName || (ent.shareholders || [])[0]?.name || null,
            booked: { label: wages[0].label, docName: wages[0].docName },
          });
        }
      }
    }
    /* A Schedule M transaction needs a counterparty. Compensation with no
       related person anywhere in the case is just a payroll cost — unless the
       books themselves supplied the fact, where sole ownership IS the
       counterparty and there may be no name on file to quote. */
    const relatedParty = questionnaire?.taxpayerName || cf?.holderName || ledger?.counterparty || salary?.person || null;
    /* Nothing could be inferred, but a wage WAS booked. Shipping Schedule M
       blank without a word is how a compensation transaction goes unreported:
       the reviewer sees an empty schedule and no reason for it. The tool still
       refuses to guess the counterparty — with more than one shareholder there
       is more than one person the wage can have been paid to — so it names the
       amount, converts it, and says what is missing. */
    if (!facts.length && avgRate) {
      const wages = (ent.contributions["IS:26"] || []).filter((c) => c.field === "amount");
      const amount = wages.reduce((n, c) => r2add(n, c.value), 0);
      const holders = (ent.shareholders || []).length;
      if (wages.length && amount > 0) {
        rv({
          id: "schm-compensation-not-inferred", level: "warn", category: "related-party",
          message: `${amount.toLocaleString()} ${ent.profile.currency || ""} of compensation is booked on Schedule C line 11 ("${wages[0].label}"), but Schedule M was left blank: ${
            holders > 1
              ? `the corporation has ${holders} shareholders on file, so who the wage was paid to is a guess, not an inference`
              : "no questionnaire, salary schedule or related person on file names who it was paid to"
          }. If it went to a related person, enter US$${Math.round(amount / avgRate).toLocaleString()} on Schedule M (line 19 for compensation the corporation PAID, line 6 if your work paper uses that row) in the column for that person. If it went to unrelated staff, Schedule M is correctly blank.`,
          target: `${SHEET.schM}!E28`, source: wages[0].docName, suggestedValue: Math.round(amount / avgRate),
        });
      }
    }
    if (facts.length && avgRate && (relatedParty || facts.some((f) => f.booked))) {
      const booked = Object.entries(ent.contributions).flatMap(([target, list]) => list.map((c) => ({ target, ...c })));
      const usedCols = new Set<string>();
      for (const fact of facts) {
        /* The inferred fact IS the booked line, so re-matching it against the
           books would only be circular. */
        const hit = fact.booked
          ? { label: fact.booked.label }
          : booked.find((c) => /^IS:/.test(c.target) && Math.abs(c.value - fact.amount) <= 0.01);
        if (!hit) {
          rv({
            id: `schm-compensation-unmatched-${r2(fact.amount)}`, level: "warn", category: "related-party",
            message: `${fact.source} states ${fact.amount.toLocaleString()} paid to ${fact.who || "the related person"}, but no P&L caption was booked at that amount, so Schedule M was NOT pre-filled. If the wages are inside a larger payroll caption, enter the compensation on Schedule M by hand.`,
            target: `${SHEET.schM}!E15`, source: fact.source, suggestedValue: Math.round(fact.amount / avgRate),
          });
          continue;
        }
        /* Column (b) is the person filing the return; a schedule naming
           someone else is that person's own column (e). Two facts about two
           people therefore both land, in different columns — one fact per
           column, because a second figure in the same column would overwrite
           the first rather than add to it. */
        const isFiler = !fact.who || !cf?.holderName || entitySimilarity(fact.who, cf.holderName) >= 0.5;
        const col = isFiler ? "E" : "K";
        if (usedCols.has(col)) continue;
        usedCols.add(col);
        const ref = `${col}15`;
        const colName = isFiler ? "(b) US person filing this return" : "(e) 10% US shareholder of the foreign corporation";
        const usd = Math.round(fact.amount / avgRate);
        w({
          sheet: SHEET.schM, ref, value: usd,
          labelKey: { col: "B", contains: "compensation received for technical" },
          source: `${fact.source} = P&L "${hit.label}" at the year-average rate`,
          reviewId: fact.booked ? `schm-compensation-inferred-${col}` : `schm-compensation-${col}`,
        });
        const pct = Number(ent.ownership.ownEnd || ent.ownership.ownStart || 0);
        rv({
          id: fact.booked ? `schm-compensation-inferred-${col}` : `schm-compensation-${col}`,
          level: "info", category: "related-party", applied: true,
          message: fact.booked
            ? `Schedule M line 6, column ${colName}: US$${usd.toLocaleString()} — INFERRED. The P&L caption "${hit.label}" (${fact.amount.toLocaleString()} ${ent.profile.currency || ""}) is booked as compensation on Schedule C line 11, and ${fact.who ? `${fact.who} owns` : "the filer owns"} ${pct}% of the corporation with no other shareholder on file, so the filer is the only person it can have been paid to. No questionnaire or salary schedule confirmed that, and nothing was matched to a named person — check it before filing, and clear the cell if the wage went to someone else.`
            : `Schedule M line 6, column ${colName}: US$${usd.toLocaleString()} — ${fact.source} equals the P&L caption "${hit.label}" (${fact.amount.toLocaleString()} ${ent.profile.currency || ""}) to the cent, translated at the year-average rate ${avgRate}. Line 6 is captioned "compensation received"; the corporation PAID this amount, so if you read the caption strictly the figure belongs on line 19. Move it if you disagree.`,
          target: `${SHEET.schM}!${ref}`, source: fact.booked ? fact.booked.docName : fact.source,
        });
      }
    }
  }

  /* ---- loans from shareholders → Schedule M ----
     A balance on Schedule F line 18 is money the shareholders (or companies
     related to them) lent the corporation. Schedule M reports the loan and the
     interest paid on it; neither is on the P&L as such, so the preparer is
     told what to carry and where the figures came from. */
  {
    const loans = ent.lines["BS:52"];
    const boy = numeric(String(loans?.boy ?? "")), eoy = numeric(String(loans?.eoy ?? ""));
    if ((boy && boy !== 0) || (eoy && eoy !== 0)) {
      const labels = [...new Set((ent.contributions["BS:52"] || []).map((c) => c.label))].slice(0, 4);
      rv({
        id: "schm-shareholder-loans", level: "warn", category: "related-party",
        message: `Schedule F line 18 carries loans from shareholders or related persons (${labels.map((l) => `"${l}"`).join(", ") || "line 18"}): ${boy !== null ? `beginning ${boy.toLocaleString()}` : "no opening balance"}, ${eoy !== null ? `end ${eoy.toLocaleString()}` : "no closing balance"} ${ent.profile.currency || ""}. Report the amounts borrowed from the related person on Schedule M, and the interest paid to them (the notes to the accounts usually state the interest on the shareholder loan or current account).`,
        target: `${SHEET.schM}!amounts borrowed row`,
      });
    }
  }

  /* ---- related-party ledger → Schedule M services ---- */
  if (ledger && avgRate && ledger.invoiceCount + ledger.creditNoteCount === 0) {
    rv({
      id: "ledger-unparsed",
      level: "warn", category: "related-party",
      message: `A related-party ledger was read but no functional-currency invoice amounts could be parsed${ledger.ledgerTotalUSD ? ` (its own USD total shows ${ledger.ledgerTotalUSD.toLocaleString()})` : ""} — Schedule M was NOT pre-filled; check the ledger's column layout.`,
    });
  } else if (ledger && avgRate) {
    const services = Math.round(ledger.invoicesFunctional / avgRate);
    w({
      sheet: SHEET.schM, ref: "G15", value: services,
      labelKey: { col: "B", contains: "compensation received for technical" },
      source: `${ledger.counterparty || "related party"} invoices at the year-average rate`, reviewId: "schm-services",
    });
    rv({
      id: "schm-services", level: "info", category: "related-party", applied: true,
      message: `Schedule M line 6 column (c): US$${services.toLocaleString()} — ${ledger.invoiceCount} invoices + ${ledger.creditNoteCount} credit note(s) totalling ${ledger.currency || ""} ${ledger.invoicesFunctional.toLocaleString()} billed to ${ledger.counterparty || "the related party"}, translated at the year-average rate. The ledger's own USD column shows ${ledger.ledgerTotalUSD ? "US$" + Math.round(ledger.ledgerTotalUSD).toLocaleString() : "daily-rate totals"} — the difference is rate presentation only.`,
      target: `${SHEET.schM}!G15`,
    });
    for (const c of ledger.cashPaidUSD) {
      rv({
        // Keyed on the payment itself, not its index: inserting a ledger row
        // must not move every sign-off onto the wrong payment.
        id: `ledger-cash-paid-${c.date}-${c.amount}`,
        level: "warn", category: "related-party",
        message: `"Cash Paid" US$${c.amount.toLocaleString()} on ${c.date} by ${ledger.counterparty || "the related party"} does not appear in the entity's income — reimbursement of costs, or unrecorded income? It has deliberately NOT been mapped anywhere.`,
        source: "Expenses by Contact ledger",
      });
    }
    if (ledger.cashPaidUSD.length) {
      const total = Math.round(ledger.cashPaidUSD.reduce((s, c) => s + c.amount, 0) * 100) / 100;
      rv({
        id: "cash-paid-total", level: "warn", category: "related-party",
        message: `US$${total.toLocaleString()} of direct cash payments (${ledger.cashPaidUSD.length} items) are untraceable to the Australian accounts. Resolve their nature before filing — they may belong on Schedule M line 6 or 14.`,
        source: "Expenses by Contact ledger",
      });
    }
    const pair = ledger.rows.filter((r) => r.reference && ledger.rows.some((o) => o !== r && o.reference === r.reference && /credit note/i.test(o.details) !== /credit note/i.test(r.details)));
    if (pair.length) {
      rv({
        id: "inv-credit-pair", level: "info", category: "related-party",
        message: `Invoice ${pair[0].reference} was cancelled by a credit note the next day — net nil. Ask whether it was re-issued in the following year (income could sit in the wrong period).`,
        source: "Expenses by Contact ledger",
      });
    }
    // Cross-check: the invoices should equal sales + reimbursements exactly.
    const salesContrib = (ent.contributions["IS:7"] || []).filter((c) => /sales/i.test(c.label)).reduce((s, c) => s + c.value, 0);
    const reimbContrib = Object.values(ent.contributions).flat().filter((c) => /reimbursement/i.test(c.label)).reduce((s, c) => s + c.value, 0);
    if (salesContrib || reimbContrib) {
      const expect = salesContrib + reimbContrib;
      const diff = Math.abs(ledger.invoicesFunctional - expect);
      rv({
        id: "ledger-tieout", level: diff <= 2 ? "info" : "warn", category: "consistency",
        message: diff <= 2
          ? `Proof of accuracy: related-party invoices ${ledger.invoicesFunctional.toLocaleString()} = trading sales ${salesContrib.toLocaleString()} + reimbursements ${reimbContrib.toLocaleString()} — every dollar of trading income is a related-party transaction.`
          : `Related-party invoices (${ledger.invoicesFunctional.toLocaleString()}) do not tie to sales + reimbursements (${expect.toLocaleString()}) — investigate the ${diff.toLocaleString()} difference.`,
      });
    }
  } else if (ledger && !avgRate) {
    rv({
      id: "ledger-no-avg-rate",
      level: "warn", category: "related-party",
      message: "A related-party ledger was read but no average exchange rate is set — Schedule M could not be pre-filled.",
    });
  }

  /* ---- targeted ATO pulls: the partial 2024 balance sheet ---- */
  const bsEoyMapped = Object.entries(ent.lines).some(([k, v]) => k.startsWith("BS:") && typeof v.eoy === "number");
  if (!bsEoyMapped && Object.keys(ent.lines).some((k) => k.startsWith("BS:"))) {
    rv({
      id: "bs-eoy-missing", level: "block", category: "source-gap",
      message: `The ${caseYears.cy ?? "current-year"} balance-sheet column is blank in the financial statements — no end-of-year Schedule F figures exist in the documents. Request a 31-Dec-${caseYears.cy ?? "yyyy"} balance sheet or trial balance from the accountant. Known fragments have been pre-filled (${[ato.totalDebt ? "total debt" : "", ato.paygRefundable ? "PAYG receivable" : "", equity?.closingCY === null && equity?.openingCY !== null ? "retained earnings" : ""].filter(Boolean).join(", ") || "none"}) and must not be treated as complete. Acknowledge this exception to generate anyway.`,
      target: `${SHEET.bs}!F10:F62`,
    });
    if (ato.totalDebt) {
      w({ sheet: SHEET.bs, ref: "F54", value: ato.totalDebt, source: "AU return item 8J", reviewId: "ato-total-debt" });
      w({ sheet: SHEET.bs, ref: "B54", value: "Total debt per AU return (Item 8J)", source: "AU return item 8J" });
      rv({
        id: "ato-total-debt", level: "warn", category: "source-gap", applied: true,
        message: `End-of-year "other liabilities" pre-filled with ${ato.totalDebt.toLocaleString()} — the AU return's Total debt (item 8J), the only end-of-year liability figure in the documents. Replace with the detailed balance sheet when it arrives.`,
        target: `${SHEET.bs}!F54`, suggestedValue: ato.totalDebt,
      });
    }
    if (ato.paygRefundable) {
      w({ sheet: SHEET.bs, ref: "F17", value: ato.paygRefundable, source: "AU return calculation statement", reviewId: "ato-payg" });
      w({ sheet: SHEET.bs, ref: "B17", value: "PAYG instalments refundable", source: "AU return calculation statement" });
      rv({
        id: "ato-payg", level: "warn", category: "source-gap", applied: true,
        message: `PAYG instalments of ${ato.paygRefundable.toLocaleString()} were paid in cash but are fully refundable (no tax on a loss year) — pre-filled as an end-of-year receivable, NOT an expense. This is also a Schedule E-1 foreign-tax-redetermination item.`,
        target: `${SHEET.bs}!F17`, suggestedValue: ato.paygRefundable,
      });
    }
    if (equity && equity.openingCY !== null && equity.closingCY === null) {
      const closing = Math.round((equity.openingCY + (equity.profitCY ?? 0) - (equity.dividendsCY ?? 0)) * 100) / 100;
      w({ sheet: SHEET.bs, ref: "F61", value: closing, source: "equity movement (derived)", reviewId: "equity-closing" });
      rv({
        id: "equity-closing", level: "warn", category: "source-gap", applied: true,
        message: `End-of-year retained earnings derived from the equity movement: ${equity.openingCY.toLocaleString()} opening ${equity.profitCY !== null ? (equity.profitCY < 0 ? "− loss " + Math.abs(equity.profitCY).toLocaleString() : "+ profit " + equity.profitCY.toLocaleString()) : ""} − dividends ${(equity.dividendsCY ?? 0).toLocaleString()} = ${closing.toLocaleString()}. The statements print the column blank because it is exactly zero.`,
        target: `${SHEET.bs}!F61`, suggestedValue: closing,
      });
    }
  }

  /* ---- Schedule E ----
     Row 16 documents the year's foreign income tax. A year WITH tax carries the
     amount; a nil-tax year carries an explicit zero rather than a blank row, so
     the return shows the position was considered.

     The nil-tax branch used to be reachable only through an Australian return
     (`ato.taxPayable === 0`) or a derived equity movement. `ato` is `{}` when no
     AU return is present, so `undefined === 0` was false and a Dutch CFC with no
     tax fell through to the tax branch, which then found nothing to write and
     left Schedule E blank — 2Hats 2024 books no tax at all ("Total Taxes –") and
     got no row. Drive the choice off the tax figure itself instead, so it works
     for any country. */
  const taxBooked = ent.lines["IS:62"]?.amount;
  const taxCur = typeof taxBooked === "number" && isFinite(taxBooked) ? taxBooked : null;
  const taxAbs = taxCur ? Math.abs(taxCur) : 0;
  /* "Booked at zero" and "never found" are not the same fact. Both land in the
     branch below, but only the first is evidence of a nil-tax year. A Chilean
     Form 22 states the charge in a box no income-statement caption maps to, so
     the tool saw no tax figure at all — and the row it wrote asserted the
     entity had paid none, on a filing showing 95,791,979 CLP of it. */
  const taxFound = taxCur !== null;
  /* The AU engagement's prior-year facts (E-1 pool closed at zero under the
     high-tax reduction) are only true where that return is in evidence — never
     assert them for another client. */
  const auReturn = ato.taxPayable !== undefined;
  if (taxAbs === 0) {
    const where = ent.profile.countryInc || "the foreign jurisdiction";
    if (ent.profile.legalName) w({ sheet: SHEET.schE, ref: "B16", value: ent.profile.legalName, source: "nil-tax documentation row" });
    if (cf?.referenceIds[0]) w({ sheet: SHEET.schE, ref: "E16", value: cf.referenceIds[0], source: "reference ID" });
    if (ent.profile.countryInc) w({ sheet: SHEET.schE, ref: "G16", value: ent.profile.countryInc, source: "country" });
    if (ent.profile.cyEnd) {
      w({ sheet: SHEET.schE, ref: "I16", value: ent.profile.cyEnd, source: "foreign tax year" });
      w({ sheet: SHEET.schE, ref: "K16", value: ent.profile.cyEnd, source: "US tax year" });
      nonCalendarTaxYear(ent, rv);
    }
    w({
      sheet: SHEET.schE, ref: "O16", value: 0, reviewId: "sch-e-nil",
      source: taxFound
        ? "nil-tax year — no income tax booked"
        : "placeholder — no income tax expense found in the documents",
    });
    if (avgRate) w({ sheet: SHEET.schE, ref: "Q16", value: avgRate, dp: 6, source: "average rate" });
    rv({
      id: "sch-e-nil", level: taxFound ? "info" : "warn", category: "fx", applied: true,
      message: taxFound
        ? `Schedule E carries an explicit zero row: the statements book no income tax for the year, so no ${where} tax was paid or accrued on current-year income — recorded deliberately rather than left blank. Confirm against the tax computation before filing.`
        : `Schedule E carries a ZERO PLACEHOLDER, not a finding: no income tax expense line was mapped from the documents, so the tool cannot tell whether ${where} tax was nil or simply stated somewhere it could not read. A tax return often reports the charge in a box no income-statement caption matches. Enter the tax paid or accrued, or confirm the year was genuinely nil, before filing.`,
      target: `${SHEET.schE}!O16`,
    });
    if (auReturn) {
      w({ sheet: SHEET.schE, ref: "E48", value: 0, source: "prior E-1 closed at zero", reviewId: "sch-e1-opening" });
      rv({
        id: "sch-e1-opening", level: "warn", category: "carry-forward", applied: true,
        message: "Schedule E-1 opening tax pool pre-filled at 0 — the prior-year E-1 closed at zero (taxes removed under the high-tax reduction). Confirm the opening pool is nil.",
        target: `${SHEET.schE}!E48`,
      });
      rv({
        id: "high-tax-2024", level: "info", category: "consistency",
        message: "The prior year excluded all tested income under the GILTI high-tax exception (23.7% effective rate). This year there is a LOSS and NO Australian tax — the high-tax exception is not available and must not be repeated.",
      });
    }
  } else {
    /* ---- Schedule E: current-year income tax flows from the P&L ----
       Row 16 gets the local tax; S16/U16/U21 are template formulas, and
       Schedule I & I-1's D45 reads Sch E&E-1!U21 — the tested-taxes flow
       happens in the template itself, no I-1 writes needed (RAT-003). */
    /* A P&L tax charge establishes expense, not that the tax was paid or
       accrued for Schedule E.  Keep the row as a deliberate zero placeholder
       until a tax return, assessment, or preparer assignment supplies that
       evidence. */
    if (ent.profile.legalName) w({ sheet: SHEET.schE, ref: "B16", value: ent.profile.legalName, source: "unconfirmed tax row" });
    const refId = cf?.referenceIds[0] || ent.profile.refId;
    if (refId) w({ sheet: SHEET.schE, ref: "E16", value: refId, source: "reference ID" });
    if (ent.profile.countryInc) w({ sheet: SHEET.schE, ref: "G16", value: ent.profile.countryInc, source: "country" });
    if (ent.profile.cyEnd) {
      w({ sheet: SHEET.schE, ref: "I16", value: ent.profile.cyEnd, source: "foreign tax year" });
      w({ sheet: SHEET.schE, ref: "K16", value: ent.profile.cyEnd, source: "US tax year" });
      nonCalendarTaxYear(ent, rv);
    }
    /* The year's income tax charge is the tax paid or accrued on the year's
       income: it goes to Schedule E row 16 and, as the Schedule E line 8
       total, to Schedule E-1 line 4 (current E&P). Schedule I-1 reads
       Schedule E through the template's own formulas. Whether it was paid or
       only accrued is the preparer's to confirm. */
    w({ sheet: SHEET.schE, ref: "O16", value: taxAbs, source: "income tax expense — current (Schedule C line 21a)", reviewId: "sch-e-current-tax" });
    w({ sheet: SHEET.schE, ref: "E57", value: taxAbs, source: "Schedule E-1 line 4 — taxes reported on Schedule E line 8" });
    if (avgRate) w({ sheet: SHEET.schE, ref: "Q16", value: avgRate, dp: 6, source: "average rate" });
    rv({
      id: "sch-e-current-tax", level: "warn", category: "consistency", applied: true,
      message: `Schedule E row 16 and Schedule E-1 line 4 carry the ${taxAbs.toLocaleString()} income tax from the P&L; Schedule I-1 picks it up through the template. Confirm it was paid or accrued for the year (a return, an assessment or a payment record) before filing.`,
      target: `${SHEET.schE}!O16`, source: "income statement", suggestedValue: taxAbs,
    });
  }

  /* ---- franking items: recognized and deliberately excluded ---- */
  if (ato.frankingOpening !== undefined || ato.frankingClosing !== undefined || ato.frankingCredit !== undefined) {
    rv({
      id: "franking-excluded", level: "info", category: "process",
      message: `Australian franking (imputation) items were recognized and deliberately excluded — they are not Form 5471 amounts: opening balance ${ato.frankingOpening?.toLocaleString() ?? "n/a"}, closing ${ato.frankingClosing?.toLocaleString() ?? "n/a"}, credit attached to the dividend ${ato.frankingCredit?.toLocaleString() ?? "n/a"} (an imputation credit is not a creditable foreign tax, and a fully franked dividend to a non-resident carries nil withholding).`,
    });
  }
  if (ato.relatedPartyYes) {
    rv({
      id: "ato-item-26", level: "info", category: "related-party",
      message: "The Australian return answers YES to transactions with international related parties — consistent with the Schedule M entries prepared here.",
    });
  }

  /* ---- Schedule M accounts receivable: known BOY only ---- */
  const rpBoy = ent.lines["BS:19"]?.boy;
  if (typeof rpBoy === "number" && rpBoy > 0) {
    rv({
      id: "schm-ar", level: "warn", category: "related-party",
      message: `A related-party receivable of ${rpBoy.toLocaleString()} existed at the START of the year. Schedule M wants the year-end balance, which is unknown (missing 2024 balance sheet) — nothing was written; complete the accounts-receivable line when the balance sheet arrives.`,
      target: `${SHEET.schM}!accounts receivable row`,
    });
  }

  return { list, dividends };
}

/** "12/18/24" or "18/12/2024"-style → ISO, biased to the case year. */
function toIsoDate(mdy: string, year: number): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(mdy.trim());
  if (!m) return null;
  let mm = parseInt(m[1], 10);
  let dd = parseInt(m[2], 10);
  if (mm > 12 && dd <= 12) { const t = mm; mm = dd; dd = t; }
  const yy = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  if (yy !== year || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Round to `dp` places, half away from zero — r2 generalised. */
function roundDp(value: number, dp: number): number {
  const f = Math.pow(10, dp);
  const r = Math.round((Math.abs(value) + Number.EPSILON) * f) / f;
  return value < 0 ? -r : r;
}

/** "SUB-CONTRACTOR" → "Sub-Contractor"; mixed-case captions are left alone. */
export function titleCaseCaption(label: string): string {
  if (label !== label.toUpperCase()) return label;
  return label.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

/** The date of formation as a real date (an Excel serial; B17 carries a date
    format) with a four-digit year. Only an unambiguous date converts: ISO,
    a day above 12, or a month/day/year print from the 5471 face — a US
    form. "05/09/08" from a source of unknown convention stays as printed. */
export function formedCell(text: string, sourceLabel?: string): string | number {
  const s = String(text).trim();
  const serial = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const ms = Date.UTC(y, m - 1, d);
    if (new Date(ms).getUTCMonth() !== m - 1) return null;
    return Math.round((ms - Date.UTC(1899, 11, 30)) / 86400000);
  };
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return serial(+iso[1], +iso[2], +iso[3]) ?? s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (!m) return s;
  const yy = +m[3];
  const year = m[3].length === 4 ? yy : yy + 2000 > new Date().getFullYear() ? 1900 + yy : 2000 + yy;
  const a = +m[1], b = +m[2];
  const usOrder = /5471 face/i.test(sourceLabel || "");
  const md = a > 12 ? false : b > 12 ? true : usOrder ? true : null;
  if (md === null) return s;
  return (md ? serial(year, a, b) : serial(year, b, a)) ?? s;
}

export function buildWrites(ent: Entity): Writes {
  const basic: Record<string, string | number> = {};
  PROFILE_FIELDS.forEach((f) => {
    const v = ent.profile[f.key];
    if (v === undefined || v === "") return;
    basic[f.cell] = f.key === "formed" ? formedCell(v, ent.detected?.formed?.sourceLabel) : v;
  });
  // The template has no label for the two added boxes; they are written
  // whether or not a value was found, so the preparer sees where it goes.
  basic.A5 = "Reference ID:";
  basic.A29 = "Principal Place of Business";
  /* One name, entered once. The header (B4) feeds the title of every sheet,
     so it cannot go; it now follows Legal Name of Entity (B11) instead of
     being a second box to keep in step. */
  if (ent.profile.legalName) basic.B4 = "=B11";
  OWNERSHIP_FIELDS.forEach((f) => {
    const v = ent.ownership[f.key];
    if (v === undefined || v === "") return;
    basic[f.cell] = f.type === "pct" ? Number(v) / 100 : f.type === "num" ? Number(v) : v;
  });
  // The reviewed papers tick a filer category with "X", like the form's box.
  Object.entries(CATEGORY_CELLS).forEach(([cat, cell]) => { if (ent.categories[cat]) basic[cell] = "X"; });
  FX_FIELDS.forEach((f) => {
    const v = ent.fx[f.key];
    if (v !== undefined && v !== "") basic[f.cell] = Number(v);
  });

  const is: Record<string, string | number> = {};
  IS_LINES.forEach((l) => {
    const d = ent.lines[`IS:${l.row}`];
    if (d && typeof d.amount === "number") is[`F${l.row}`] = d.amount;
    /* Resolve the caption at WRITE time, not when the mapping was made:
       translation runs as its own step after processing, so a caption fixed
       at mapping time would ship the original wording into the workbook until
       the entity was processed again. A relabel the preparer typed by hand is
       not a key in the translations map, so it passes through untouched. */
    const rl = ent.relabels[`IS:${l.row}`];
    if (l.relabel && rl) is[`C${l.row}`] = displayLabel(ent.translations, rl);
  });

  const bs: Record<string, string | number> = {};
  BS_LINES.forEach((l) => {
    const d = ent.lines[`BS:${l.row}`];
    if (d) {
      if (typeof d.boy === "number") bs[`D${l.row}`] = d.boy;
      if (typeof d.eoy === "number") bs[`F${l.row}`] = d.eoy;
    }
    const rl = ent.relabels[`BS:${l.row}`];
    if (l.relabel && rl) bs[`B${l.row}`] = displayLabel(ent.translations, rl);
  });

  const writes: Writes = {};
  if (Object.keys(basic).length) writes[SHEET.basic] = basic;
  writes[SHEET.is] = is;
  writes[SHEET.bs] = bs;

  // Schedule writes prepared during processing (J, M, R, E, Dividends, …),
  // refused when they would land on a formula cell — and never allowed to
  // overwrite a value the user staged on the line itself.
  for (const w of ent.extraWrites) {
    const guard = FORMULA_REFS[w.sheet];
    if (guard && guard(w.ref)) continue;
    const sheet = (writes[w.sheet] ||= {});
    // The last thing before the value reaches a cell: 2 dp for numbers, ASCII
    // for text. Everything else passes through untouched.
    const value = typeof w.value === "number" ? (w.dp ? roundDp(w.value, w.dp) : r2(w.value)) : typeof w.value === "string" ? sanitize(w.value) : w.value;
    if (sheet[w.ref] !== undefined && sheet[w.ref] !== "" && sheet[w.ref] !== value) continue;
    sheet[w.ref] = value;
  }

  /* A dividend found before the year-average rate was known left Schedule M
     without its dividends-paid line; the rate entered afterwards completes
     it here, exactly as processing would have. */
  {
    const avg = numeric(ent.fx.avgRate);
    const div0 = ent.dividends[0];
    if (div0 && avg && !ent.extraWrites.some((w) => w.sheet === SHEET.schM && w.ref === "E32")) {
      const sm = (writes[SHEET.schM] ||= {});
      if (sm.E32 === undefined) sm.E32 = Math.round((div0.amountFunctional * dividendShareOfFiler(ent)) / avg);
    }
  }

  /* Schedule Q unit 1: Schedule C's own totals as they stand now — line 10
     less line 8a (as Schedule I-1 reads it), line 18 and line 21a, computed
     the way the template's totals are. Values, never formulas: the workbook
     receives no formula it did not ship with. */
  if (Object.keys(ent.lines).some((k) => k.startsWith("IS:"))) {
    const amt = (row: number) => { const v = ent.lines[`IS:${row}`]?.amount; return typeof v === "number" ? v : 0; };
    const totalIncome = amt(7) - amt(8) - (amt(10) + amt(11) + amt(12)) + [14, 15, 16, 17, 18, 19, 20, 22, 23, 24].reduce((n, r) => n + amt(r), 0);
    const deductions = [26, 27, 28, 29, 30, 31, 32].reduce((n, r) => n + amt(r), 0) + POOLS["IS:OD"].rows.reduce((n, r) => n + amt(r), 0);
    const sq = (writes[SHEET.schQ] ||= {});
    if (sq.H57 === undefined) sq.H57 = r2(totalIncome - amt(19));
    if (sq.J57 === undefined) sq.J57 = r2(deductions);
    if (sq.X57 === undefined) sq.X57 = r2(amt(62));
  }

  // Leftover demo captions on unused relabel rows are cleared, never shipped.
  // This runs LAST so it can never blank a cell some other source filled.
  for (const ref of DEMO_RELABELS[SHEET.is] || []) {
    const row = Number(ref.slice(1));
    if (is[`F${row}`] === undefined && is[ref] === undefined) is[ref] = "";
  }
  for (const ref of DEMO_RELABELS[SHEET.bs] || []) {
    const row = Number(ref.slice(1));
    if (bs[`D${row}`] === undefined && bs[`F${row}`] === undefined && bs[ref] === undefined) bs[ref] = "";
  }
  if (!Object.keys(is).length) delete writes[SHEET.is];
  if (!Object.keys(bs).length) delete writes[SHEET.bs];
  // Review-summary exclusions: a sheet the preparer unchecked receives NO
  // writes — the template sheet itself stays (formula cross-references like
  // Schedule I & I-1 ← Sch E&E-1!U21 forbid removing sheets).
  for (const s of ent.excludedSheets || []) delete writes[s];
  return writes;
}

/** @deprecated — kept as an alias for older imports; use ReviewItem. */
export type Blocker = ReviewItem;

/** Derived validation — merged with the stored review items via allReviewItems. */
export function validateEntity(ent: Entity): ReviewItem[] {
  const out: ReviewItem[] = [];

  /* The year end was changed after the run that produced these figures. Every
     line, rate and check on the entity belongs to the year before it, so the
     work paper would be dated one year and filled from another. */
  if (ent.yearStale) {
    out.push({
      id: "year-changed-reprocess", level: "block", category: "consistency",
      message: `The year end was changed to ${ent.profile.cyEnd || "a new value"} after this entity was processed. Every mapped line, exchange rate and check still belongs to the previous year. Process the entity again before generating — nothing here has been recalculated for ${ent.profile.cyEnd || "the new year"}.`,
      target: `${SHEET.basic}!B1`,
    });
  }

  const rate = (k: string) => {
    const v = ent.fx[k];
    const n = v === undefined || v === "" ? NaN : Number(v);
    return isFinite(n) && n > 0 ? n : null;
  };
  const hasBS = BS_LINES.some((l) => ent.lines[`BS:${l.row}`]);
  const hasIS = IS_LINES.some((l) => ent.lines[`IS:${l.row}`]);

  /* The income statement must arrive at the result the statements themselves
     report. The balance sheet prints it inside equity ("Net Income",
     "Bénéfice de l'exercice"); when Schedule C, built line by line, lands
     somewhere else, a P&L line was missed, read twice or signed the wrong
     way — and a balanced Schedule F cannot show it, because the stated
     result is booked there as printed. */
  const differ = resultsDisagree(ent);
  if (differ) {
    out.push({
      id: "pnl-bs-result-differ", level: "warn", category: "consistency",
      message: `The client's two reports disagree about the year's result: the profit and loss says "${differ.pnlLabel}" ${differ.pnl.toLocaleString()}, the balance sheet's equity carries "${differ.bsLabel}" ${differ.bs.toLocaleString()} — ${differ.diff.toLocaleString()} apart. They were run at different times or with different settings. Schedule C follows the P&L and Schedule F the balance sheet as printed; ask the client for a matching pair before filing.`,
      target: `${SHEET.bs}!F61`,
    });
  }

  /* Form 5471 page 1 asks for the principal business activity. A blank B25
     used to go unnoticed until review. */
  if (ent.processedAt && !String(ent.profile.activity || "").trim()) {
    out.push({
      id: "basic-activity-missing", level: "warn", category: "source-gap",
      message: `Principal Business Activity (Basic Information B25) is blank: neither the prior return's page 1 (items f/g) nor a questionnaire stated it${ent.profile.activityCode ? `, although the activity code ${ent.profile.activityCode} was read` : ""}. Enter it on Basic Information before generating.`,
      target: `${SHEET.basic}!B25`,
    });
  }

  /* A numbered-box return states the year's result itself. Schedule C built
     from it must reach that result before income tax — if it does not, a box
     was missed or read wrong, and the work paper is not generated. */
  const bookedNi = bookNetIncome(ent.lines);
  if (hasIS && bookedNi !== null) {
    const incomeTax = (ent.lines["IS:62"]?.amount || 0) + (ent.lines["IS:63"]?.amount || 0);
    const preTax = r2(bookedNi + incomeTax);
    const off = (ent.formResults || []).filter((fr) => Math.abs(fr.value - preTax) > Math.max(1, Math.abs(fr.value) * 0.001));
    if (off.length) out.push({
      id: "form-result-mismatch", level: "block", category: "consistency",
      message: `Schedule C does not reach the result the tax return states: ${off.map((fr) => `${fr.label} in ${fr.docName} is ${fr.value.toLocaleString()}`).join("; ")}, but the booked lines give ${preTax.toLocaleString()} before income tax — a difference of ${r2(off[0].value - preTax).toLocaleString()}. A box was missed, read twice or has the wrong sign. Compare the Income Statement tab with the return box by box, correct it on Mapping & adjustments, and re-process. Generation stays blocked until they agree or you record the real reason they differ.`,
      target: `${SHEET.is}!F64`,
    });
  }

  /* One rate for the prior year end. The opening column was translated when
     the entity was processed; if C61 has changed since, the workbook would
     divide the opening column by one rate and the prior-year rate cell would
     state another. */
  if (ent.openingRate && hasBS) {
    const now = openingRateFor(ent.profile.currency, rate("pyRate"), null);
    if (now && Math.abs(now.rate - ent.openingRate.rate) / now.rate > 0.0005) out.push({
      id: "fx-opening-rate-stale", level: "block", category: "fx",
      message: `The opening balances (Schedule F column (a)) were translated at ${ent.openingRate.rate}, but the prior-year rate in Basic Information C61 is now ${now.rate}. One rate must serve both: re-process the entity so the opening column is rebuilt at ${now.rate}, or set C61 back to ${ent.openingRate.rate}.`,
      target: `${SHEET.basic}!C61`,
    });
  }

  /* Schedule F against the balance sheet's own "Total assets". */
  const statedTa = (ent.statedResults || []).filter((x) => x.feed === "bs");
  if (hasBS && statedTa.length) {
    let bookedTa = 0;
    for (const l of BS_LINES) {
      const v = ent.lines[`BS:${l.row}`]?.eoy;
      if (/assets/i.test(l.group) && typeof v === "number" && isFinite(v)) bookedTa += v;
    }
    bookedTa = r2(bookedTa);
    if (statedTa.every((x) => Math.abs(x.value - bookedTa) > Math.max(1, Math.abs(x.value) * 0.001))) out.push({
      id: "schf-total-assets-tie", level: "block", category: "consistency",
      message: `Schedule F does not reach the balance sheet's own total: "${statedTa[0].label}" in ${statedTa[0].docName} is ${statedTa[0].value.toLocaleString()}, but the booked asset lines give ${bookedTa.toLocaleString()} at the end of the year — a difference of ${r2(statedTa[0].value - bookedTa).toLocaleString()}. An asset was missed, read twice, or a liability or note figure was booked as an asset. Compare the Balance Sheet tab with the statement line by line and correct it on Mapping & adjustments. Generation stays blocked until they agree or you record the real reason they differ.`,
      target: `${SHEET.bs}!F42`,
    });
  }

  /* Schedule F must foot at both ends of the year (dist: EN9tieOut). When it
     does not, a single line whose amount alone explains the gap is named. */
  {
    const eoy = bsBalance(ent.lines, "eoy");
    if (Math.abs(eoy.diff) >= 0.01) out.push({
      id: "EN9-tie-bs-eoy", level: "block", category: "tie-out",
      message: `Schedule F does not balance at the end of the year: assets ${eoy.assets.toLocaleString()} against liabilities and equity ${eoy.liabEquity.toLocaleString()}, out by ${eoy.diff.toLocaleString()}. A figure has been counted twice or a line is missing — check the contributions on each balance-sheet line before generating.${bsSuspectText(ent.lines, "eoy", eoy.diff)}`,
      target: `${SHEET.bs}!F62`,
    });
    const boy = bsBalance(ent.lines, "boy");
    if (Math.abs(boy.diff) >= 0.01 && (boy.assets || boy.liabEquity)) out.push({
      id: "EN9-tie-bs-boy", level: "block", category: "tie-out",
      message: `Schedule F does not balance at the beginning of the year: out by ${boy.diff.toLocaleString()}.${bsSuspectText(ent.lines, "boy", boy.diff)}`,
      target: `${SHEET.bs}!D62`,
    });
  }

  const tie = pnlTieOut(ent);
  if (hasIS && tie) {
    out.push({
      id: "pnl-net-income-tie", level: "block", category: "consistency",
      message: `Schedule C does not reach the statements' own result for the year: the booked lines give net income of ${tie.booked.toLocaleString()}, but "${tie.label}" on the ${tie.where} reports ${tie.stated.toLocaleString()} — a difference of ${tie.diff.toLocaleString()}. `
        + (tie.candidates.length
          ? `Unassigned income-statement row(s) of that amount: ${tie.candidates.map((c) => `"${c}"`).join(", ")} — assign ${tie.candidates.length > 1 ? "the right one" : "it"} on Mapping & adjustments.`
          : tie.suspects.length
            ? `Booked row(s) that alone explain the difference: ${tie.suspects.join("; ")}. Check ${tie.suspects.length > 1 ? "them" : "it"} first on Mapping & adjustments.`
            : `A P&L line was missed, read twice or has the wrong sign: compare the Income Statement tab with the source P&L line by line${tie.unassigned ? ` (${tie.unassigned} income-statement row(s) are still unassigned in Review)` : ""}.`),
      target: `${SHEET.is}!F64`,
    });
  }

  /* Every rate and balance check below is gated on there being lines to check,
     so an entity that mapped NOTHING raised no blocker at all and would have
     generated an empty work paper. Two Chilean CFCs did exactly that: their
     SII Form 22 filings yielded no rows, and the only thing standing between
     the preparer and a blank workbook was the currency-confirmation prompt. */
  if (ent.processedAt && !hasBS && !hasIS) {
    out.push({
      id: "no-lines-mapped", level: "block", category: "source-gap",
      message: `Processing mapped no schedule line from ${ent.files.length} document(s) — the work paper would generate empty. `
        + `Check the Exception center for unread documents, set a document type on the Documents tab, or assign the captions by hand.`,
    });
  }

  // The template divides by these; a blank or zero rate yields #DIV/0! in every
  // USD column of Schedule C and Schedule F.
  if (hasIS && !rate("avgRate")) {
    const code = (ent.profile.currency || "the functional currency").toUpperCase();
    const why = ent.fxMeta?.avgRateNote?.source
      ? ` ${ent.fxMeta.avgRateNote.source}.`
      : ent.profile.currency
        ? ` No IRS-table average was found for ${code} and no fallback figure was applied.`
        : "";
    /* Nothing reachable: the mean of the two Treasury year-end rates is
       offered as an ESTIMATE, one click to accept, never written on its own. */
    const est = ent.fxMeta?.avgRateNote?.estimate;
    out.push({
      id: "fx-avg-missing", level: "block", category: "fx",
      message: `Average exchange rate (C59) is missing — Schedule C USD columns will show #DIV/0!.${why} Enter the period's average rate manually.`
        + (est ? ` An estimate of ${est} — the mean of the prior and current year-end Treasury rates (${ent.fx.pyRate} and ${ent.fx.cyRate}) — is offered; accept it only if no better average (the client's bank, the central bank) is available. It is not an IRS rate.` : ""),
      target: `${SHEET.basic}!C59`,
      ...(est ? { suggestedValue: est } : {}),
    });
  }
  if (hasBS && !rate("cyRate")) {
    out.push({ id: "fx-cy-missing", level: "block", category: "fx", message: "Current year end rate (C60) is missing — Schedule F end-of-year USD column will show #DIV/0!", target: `${SHEET.basic}!C60` });
  }
  if (hasBS && !rate("pyRate")) {
    out.push({ id: "fx-py-missing", level: "block", category: "fx", message: "Prior year end rate (C61) is missing — Schedule F beginning-of-year USD column will show #DIV/0!", target: `${SHEET.basic}!C61` });
  }
  // C-01: an auto-detected currency gates generation until confirmed.
  if (ent.profile.currency && ent.detected.currency && !ent.currencyConfirmed) {
    out.push({
      id: "fx-currency-unconfirmed", level: "block", category: "fx",
      message: `Functional currency ${ent.profile.currency.toUpperCase()} was read from ${ent.detected.currency.sourceLabel} and has NOT been confirmed. Confirm it (or correct it in the entity profile) before generating — every USD column divides by ${ent.profile.currency.toUpperCase()} rates.`,
      target: `${SHEET.basic}!B27`,
    });
  }
  /* Item H on the face of the form: is the filer a director or officer? It is
     a question only the preparer can answer when neither the questionnaire nor
     the prior return's Item H boxes answered it, and a blank here is a blank
     box on a filed form. Asked before generation rather than found afterwards. */
  if (!ent.ownership.isOfficer && (ent.shareholders || []).length > 0) {
    out.push({
      id: "officer-flag-unconfirmed", level: "block", category: "profile",
      message: "Is the filer a director or officer of the foreign corporation? Basic Information C35 is blank and neither the client questionnaire nor the prior return answered it — answer before generating.",
      target: `${SHEET.basic}!C35`,
    });
  }
  /* The statements and the prior return name different corporations. Asked
     before the first generation, because the answer decides both the legal
     name written throughout the workbook and whether a whole prior return's
     figures are used at all. */
  if (ent.nameMismatch) {
    out.push({
      id: "cf-name-unconfirmed", level: "block", category: "carry-forward",
      message: `The statements name "${ent.nameMismatch.statementName}" but ${ent.nameMismatch.source} names "${ent.nameMismatch.priorName}" as the foreign corporation. Confirm the legal name: if these are the same entity, the prior return's opening balances, filer categories, shareholders and opening E&P are carried forward; if not, they are left out.`,
      target: `${SHEET.basic}!B11`,
    });
  }
  // Fiscal year: the published tables are calendar-year — the guard leaves
  // the rates blank on purpose, and this item says what to enter by hand.
  /* A fiscal year always deserves a word about its rates, but not the same
     word. Three outcomes, three messages: something is still missing; OFX
     filled it from daily data over the real period; or the rates in use came
     from the preparer or a live quote and only need confirming. Telling
     someone to "enter the rates manually" when they already have is how a
     warning gets ignored. */
  if (isFiscalPeriod(ent.profile.cyEnd)) {
    const incomplete = !rate("avgRate") || !rate("cyRate") || !rate("pyRate");
    const fromOfx = ["avgRate", "cyRate", "pyRate"].some((k) => fxTag(ent.fxMeta?.[k]) === "OFX");
    out.push({
      id: "fx-fiscal-manual", level: "warn", category: "fx",
      message: incomplete
        ? `Fiscal year ending ${ent.profile.cyEnd}: the IRS yearly-average and Treasury 12/31 tables are calendar-year figures and were NOT applied, and OFX daily data could not fill every rate — enter the missing rate(s) manually.`
        : fromOfx
          ? `Fiscal year ending ${ent.profile.cyEnd}: rates were derived from OFX daily data over the actual fiscal period (IRS/Treasury calendar tables do not apply). Review the OFX-sourced figures before filing.`
          : `Fiscal year ending ${ent.profile.cyEnd}: calendar-year IRS/Treasury tables do not apply; the rates in use were entered manually or from live quotes — confirm they reflect the ${ent.profile.cyEnd} period.`,
      target: `${SHEET.basic}!C59`,
    });
  }
  if (!ent.profile.currency) {
    out.push({ id: "profile-currency", level: "warn", category: "profile", message: "Functional currency is not set — rates cannot be looked up automatically" });
  }
  if (!ent.profile.cyEnd) {
    out.push({ id: "profile-cyend", level: "warn", category: "profile", message: "Current year end is not set — the workbook header and rate year depend on it" });
  }
  /* B17 carries a date number format, so formedCell writes an Excel serial and
     Excel renders it as a date. When the day/month order cannot be resolved
     the helper hands back the text unchanged, which then sits in a
     date-formatted cell as a string — right value, wrong type, and easy to
     miss. Say so rather than letting the preparer find it. */
  if (ent.profile.formed && typeof formedCell(ent.profile.formed, ent.detected?.formed?.sourceLabel) === "string") {
    out.push({
      id: "profile-formed-ambiguous", level: "warn", category: "profile",
      message: `Date of formation "${ent.profile.formed}" could not be read as a date — day and month are ambiguous, or the text is not a date at all. It is written to Basic Information B17 as text, in a cell formatted for a date. Retype it as YYYY-MM-DD to have it stored as a real date.`,
      target: `${SHEET.basic}!B17`,
    });
  }
  if (ent.unmatched.length) {
    out.push({ id: "mapping-unmatched", level: "warn", category: "mapping", message: `${ent.unmatched.length} extracted label(s) are still unassigned` });
  }
  /* A statement in a language the rules do not cover reads as "0 lines" with
     no explanation, which looks like a parse failure. If captions WERE
     extracted and almost none matched, say what is actually happening. */
  if (ent.unmatched.length >= 6 && Object.keys(ent.lines).length <= 1) {
    const nonEnglish = ent.unmatched.filter((u) => detectLanguage(u.label) !== "English");
    const share = nonEnglish.length / ent.unmatched.length;
    if (share >= 0.4) {
      const langs = [...new Set(nonEnglish.map((u) => detectLanguage(u.label)))].join(", ");
      out.push({
        id: "mapping-language", level: "block", category: "mapping",
        message: `${ent.unmatched.length} captions were read from the documents but almost none matched a template line, and ${nonEnglish.length} of them are not in English (${langs}). This is a language gap, not a failed read. Translate the captions on the Multilingual evidence tab — mapping now retries a caption against its translation — or add an AI key in Settings, or map the lines by hand in Mapping & adjustments.`,
      });
    }
  }
  /* The filer categories decide which schedules are filed, and they are
     usually carried from the prior return — which describes LAST year's
     events (the year the shares were bought, say). The ownership answers on
     Basic Information are this year's, so the two are checked against each
     other. Nothing is switched automatically: the preparer confirms. */
  if (ent.processedAt) {
    const cats = ent.categories || {};
    const on = Object.keys(cats).filter((k) => cats[k]);
    const pctOf = (v: string | undefined) => { const n = Number(String(v ?? "").replace("%", "")); return isFinite(n) ? (n > 0 && n <= 1 ? n * 100 : n) : 0; };
    const own = Math.max(pctOf(ent.ownership.ownStart), pctOf(ent.ownership.ownEnd));
    const sel = on.length ? on.join(", ") : "none";
    if (ent.ownership.cfc === "Yes" && own >= 10 && !on.some((k) => /^5/.test(k))) {
      out.push({
        id: "category-5-expected", level: "warn", category: "profile",
        message: `Basic Information says the corporation is a CFC and the filer owns ${own}% — a U.S. shareholder of a CFC normally files as Category 5 (5a, 5b or 5c), which is not selected (selected: ${sel}). Confirm the categories in the Review summary before generating; they decide which schedules are required.`,
        target: `${SHEET.basic}!B48`,
      });
    }
    if (pctOf(ent.ownership.ownEnd) > 50 && !on.includes("4")) {
      out.push({
        id: "category-4-expected", level: "warn", category: "profile",
        message: `The filer owns ${pctOf(ent.ownership.ownEnd)}% at the end of the year — more than 50% is control, which is Category 4, and it is not selected (selected: ${sel}). Confirm the categories in the Review summary.`,
        target: `${SHEET.basic}!B47`,
      });
    }
    if (on.includes("3") && own >= 10 && pctOf(ent.ownership.ownStart) === pctOf(ent.ownership.ownEnd)) {
      out.push({
        id: "category-3-carried", level: "warn", category: "profile",
        message: `Category 3 is selected, but the filer's holding is ${own}% at both the start and the end of the year. Category 3 is for the year stock is acquired or disposed of (or the filer becomes a U.S. person); when it was carried from the prior return, confirm it applies to this year.`,
        target: `${SHEET.basic}!B46`,
      });
    }
  }
  if (!Object.keys(ent.categories).some((k) => ent.categories[k])) {
    out.push({ id: "profile-category", level: "warn", category: "profile", message: "No filing category selected" });
  }
  /* Missing documents, OCR confidence, why a document produced nothing, how
     Schedule C adds up, why the ownership answers read as they do, and what
     the preparer chose before — advice only (insights.ts). */
  try { out.push(...usdRoundingGaps(ent.lines, numeric(String(ent.fx?.cyRate ?? "")), numeric(String(ent.fx?.pyRate ?? "")))); } catch { /* never blocks validation */ }
  try { out.push(...(entityInsights(ent, readChoiceMemory()) as ReviewItem[])); } catch { /* advice never blocks */ }
  return out;
}

/** Ids validateEntity can produce — stored dismissal tombstones for these
    must vanish once the underlying condition is resolved. */
const DERIVED_IDS = new Set([
  "fx-avg-missing", "fx-cy-missing", "fx-py-missing", "fx-fiscal-manual", "fx-currency-unconfirmed",
  "cf-name-unconfirmed", "officer-flag-unconfirmed",
  "no-lines-mapped", "mapping-language",
  "pnl-net-income-tie", "form-result-mismatch", "schf-total-assets-tie", "fx-opening-rate-stale", "pnl-bs-result-differ", "basic-activity-missing", "category-5-expected", "category-4-expected", "category-3-carried",
  "profile-currency", "profile-cyend", "mapping-unmatched", "profile-category",
  "profile-formed-ambiguous",
]);

/** Blocking items that a preparer may NOT acknowledge past.
 *
 * Acknowledging writes nothing, so a gate whose whole purpose is to fill a
 * required Form 5471 cell can be signed off into a blank field — which is how
 * the SHORI 2024 work paper shipped with Basic Information C35 empty. For
 * these ids the Exception Center offers the answer and nothing else. */
export const MUST_ANSWER = new Set(["officer-flag-unconfirmed"]);



const describePolicyRule = (p: PolicyRule) =>
  `${p.match.id ? `id=${p.match.id}` : p.match.category ? `category=${p.match.category}` : `message~"${p.match.message}"`} → ${p.action}`;

/** Everything the reviewer should see: derived checks + stored case items.
    Policies apply at READ time — reversible, and the audit export keeps the
    raw levels (pass {raw: true} to bypass). */
export function allReviewItems(ent: Entity, opts?: { raw?: boolean }): ReviewItem[] {
  const stored = new Map(ent.reviewItems.map((r) => [r.id, r]));
  const derived = validateEntity(ent).map((d) => {
    const s = stored.get(d.id);
    return s ? { ...d, dismissed: s.dismissed, dismissedNote: s.dismissedNote } : d;
  });
  const currentIds = new Set(derived.map((d) => d.id));
  // A dismissal of a derived item whose condition no longer holds is a ghost.
  const merged = [...derived, ...ent.reviewItems.filter((r) => !currentIds.has(r.id) && !DERIVED_IDS.has(r.id))]
    .map((r) => {
      // Every review surface reads through here, so this is the one place the
      // quoted caption has to be resolved to the translated wording.
      if (!r.sourceLabel) return r;
      const en = displayLabel(ent.translations, r.sourceLabel);
      return en === r.sourceLabel ? r : { ...r, message: r.message.split(r.sourceLabel).join(en) };
    });
  /* What to fix first and which cross-document checks pass — read from the
     whole list, so it is built last, and shown first. */
  try { merged.unshift(...(summarizeReview(ent, merged) as ReviewItem[])); } catch { /* advice never blocks */ }
  if (opts?.raw || !state.policies.length) return merged;
  /* A policy may downgrade or suppress almost anything, which is the point of
     policies — but not a gate whose only job is to fill a required cell. That
     is the route by which the SHORI 2024 C35 shipped blank: the question was
     never answered and a policy waved the block through. */
  return merged
    .map((r) => (MUST_ANSWER.has(r.id) ? r : applyPolicy(r, state.policies)))
    .filter((r): r is ReviewItem => r !== null);
}

export function blockingIssues(ent: Entity): ReviewItem[] {
  return allReviewItems(ent).filter((b) => b.level === "block" && !b.dismissed);
}

/** The load-bearing audit line: generating over a policy-downgraded or
    policy-suppressed block must leave a trail every single time. */
function logPolicyOverriddenBlocks(ent: Entity) {
  if (!state.policies.length) return;
  const gating = new Set(blockingIssues(ent).map((b) => b.id));
  const overridden = allReviewItems(ent, { raw: true })
    .filter((r) => r.level === "block" && !r.dismissed && !gating.has(r.id));
  for (const r of overridden) {
    logEvent("Blocking exception overridden by policy", `${r.id}: ${r.message.slice(0, 140)}`, ent.name, "system");
  }
}

export function cellCount(ent: Entity): number {
  return Object.values(buildWrites(ent)).reduce((n, o) => n + Object.keys(o).length, 0);
}

/** Export the audit log as JSON for the engagement file. */
export function safeDownloadJson(snapshot: WpState) {
  const payload = {
    stakeholder: snapshot.stakeholder,
    exportedAt: new Date().toISOString(),
    entities: snapshot.entities.map((e) => ({
      name: e.name,
      status: e.status,
      documents: e.files.map((f) => ({
        name: f.name,
        size: f.size,
        classification: e.docClasses[f.id]
          ? { kind: e.docClasses[f.id].kind, year: e.docClasses[f.id].statementYear, duplicateOf: e.docClasses[f.id].duplicateOf ?? null }
          : null,
      })),
      linesMapped: Object.keys(e.lines).length,
      unmatched: e.unmatched.length,
      cellsToWrite: cellCount(e),
      scheduleWrites: e.extraWrites.map((w) => ({ sheet: w.sheet, ref: w.ref, value: w.value, source: w.source ?? null })),
      contributions: Object.fromEntries(
        Object.entries(e.contributions).map(([k, list]) => [k, list.map((c) => ({ doc: c.docName, page: c.page ?? null, label: c.label, value: c.value, field: c.field, year: c.year ?? null, via: c.via }))]),
      ),
      reviewItems: allReviewItems(e).map((r) => ({ id: r.id, level: r.level, category: r.category, message: r.message, dismissed: !!r.dismissed, note: r.dismissedNote ?? null })),
    })),
    events: snapshot.events,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  if (!safeDownload(blob, `5471_audit_${safeName(snapshot.stakeholder)}.json`)) {
    toast("Download was blocked by the browser", "bad");
  } else {
    toast("Audit log exported", "ok");
  }
}

export function safeName(s: string): string {
  return String(s).replace(/[^A-Za-z0-9 _.-]/g, "").replace(/\s+/g, "_").slice(0, 60) || "Entity";
}

/** Rows for the Provenance sheet: every figure a machine placed, and every
 *  exchange rate with where it came from.
 *
 * The reviewer needs one place that answers "what did the software decide on
 * its own, and on what evidence" — hunting through the log for that is how
 * an AI-placed figure reaches a filed return unchecked. Rule-mapped
 * contributions are listed too, because "the keyword rules put it there" is
 * itself a fact worth being able to see next to the AI ones. */
/* The itemisation a shared row cannot show on its face.

   Schedule F line 16 offers three relabel rows and Schedule C line 17 twenty-
   five; a statement with more accounts than that has to put several on one
   row. The form line is genuinely one line, so the total is right — but the
   return's attached schedule still has to name each account, and a work paper
   that prints one caption over three balances cannot support it. This sheet
   is that attached schedule: every row of the work paper that carries more
   than one source caption, with each caption's own figures. */
function attachedScheduleRows(ent: Entity): CellValue[][] | null {
  type Cap = { label: string; boy: number | null; eoy: number | null; amount: number | null; docs: Set<string>; pages: Set<number> };
  const groups: { target: string; line: string; shown: string; caps: Cap[] }[] = [];
  for (const [target, list] of Object.entries(ent.contributions || {})) {
    const spec = specFor(target);
    if (!spec?.relabel) continue;                    // fixed form lines are not "attach schedule" rows
    const byCap = new Map<string, Cap>();
    for (const c of list) {
      const name = String(c.label || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      let cap = byCap.get(key);
      if (!cap) { cap = { label: name, boy: null, eoy: null, amount: null, docs: new Set(), pages: new Set() }; byCap.set(key, cap); }
      if (typeof c.value === "number") {
        const f = c.field as "boy" | "eoy" | "amount";
        cap[f] = (cap[f] ?? 0) + c.value;
      }
      if (c.docName) cap.docs.add(c.docName);
      if (typeof c.page === "number") cap.pages.add(c.page);
    }
    if (byCap.size < 2) continue;                    // one account on its own row needs no schedule
    const sheetName = target.startsWith("IS") ? SHEET.is : SHEET.bs;
    groups.push({
      target,
      line: `${sheetName} row ${target.split(":")[1]} · ${spec.label} (form line ${spec.ref})`,
      shown: displayLabel(ent.translations, ent.relabels[target] || spec.label),
      caps: [...byCap.values()],
    });
  }
  if (!groups.length) return null;

  const rows: CellValue[][] = [];
  rows.push(["FORM 5471 WORK PAPER — ATTACHED SCHEDULES"]);
  rows.push(["Generated", new Date().toISOString(), "App", "5471 Work Paper 2.1.0"]);
  rows.push(["Each block below is one work-paper row that carries more than one account from the source statements. The row's total is the sum shown here. Use this list where the return asks for the line to be itemised — nothing was dropped and nothing was renamed."]);
  for (const g of groups) {
    rows.push([]);
    rows.push([g.line]);
    rows.push(["Shown on the work paper as", g.shown]);
    rows.push(["Source caption", "Beginning of year", "End of year", "Amount", "Document", "Page(s)"]);
    const tot = { boy: 0, eoy: 0, amount: 0 };
    for (const c of g.caps) {
      tot.boy += c.boy ?? 0; tot.eoy += c.eoy ?? 0; tot.amount += c.amount ?? 0;
      rows.push([bilingualLabel(ent.translations, c.label), c.boy ?? "", c.eoy ?? "", c.amount ?? "",
                 [...c.docs].join(", "), [...c.pages].sort((a, b) => a - b).join(", ")]);
    }
    rows.push([`Total (${g.caps.length} accounts)`, tot.boy || "", tot.eoy || "", tot.amount || "", "", ""]);
  }
  return rows;
}

/* Schedule E asks for TWO periods: the foreign tax year the tax relates to
   (column d) and the U.S. tax year it is claimed in (column e). They are the
   same date only when the corporation keeps a calendar year. The work paper
   writes the corporation's own accounting period into both because that is
   the one fact the documents state — which is right for a 31 December CFC and
   an assumption for every other year end, so a fiscal year end says so rather
   than letting the two columns agree by default. */
function nonCalendarTaxYear(ent: Entity, rv: (item: ReviewItem) => void): void {
  const p = String(ent.profile.cyEnd || "").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\//.exec(p);
  if (!m || (Number(m[1]) === 12 && Number(m[2]) === 31)) return;
  rv({
    id: "sch-e-tax-year-pair", level: "warn", category: "consistency", applied: true,
    message: `Schedule E columns (d) and (e) both read ${p}. Column (d) is the FOREIGN tax year the tax relates to, which is this corporation's accounting period; column (e) is the U.S. tax year of the shareholder claiming it. This corporation does not keep a calendar year, so the two are not necessarily the same period — confirm column (e) against the shareholder's return before filing.`,
    target: `${SHEET.schE}!K16`,
  });
}

function provenanceRows(ent: Entity): CellValue[][] {
  const rows: CellValue[][] = [];
  const label = (target: string) => {
    const spec = /^IS:/.test(target)
      ? IS_LINES.find((l) => `IS:${l.row}` === target)
      : BS_LINES.find((l) => `BS:${l.row}` === target);
    return spec ? (/^IS:/.test(target) ? "Sch C · " : "Sch F · ") + spec.label : target;
  };

  rows.push(["FORM 5471 WORK PAPER — PROVENANCE (machine-assisted entries)"]);
  rows.push(["Generated", new Date().toISOString(), "App", "5471 Work Paper 2.1.0",
             "AI model", state.groq?.key ? state.groq.model : "none (no key configured)"]);
  rows.push(["This sheet lists every booked figure with how its line was chosen (keyword rule, section heading, AI model or preparer), every exchange rate with its source, and every blocking exception acknowledged before generation. Verify AI-placed and section-placed figures against the source documents before filing. This work paper is a preparer aid — it is not tax advice, and the preparer remains responsible for the filed return."]);
  rows.push([]);
  rows.push(["Kind", "Line / field", "Source caption", "Document", "Page", "Value", "Confidence", "Note"]);
  /* Where each booked figure sits in its source — the page or spreadsheet
     row, the column it was taken from, and the figures the row printed — so
     a reviewer can go straight to it. Added as the last column, after any
     OCR columns, so existing columns keep their positions. */
  const whereOf = new Map<CellValue[], string>();

  for (const [target, list] of Object.entries(ent.contributions || {})) {
    for (const c of list) {
      if (!c.via) continue;
      const flaggedLow = (ent.reviewItems || []).some((r) => r.id === `ai-low-${norm(c.label || "")}`);
      const printed = (c.srcValues || []).map((v, i) => (c.srcYears && typeof c.srcYears[i] === "number" ? `${c.srcYears[i]}: ` : "") + v.toLocaleString()).join(" | ");
      whereOf.set(rows[rows.push([
        PROVENANCE_KIND[c.via] || "Rule mapping",
        `${label(target)} (${c.field})`,
        bilingualLabel(ent.translations, c.label || ""), c.docName || "", c.page != null ? c.page : "",
        typeof c.value === "number" ? c.value : "",
        c.via === "groq" ? (flaggedLow ? "LOW — verify" : "model-reported ok") : "",
        PROVENANCE_NOTE[c.via] || PROVENANCE_NOTE.rule,
      ]) - 1], [
        c.page != null ? `page ${c.page}` : "spreadsheet",
        `row "${c.label || ""}"`,
        typeof c.year === "number" ? `${c.year} column` : c.period ? `${c.period} column` : c.field === "boy" ? "opening-year column" : "the row's figure",
        printed ? `row prints ${printed}` : "",
      ].filter(Boolean).join(" · "));
    }
  }

  for (const [key, d] of Object.entries(ent.detected || {})) {
    if (!d?.src || d.src.via !== "groq") continue;
    rows.push(["AI profile field", key, d.sourceLabel || "", d.src.doc || "",
               d.src.page != null ? d.src.page : "", String(d.value || ""), d.confidence || "",
               "filled from a document caption by the AI model"]);
  }

  const rateCell: Record<string, string> = { avgRate: "C59 average", cyRate: "C60 year-end", pyRate: "C61 prior year-end" };
  for (const key of ["avgRate", "cyRate", "pyRate"]) {
    const meta = ent.fxMeta?.[key];
    const value = ent.fx?.[key];
    if (!value && !meta) continue;
    rows.push(["Exchange rate", rateCell[key], "", "", "", value || "", meta?.tag || "",
               `source: ${meta?.source || "not set"}` +
               (meta?.asOf ? ` · as of ${meta.asOf}` : meta?.enteredOn ? ` · entered ${meta.enteredOn}` : "")]);
  }

  /* The rate the opening balance sheet was built at, named separately from
     C61: it is often not C61 — a prior filing that printed its own rate wins
     — and a reviewer comparing the opening column against the prior return
     needs to know which figure was divided by what. */
  if (ent.openingRate) {
    rows.push(["Exchange rate", "opening balances (Schedule F column (a))", "", "", "",
               ent.openingRate.rate, "",
               `${ent.openingRate.why} · prior-year figures from ${ent.openingRate.source}`]);
  }

  const schE = (ent.extraWrites || []).find((w) => w.sheet === SHEET.schE && w.ref === "O16");
  if (schE) {
    rows.push(["Schedule write", "Schedule E O16 — income tax paid or accrued", "", "", "", schE.value as CellValue, "",
               "derived from Schedule C line 21a; drives Sch-H, Schedule I-1 and Form 8992"]);
  }

  /* Figures carried from the prior-year return into a schedule cell (the
     Schedule J opening E&P) are not bookings, so the loop above never listed
     them and the work paper gave no source for them. Every write that kept a
     source snapshot is listed here with the document, page and row read. */
  const carried = (ent.extraWrites || []).filter((w) => w.prov);
  if (carried.length) {
    rows.push([]);
    rows.push(["CARRIED FORWARD FROM THE PRIOR-YEAR RETURN"]);
    for (const w of carried) {
      rows.push(["Carried forward", `${w.sheet} ${w.ref}`, w.prov?.rowText || "", w.prov?.docName || "",
                 w.prov?.page != null ? w.prov.page : "", typeof w.value === "number" ? w.value : String(w.value), "",
                 `${w.source || "prior-year return"} · confirm before filing`]);
    }
  }

  /* A blocking exception the preparer acknowledged is a decision the work
     paper must record — the Boating paper shipped with an unbalanced Schedule
     F and nothing on the sheet said anyone had seen the block. */
  const acknowledged = allReviewItems(ent).filter((r) => r.level === "block" && r.dismissed);
  rows.push([]);
  rows.push(["ACKNOWLEDGED BLOCKING EXCEPTIONS — generation proceeded despite these"]);
  if (!acknowledged.length) rows.push(["none"]);
  for (const r of acknowledged) {
    const said = String(r.dismissedNote || "").trim();
    rows.push(["Acknowledged blocker", r.target || "", "", "", "", "", "",
               `${r.message}${said ? ` — preparer's note: "${said}"` : " — no note left"}` +
               (said && isThinNote(said) ? " — NOTE GIVES NO REASON: check this figure before filing" : "")]);
  }
  ocrProvenance(rows, ent);
  const head = rows.findIndex((r) => r[0] === "Kind" && r[1] === "Line / field");
  if (head >= 0 && whereOf.size) {
    const at = rows[head].length;
    rows[head].push("Where it was read");
    for (const [r, where] of whereOf) {
      while (r.length < at) r.push("");
      r.push(where);
    }
  }
  return rows;
}

/** Add OCR evidence to the Provenance sheet, in place.
 *
 * Every row that cites an OCR'd document gains three columns — the engine
 * that read the figure, its confidence, and the box on the page it was read
 * from — found by matching the booked value against the words recognised
 * on that page. A section at the foot lists each OCR'd document with its
 * engines, pages and dispute count, and the name and hash of the scan it
 * replaced, so the filed figure can always be traced to the original image. */
export function ocrProvenance(rows: CellValue[][], ent: Entity): void {
  const byName = new Map<string, EntityFile>();
  for (const f of ent.files || []) if (f.ocr) byName.set(f.name, f);
  if (!byName.size) return;
  const header = rows.findIndex((r) => r[0] === "Kind" && r[1] === "Line / field");
  if (header >= 0) rows[header].push("OCR engine", "OCR confidence", "OCR position (x0, y0, x1, y1 pt)");
  const asNum = (s: string): number | null => {
    const t = s.replace(/[\s  ']/g, "");
    const neg = /^\(.*\)$/.test(t) || /^-|-$|CR$/i.test(t);
    let core = t.replace(/^\(|\)$|^-|-$|CR$|DR$|%$/gi, "").replace(/^[$€£¥₹]|[$€£¥₹]$/g, "").replace(/^(USD|EUR|GBP|CHF|KYD)|(USD|EUR|GBP|CHF|KYD)$/gi, "");
    if (core.includes(",") && core.includes(".")) core = core.lastIndexOf(",") > core.lastIndexOf(".") ? core.replace(/\./g, "").replace(",", ".") : core.replace(/,/g, "");
    else if (core.includes(",")) core = /,\d{1,2}$/.test(core) ? core.replace(",", ".") : core.replace(/,/g, "");
    const v = Number(core);
    if (!core || Number.isNaN(v)) return null;
    return neg ? -v : v;
  };
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i];
    const f = typeof r[3] === "string" ? byName.get(r[3]) : undefined;
    if (!f || !f.ocr) continue;
    const page = typeof r[4] === "number" ? r[4] : Number(r[4]);
    const value = typeof r[5] === "number" ? r[5] : null;
    const pg = f.ocr.pages.find((p) => p.page === page);
    let hit: OcrWord | undefined;
    if (pg && value != null) {
      hit = pg.words.find((w) => { const n = asNum(w.text); return n != null && Math.abs(Math.abs(n) - Math.abs(value)) < 0.005; });
    }
    if (hit) r.push(`${hit.engine}${f.ocr.backend ? ` · ${f.ocr.backend}` : ""}`, Math.round(hit.conf * 1000) / 10 + "%", hit.bbox.map((v) => Math.round(v)).join(", "));
    else r.push(`${f.ocr.engine}${f.ocr.backend ? ` · ${f.ocr.backend}` : ""}`, pg?.status === "ocr" ? "value not located among the page's words — verify" : (pg ? `page ${pg.status}` : ""), "");
  }
  rows.push([]);
  rows.push(["OCR DOCUMENTS — every figure from these was machine-read and must be verified against the scan"]);
  rows.push(["Document", "Replaced scan", "Scan SHA-256", "Engine", "Cross-check", "Pages OCR'd", "Mean confidence", "Disputed readings", "Mode"]);
  for (const f of byName.values()) {
    const o = f.ocr!;
    const confs = o.pages.filter((p) => typeof p.confMean === "number").map((p) => p.confMean as number);
    const mean = confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 1000) / 10 + "%" : "";
    const disputed = o.pages.reduce((n, p) => n + (p.flags || []).filter((x) => x.level !== "info").length, 0);
    rows.push([f.name, o.originalName || "", o.originalSha || "", o.backend || o.engine, o.verifyEngine || "none",
               o.ocrPages.join(", "), mean, disputed, `${o.mode} · ${o.source} · ${o.at}`]);
  }
}

const PROVENANCE_KIND: Record<string, string> = {
  rule: "Keyword rule", section: "Section heading", groq: "AI mapping", manual: "Manual assignment",
};
const PROVENANCE_NOTE: Record<string, string> = {
  rule: "matched a keyword in the mapping catalogue; remap on Mapping & adjustments if wrong",
  section: "no keyword matched — placed by the statement's own section heading; confirm the line",
  groq: "booked by the AI model; verify against the source document",
  manual: "assigned by the preparer",
};

export async function buildWorkbook(ent: Entity, bytes?: Uint8Array | ArrayBuffer) {
  const zip = await JSZip.loadAsync(bytes ?? templateBytes());
  const writes = buildWrites(ent);

  // Schedule M rows move between form revisions — re-resolve label-keyed
  // writes against the template actually being patched.
  const keyed = ent.extraWrites.filter((w) => w.labelKey);
  const bySheet = new Map<string, CellWrite[]>();
  for (const w of keyed) {
    if (!bySheet.has(w.sheet)) bySheet.set(w.sheet, []);
    bySheet.get(w.sheet)!.push(w);
  }
  for (const [sheetName, ws] of bySheet) {
    const rows = await resolveTemplateRows(zip, sheetName, ws.map((w) => w.labelKey!));
    ws.forEach((w, i) => {
      const row = rows[i];
      if (row === null) return;                       // keep the provisional ref
      const col = (/^[A-Z]+/.exec(w.ref) || ["A"])[0];
      const newRef = `${col}${row}`;
      const sheet = writes[sheetName];
      if (!sheet || newRef === w.ref || sheet[w.ref] === undefined) return;
      // The re-resolved ref must pass the same formula guard as the original.
      const guard = FORMULA_REFS[sheetName];
      if (guard && guard(newRef)) { delete sheet[w.ref]; return; }
      sheet[newRef] = sheet[w.ref];
      delete sheet[w.ref];
    });
  }

  const report = await applyWrites(zip, writes, {
    mayReplaceFormula: (sheet, ref) => !!REPLACEABLE_FORMULA_REFS[sheet]?.(ref)
      || ent.extraWrites.some((w) => w.replaceFormula && w.sheet === sheet && w.ref === ref),
  });

  /* AFTER applyWrites, so the provenance describes what was actually written,
     and wrapped so it can never block a download: a work paper without its
     provenance tab is still a work paper, and refusing to generate one over a
     documentation sheet would be the wrong trade. */
  try {
    await addWorksheet(zip, "Provenance", provenanceRows(ent));
  } catch { /* the workbook is still correct without it */ }
  try {
    const attached = attachedScheduleRows(ent);
    if (attached) await addWorksheet(zip, "Attached schedules", attached);
  } catch { /* the workbook is still correct without it */ }

  // arraybuffer + explicit Blob rather than JSZip's blob writer: it is the
  // portable path and keeps the MIME type under our control.
  const buf: ArrayBuffer = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  return { blob, report };
}

function downloadBlob(blob: Blob, filename: string) {
  if (!safeDownload(blob, filename)) {
    toast("Download was blocked by the browser — open the page outside a sandboxed frame", "bad");
  }
}

/* ---------------- AI mapping (processing step 6) ---------------- */

/* The model is the LAST resort and is never trusted. It only ever sees
   captions the keyword rules could not place, and every answer it gives goes
   through the same gate a manual assignment does — plus two vetoes the rules
   cannot express:

     - a caption naming a bank account is a BALANCE, whatever the model
       thinks; "Cash management account 1234" is not income;
     - a caption printed under a section banner cannot be booked to the other
       side of the statement. That is the document contradicting the model,
       and the document wins.

   A low-confidence answer is still booked — the figure belongs somewhere, and
   an unplaced figure is worse than a flagged one — but it is flagged too, and
   the flag names the model as its author. */

/* Taxes a country charges IN PLACE OF a corporate income tax. Booked as a
   tax other than income tax they leave Schedule C line 21a empty, and with it
   Schedule E, the high-tax test and Form 8992. Known by the country (or its
   currency) and the tax's own name; nothing here is about one client. */
const IN_LIEU_INCOME_TAXES: { country: RegExp; currency: string; caption: RegExp; why: string }[] = [
  {
    country: /^belize$/i, currency: "BZD", caption: /\bbusiness\s+tax\b/i,
    why: "Belize charges business tax on gross receipts in place of a corporate income tax, so it is the corporation's income tax",
  },
];

/** Move an in-lieu income tax from line 16 to line 21a once the entity's
    country is known (step 3, after the profile is read). A caption the
    preparer has already placed on Mapping & adjustments is left alone. */
function inLieuIncomeTax(
  entityId: string,
  profile: Entity["profile"],
  review: ReviewItem[],
  rv: (item: Omit<ReviewItem, "id"> & { id?: string }) => void,
  log: string[],
): void {
  const country = String(profile.countryInc || "").trim();
  const ccy = String(profile.currency || "").trim().toUpperCase();
  const rule = IN_LIEU_INCOME_TAXES.find((r) => r.country.test(country) || (!!ccy && r.currency === ccy));
  const cur = state.entities.find((e) => e.id === entityId);
  if (!rule || !cur) return;
  const ov = cur.mapOverrides || {};
  const moving = (cur.contributions["IS:32"] || []).filter((c) =>
    c.field === "amount" && rule.caption.test(c.label || "") && ov[norm(c.label || "")] === undefined);
  if (!moving.length) return;
  const total = r2(moving.reduce((n, c) => n + c.value, 0));
  const lines = { ...cur.lines };
  const contributions = { ...cur.contributions };
  const left = (contributions["IS:32"] || []).filter((c) => !moving.includes(c));
  if (left.length) contributions["IS:32"] = left; else delete contributions["IS:32"];
  contributions["IS:62"] = [...(contributions["IS:62"] || []), ...moving];
  const l16 = r2((lines["IS:32"]?.amount ?? 0) - total);
  if (left.length || l16 !== 0) lines["IS:32"] = { ...lines["IS:32"], amount: l16 }; else delete lines["IS:32"];
  lines["IS:62"] = { ...lines["IS:62"], amount: r2((lines["IS:62"]?.amount ?? 0) + total) };
  updateEntity(entityId, { lines, contributions });
  for (const c of moving) {
    const qid = `business-tax-question-${norm(c.label || "")}`;
    for (let i = review.length - 1; i >= 0; i--) if (review[i].id === qid) review.splice(i, 1);
    rv({
      id: `in-lieu-tax-${norm(c.label || "")}`, level: "info", category: "mapping", applied: true,
      sourceLabel: c.label,
      message: `"${c.label}" ${c.value.toLocaleString()} was booked to Schedule C line 21a (income tax expense), not line 16: ${rule.why}. Schedule E, the high-tax test and Form 8992 follow it. If this entity is outside that regime, move it back to line 16 on Mapping & adjustments.`,
      target: `${SHEET.is}!F62`, source: c.docName,
    });
  }
  log.push(`${moving.map((c) => `"${c.label}"`).join(", ")} ${total.toLocaleString()} moved to Schedule C line 21a — a tax charged in place of income tax (${country || ccy})`);
}

/** A balance sheet's grand total of assets, in the languages the banners know. */
const TOTAL_ASSETS_CAPTION = /^(total\s+(of\s+)?assets|totaal\s+(der\s+)?activa|total\s+(del\s+|de\s+)?activos?|total\s+(de\s+l'|of\s+the\s+)?actif|summe\s+(der\s+)?aktiva|bilanzsumme|total\s+do\s+ativo|totale\s+(dell')?attivo)$/i;

/** "Sch C line 17" for a target or pool — the form line a preparer looks up. */
const formLineRef = (target: string) => {
  const row = POOLS[target] ? POOLS[target].rows[0] : Number(target.split(":")[1]);
  const isIs = target.startsWith("IS");
  const l = (isIs ? IS_LINES : BS_LINES).find((x) => x.row === row);
  return l ? `${isIs ? "Sch C" : "Sch F"} line ${l.ref}` : target;
};

/** Human-readable name for a template line, for messages the preparer reads. */
const targetLabel = (target: string) => {
  const spec = /^IS:/.test(target)
    ? IS_LINES.find((l) => `IS:${l.row}` === target)
    : BS_LINES.find((l) => `BS:${l.row}` === target);
  return spec ? (/^IS:/.test(target) ? "Sch C · " : "Sch F · ") + spec.label : target;
};

/* A caption naming a bank account is a balance-sheet item however plausible an
   income line looks. IBANs, account numbers and the account-type words are all
   evidence of the same thing. */
const BANK_ACCOUNT = /\biban\b|account\s*(?:#|no\.?\s|number)|\(#\d+\)|\b[a-z]{2}\d{2}[a-z]{4}\d{6,}\b|\b(?:cheque|savings|transaction|cash management)\s+account\b/i;

/** Translate a list of captions with the configured model and write them onto
    the entity. Extracted from the Translate action so the agent can run the
    same code BEFORE mapping instead of duplicating it — one translator, one
    set of guards, one place where a bad answer is refused. Returns how many
    captions were translated. */
async function translateCaptions(entityId: string, labels: string[]): Promise<number> {
  const ent = state.entities.find((e) => e.id === entityId);
  if (!ent || !labels.length) return 0;
  const raw = await groqCall([
    { role: "system", content: "You translate accounting captions into English. Reply with JSON only." },
    {
      role: "user",
      content: `Translate each caption to English. Keep accounting terminology. If already English, repeat it unchanged.\n\n${labels.map((l, i) => `${i}. ${l}`).join("\n")}\n\nReturn {"t":{"<index>":"<english>"}}`,
    },
  ], true);
  const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  const translations = { ...ent.translations };
  const failures = { ...ent.translationFailures };
  let n = 0;
  labels.forEach((label, i) => {
    const v = parsed?.t?.[String(i)];
    const value = typeof v === "string" ? v.trim() : "";
    if (value && !isServiceErrorText(value) && !(isMostlyNonLatin(label) && isMostlyNonLatin(value))) {
      translations[label] = value;
      delete failures[label];
      n++;
    } else {
      failures[label] = value
        ? "Unreadable characters or unsupported text — the model stayed in the source script."
        : "The model returned no translation — unsupported text or missing context.";
    }
  });
  updateEntity(entityId, { translations, translationFailures: failures });
  if (n) logEvent("Captions translated", `${n} caption(s) via ${state.groq.model}`, ent.name, "groq");
  return n;
}

/* ---------------- the AI Mapping & Review Agent ---------------- */
/**
 * The understanding phase — the agent's first pass, BEFORE any mapping.
 *
 * It reads what extraction and classification already produced (no document is
 * opened again), works out what each document is and what language it is in,
 * and picks out the figures that the keyword rules and the structure pass
 * would let past. Those become `agentBrief.important`, and the ones that were
 * dropped as structure are marked so step 3 surfaces them in Review instead of
 * discarding them silently.
 *
 * It decides nothing. The 5471 rules, the FX policy, the calculations and the
 * validations are untouched by it; all it changes is what they are given the
 * chance to see.
 */
async function agentUnderstand(
  entityId: string,
  mapRows: MapRow[],
  log: string[],
  /** What the run has already decided about which corporation this entity is,
      and which others the tool is about to create. */
  hints?: { self?: string | null; planned?: string[]; aliases?: string[] },
): Promise<AgentBrief | null> {
  if (state.agent?.enabled === false) return null;
  const ent = state.entities.find((e) => e.id === entityId);
  if (!ent) return null;

  /* ---- what the documents are ---- */
  const byDoc = new Map<string, MapRow[]>();
  for (const m of mapRows) {
    if (!byDoc.has(m.docId)) byDoc.set(m.docId, []);
    byDoc.get(m.docId)!.push(m);
  }
  const docs: DocBrief[] = [];
  for (const [docId, cls] of Object.entries(ent.docClasses || {})) {
    const rows = byDoc.get(docId) || [];
    const langs = new Map<string, number>();
    for (const m of rows) {
      const name = detectLanguage(m.row.label || "");
      langs.set(name, (langs.get(name) || 0) + 1);
    }
    docs.push({
      docId, name: cls.fileName, kind: cls.kind, pages: (cls.pages || []).length,
      /* The corporation the document itself names. The agent needs it to tell
         a document that belongs to another corporation (nothing wrong: page
         attribution kept it for that entity) from one that genuinely carried
         no figures. */
      entityName: cls.entityName ?? null,
      /* A statement grid never votes the year, but the period it heads its
         newest column with is still the year it reports. */
      statementYear: cls.statementYear ?? (cls.statementPeriodEnd ? Number(String(cls.statementPeriodEnd).slice(-4)) || null : null),
      periodEnd: cls.statementPeriodEnd ?? null,
      periodStart: cls.statementPeriodStart ?? null,
      rowsRead: rows.length,
      rowsWithFigures: rows.filter((m) => (m.row.values || []).some((v) => typeof v === "number" && isFinite(v))).length,
      amountRows: cls.amountRows ?? 0,
      loosePages: pagesForFeed(cls, "unassigned").size,
      rowsDropped: rows.filter((m) => !!m.skipReason).length,
      sections: [...new Set(rows.map((m) => m.section).filter(Boolean) as string[])],
      /* A statement is in the language of its ACCOUNT NAMES, not of whichever
         language most of its captions happen to score as. "Total Ingresos",
         "Total Costos" and "Depreciacion Contable" all read as English on a
         word count, so a page of Spanish accounts was reported as English
         while the same run raised a failure for its untranslated Spanish.
         One confidently non-English caption settles it, and the log and the
         failure list now read the same value. */
      language: ([...langs.entries()].filter(([n]) => n !== "English").sort((a, b) => b[1] - a[1])[0]?.[0]) || "English",
      ocr: (ent.files || []).some((f) => f.id === docId && !!f.ocr),
      feedsLineItems: ["cfc-financial-statements", "cfc-tax-return", "trial-balance"].includes(cls.kind),
    });
  }

  /* ---- what the pipeline is about to do with each figure ---- */
  const rows: AgentRow[] = mapRows
    .filter((m) => !m.row.isBanner)
    .map((m) => ({
      key: norm(m.row.label), label: m.row.label,
      english: ent.translations?.[m.row.label],
      values: (m.row.values || []) as Array<number | null>,
      years: (m.row.years || []) as Array<number | null>,
      section: m.section || undefined,
      docName: m.docName, page: m.row.page ?? null,
      dropped: m.skipReason,
      ruleMatched: matchRule(m.row.label, state.rules) !== null,
      namedTotal: matchRule(m.row.label, state.rules) === "SKIP",
    }));

  const haveModel = aiReady();
  const nodes: string[] = [];
  let result;
  try {
    const years = resolveCaseYears(ent);
    result = await runAgent(
      { phase: "understand", rows, docs, haveModel, requiredYear: years.cy, yearSource: years.source, detectedYears: years.detected,
        caseContext: buildCaseContext(ent, hints) },
      { ask: groqCall, timeoutMs: GROQ_TIMEOUT_MS }, (n) => nodes.push(n.node),
    );
  } catch (err) {
    log.push(`${AGENT_NAME}: the understanding pass did not finish — ${(err as Error)?.message || String(err)}`);
    return null;
  }
  for (const note of result.notes) log.push(note);

  /* ---- translate before mapping, not after ----
     Mapping reads the English; a translation that arrives after the rules have
     run is a translation nobody mapped through. */
  const failures: AgentFailure[] = [...result.failures];
  let translated = 0;
  const language = docs.length ? (docs.find((d) => d.language !== "English")?.language || "English") : "English";
  if (language !== "English") {
    const todo = rows.map((r) => r.label).filter((l) => l && !ent.translations?.[l]);
    if (todo.length && haveModel) {
      try {
        translated = await translateCaptions(entityId, [...new Set(todo)]);
        log.push(`${AGENT_NAME}: ${translated} ${language} caption(s) translated before mapping, so the rules read the English`);
      } catch (err) {
        failures.push({
          stage: "translate", what: `${todo.length} ${language} caption(s) could not be translated`,
          reason: (err as Error)?.message || String(err),
          action: "Use the Translate buttons on the Multilingual evidence tab, then re-process. Until then these captions are matched in their own language only.",
        });
      }
    } else if (todo.length) {
      failures.push({
        stage: "translate", what: `${todo.length} ${language} caption(s) were not translated`,
        reason: "no AI key is configured, and translation before mapping needs one",
        action: "Add a Groq key on Settings ▸ AI platform, or translate on the Multilingual evidence tab and re-process.",
      });
    }
  }

  /* ---- tell the rules engine what not to throw away ---- */
  let surfaced = 0;
  for (const item of result.important) {
    if (item.risk !== "dropped-as-structure") continue;
    for (const m of mapRows) {
      if (norm(m.row.label) !== item.key || !m.skipReason) continue;
      m.agentImportant = item.why;
      surfaced++;
    }
  }
  if (surfaced) log.push(`${AGENT_NAME}: ${surfaced} row(s) dropped as structure are carried into Review instead — the agent reads them as line items`);

  const brief: AgentBrief = {
    at: new Date().toLocaleString(),
    requiredYear: result.requiredYear,
    yearSource: result.yearSource,
    detectedYears: result.detectedYears,
    yearReason: caseYearReason(resolveCaseYears(ent)),
    docs: result.docs, language, important: result.important, failures,
    risks: result.risks || [],
    notes: result.notes, steps: nodes, translated,
  };
  updateEntity(entityId, { agentBrief: brief });
  return brief;
}

/** What the agent needs in order to see past this one entity: every foreign
    corporation the documents name, and whether the case already has an entity
    for it. Built from the documents themselves, so it holds for any client
    whose papers cover more than one corporation. */
function buildCaseContext(ent: Entity, hints?: { self?: string | null; planned?: string[]; aliases?: string[] }): CaseContext {
  const corporations: CaseContext["corporations"] = [];
  const seen = new Set<string>();
  /* "Entity 1" is the card's placeholder, not a corporation. Read as one, it
     matched nothing and every document in the case looked like it belonged to
     somebody else. */
  const real = (n: string) => (/^entity \d+$/i.test(n.trim()) ? "" : n.trim());
  const aliases = [...(hints?.aliases || []), ...state.entities.flatMap((e) => e.nameAliases || [])]
    .map((n) => String(n || "").trim()).filter(Boolean);
  const known = state.entities
    .map((e) => real(String(e.profile.legalName || e.profile.entityShort || e.name || "")))
    .filter(Boolean)
    /* The corporation this run has already chosen for itself, and the ones the
       tool is about to create as siblings, are accounted for — flagging them
       as missing would be the agent objecting to work already in hand. */
    .concat([hints?.self || ""], hints?.planned || [])
    /* The names the same company prints its papers under are its own. */
    .concat(aliases)
    .filter(Boolean);
  const add = (name: string, source: string, refId?: string | null) => {
    const clean = String(name || "").trim();
    if (!clean || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    corporations.push({
      name: clean, source, refId: refId ?? null,
      hasEntity: known.some((k) => entitySimilarity(k, clean) >= 0.5),
    });
  };
  for (const cls of Object.values(ent.docClasses || {})) {
    if (cls.duplicateOf) continue;
    /* One prior-year return can carry a Form 5471 per corporation. Each block
       names its own, and each one is a separate filing. */
    for (const b of cls.blocks5471 || []) if (b.cfcName) add(b.cfcName, cls.fileName, b.referenceIds?.[0]);
    if (cls.entityName) add(cls.entityName, cls.fileName, null);
  }
  return {
    corporations,
    entityName: real(String(ent.profile.legalName || ent.profile.entityShort || "")) || hints?.self || null,
    mayCreateEntity: true,
    aliases,
  };
}



/** Everything the Settings panel shows about the agent, from the graph and
    the constants that define it rather than from prose typed into a view. */
export const agentInfo = () => ({
  name: AGENT_NAME,
  framework: AGENT_FRAMEWORK,
  provider: AGENT_PROVIDER,
  /* The agent shares the Groq credential — there is no second key anywhere in
     this application, and the key itself is never read back into the panel. */
  connected: aiReady(),
  keySource: useProxy() ? "this deployment's server key" : state.groq.key ? "your key in Settings ▸ AI platform" : "none configured",
  model: state.groq.model,
  enabled: state.agent?.enabled !== false,
  can: AGENT_CAN,
  cannot: AGENT_CANNOT,
  steps: AGENT_GRAPH.nodes,
  lastRun: state.agent?.lastRun,
});

export type AgentRunResult = { considered: number; accepted: number; exceptions: number; findings: number; ranModel: boolean };

/**
 * Run the agent over the captions the deterministic rules could not place.
 *
 * It sits between translation and the 5471 rules: it reads only what earlier
 * stages already cached, and it finishes with suggestions and findings. Every
 * accepted suggestion is then offered to `manualApply` — the same gate a
 * preparer's own assignment passes, with the same two document vetoes the AI
 * pass uses — so the rules, the FX policy, the calculations and the
 * validations all still decide. Everything else becomes a review item with
 * its document, page and figures attached.
 */
async function agentRun(entityId: string, log?: string[]): Promise<AgentRunResult> {
  const messages = log || [];
  const nothing: AgentRunResult = { considered: 0, accepted: 0, exceptions: 0, findings: 0, ranModel: false };
  const ent = state.entities.find((e) => e.id === entityId);
  if (!ent) return nothing;
  if (state.agent?.enabled === false) return nothing;

  const candidates = ent.unmatched.filter(
    (row) => /No mapping rule matches/.test(row.reason || "") && !(ent.mapOverrides && ent.mapOverrides[norm(row.label)]),
  );
  /* No early return on an empty list: a balance sheet can be out by a figure
     with every caption mapped, and the review phase below is the only thing
     that reads it back. With no candidates the mapping phase costs nothing —
     the graph's router sends an empty row list straight past the model. */

  const rows: AgentRow[] = candidates.map((row) => ({
    key: norm(row.label),
    label: row.label,
    english: ent.translations?.[row.label],
    values: (row.values || []) as Array<number | null>,
    years: (row.years || []) as Array<number | null>,
    section: row.section || undefined,
    docName: row.docName,
    docKind: row.docId && ent.docClasses?.[row.docId] ? ent.docClasses[row.docId].kind : undefined,
    page: row.page ?? null,
  }));

  const catalogue = [
    ...IS_LINES.map((l) => `IS:${l.row} = ${l.label}${l.row === 12 ? " (cost of goods sold ONLY — operating overheads belong on IS:34-50 other deductions)" : ""}`),
    ...BS_LINES.map((l) => `BS:${l.row} = ${l.label}`),
  ].join("\n");

  const haveModel = aiReady();
  if (!haveModel && rows.length) {
    messages.push(`${AGENT_NAME}: running its document checks only — no AI key available, so no mapping is suggested (add one in Settings ▸ AI platform)`);
  }

  const nodes: string[] = [];
  let result;
  try {
    result = await runAgent(
      { rows, catalogue, targets: [...VALID_TARGETS], occupied: Object.keys(ent.lines || {}), haveModel },
      { ask: groqCall, timeoutMs: GROQ_TIMEOUT_MS },
      (note) => nodes.push(note.node),
    );
  } catch (err) {
    messages.push(`${AGENT_NAME} did not finish — ${(err as Error)?.message || String(err)}`);
    return nothing;
  }
  for (const note of result.notes) messages.push(note);
  if (result.failure) messages.push(`${AGENT_NAME}: the model stopped answering — ${result.failure}`);

  /* ---- hand the accepted suggestions to the existing mapping gate ---- */
  const fresh = state.entities.find((e) => e.id === entityId);
  if (!fresh) return nothing;
  const lines = { ...fresh.lines };
  const sourceLabels = { ...fresh.sourceLabels };
  const contributions = { ...fresh.contributions };
  const relabels = { ...fresh.relabels };
  const mapOverrides = { ...fresh.mapOverrides };
  const byKey = new Map<string, AgentSuggestion>(result.suggestions.map((sg) => [sg.key, sg]));
  const stillUnmatched: Entity["unmatched"] = [];
  const flags: ReviewItem[] = [];
  let accepted = 0, exceptions = 0;

  /* Every candidate the agent read is marked, whether or not it produced an
     answer: the AI mapping pass that follows uses the same two prompts, so
     re-asking the same caption would spend the tokens twice to reach the
     answer the agent already has. */
  const readKeys = new Set(rows.map((r) => r.key));
  for (const row of fresh.unmatched) {
    const key = norm(row.label);
    const sg = /No mapping rule matches/.test(row.reason || "") ? byKey.get(key) : undefined;
    if (!sg) {
      stillUnmatched.push(haveModel && readKeys.has(key) ? { ...row, agentSeen: true } : row);
      continue;
    }
    const seen = { ...row, agentSeen: haveModel };

    const refuse = (why: string) => {
      exceptions++;
      const original = row.originalReason || row.reason;
      stillUnmatched.push({
        ...seen,
        originalReason: original,
        aiProposal: sg.target ? { to: sg.target, confidence: sg.confidence, reason: sg.rationale, refused: true } : undefined,
        reason: `${original} · ${why}`,
      });
    };

    if (sg.status !== "accepted" || !sg.target) {
      refuse(sg.target
        ? `the agent suggested ${targetLabel(sg.target)} but ${sg.issue || "was not confident"} — left for you to assign.`
        : `the agent read it as “${sg.rationale || "not a work paper line"}” and named no line — left for you to assign.`);
      continue;
    }
    /* The two document vetoes. A caption naming a bank account is a balance
       whatever the model says, and a caption printed under a banner cannot
       cross to the other side of the accounts. The document wins. */
    if (/^IS:/.test(sg.target) && BANK_ACCOUNT.test(row.label || "")) {
      refuse(`the agent suggested ${targetLabel(sg.target)}, but the caption names a bank account — a balance, not income or expense; refused.`);
      continue;
    }
    if (isTaxRegisterCaption(row.label || "")) {
      refuse(`the agent suggested ${targetLabel(sg.target)}, but the caption is a tax-register balance (a tax attribute such as RAI, REX, SAC, STUT, CPT, RLI, PPM or a prior-year tax loss), not an income, expense or book balance of the year — refused.`);
      continue;
    }
    if (row.section && !sectionOk(row.section, sg.target)) {
      refuse(`the agent suggested ${targetLabel(sg.target)} but the caption was printed under the "${row.section}" banner — refused as a documentary contradiction.`);
      continue;
    }
    const sideVeto = statementSideVeto(row.reason, sg.target);
    if (sideVeto) { refuse(`the agent suggested ${targetLabel(sg.target)}, but ${sideVeto}`); continue; }
    const dbl = figureAlreadyBooked(contributions, sg.target, row);
    if (dbl !== null) {
      refuse(`the agent suggested ${targetLabel(sg.target)} for ${dbl.toLocaleString()}, but that figure is already booked to the same line from page ${row.page} of the same document — one amount, read twice, so it was NOT added again.`);
      continue;
    }
    if (!manualApply(fresh, lines, contributions, relabels, sg.target, row, "groq")) {
      refuse(VALID_TARGETS.has(sg.target)
        ? `the agent suggested ${targetLabel(sg.target)} but the row has no single unambiguous current-year figure to book — enter it on the line directly.`
        : `the agent named a line id that does not exist (${sg.target}) — ignored.`);
      continue;
    }
    sourceLabels[sg.target] = { label: row.label, values: row.values, years: row.years };
    mapOverrides[key] = { to: sg.target };
    accepted++;
    if (sg.confidence !== "high") {
      flags.push({
        id: `agent-medium-${key}`, level: "warn", category: "mapping", applied: true, sourceLabel: row.label,
        message: `${AGENT_NAME}: “${row.label}” was placed on ${targetLabel(sg.target)} with MEDIUM confidence${sg.rationale ? ` — ${sg.rationale}` : ""}. Evidence: ${citeEvidence(sg.evidence)}. The figure is booked; check the line before filing or remap it on Mapping & adjustments.`,
        source: row.docName,
      });
    }
  }

  /* ---- findings go to the Review / Exception Centre ---- */
  /* One caption can raise two findings of a kind (unsure AND landing on a
     line the rules already filled). Review items are keyed by id and merged
     by id across re-processing, so a collision would silently drop one. */
  const usedIds = new Set(flags.map((f) => f.id));
  for (const f of result.findings) {
    let id = `agent-${f.kind}-${f.key || "x"}`;
    for (let n = 2; usedIds.has(id); n++) id = `agent-${f.kind}-${f.key || "x"}-${n}`;
    usedIds.add(id);
    flags.push({
      id,
      level: f.kind === "missing" ? "info" : "warn",
      category: f.kind === "terminology" ? "consistency" : "mapping",
      applied: false,
      sourceLabel: f.caption,
      message: `${AGENT_NAME}: ${f.message}${f.evidence ? ` Evidence: ${citeEvidence(f.evidence)}.` : ""}`,
    });
  }
  /* ---- the review phase: read the booked balance sheet back ----
     Deterministic, so it runs with or without a key. This is where a missing
     cash line, fixed assets with no depreciation, an equity that does not tie
     and an assumed period end are caught — and named with the caption or the
     figure behind them, rather than left as "out by N". */
  const leftovers: AgentRow[] = stillUnmatched.map((row) => ({
    key: norm(row.label), label: row.label,
    english: fresh.translations?.[row.label],
    values: (row.values || []) as Array<number | null>,
    years: (row.years || []) as Array<number | null>,
    section: row.section || undefined, docName: row.docName, page: row.page ?? null,
  }));
  let assetsEoy = 0, liabEquityEoy = 0, equityEoy = 0;
  const filledTargets: string[] = [];
  for (const spec of BS_LINES) {
    const target = `BS:${spec.row}`;
    const v = lines[target];
    const eoy = typeof v?.eoy === "number" ? v.eoy : typeof v?.amount === "number" ? v.amount : null;
    if (eoy === null || !isFinite(eoy)) continue;
    filledTargets.push(target);
    if (/assets/i.test(spec.group)) assetsEoy += eoy;
    else {
      liabEquityEoy += eoy;
      if (spec.row >= 58) equityEoy += eoy;
    }
  }
  for (const key of Object.keys(lines)) if (/^IS:/.test(key)) filledTargets.push(key);
  /* This year's accounts first: a prior-year return also states a period
     end, but it is last year's. */
  const periodDocs = Object.values(fresh.docClasses || {}).filter((c) => c.statementPeriodEnd && !c.duplicateOf);
  const stmtDoc = periodDocs.find((c) => c.kind !== "prior-year-us-return") ?? periodDocs[0];
  const brief = fresh.agentBrief;
  const facts = {
    cyEnd: fresh.profile.cyEnd,
    cyEndSource: fresh.detected?.cyEnd?.sourceLabel,
    statementPeriodEnd: stmtDoc?.statementPeriodEnd ?? null,
    statementDoc: stmtDoc?.fileName,
    assetsEoy: r2(assetsEoy), liabEquityEoy: r2(liabEquityEoy), equityEoy: r2(equityEoy),
    filled: filledTargets,
    /* Closing the loop on the understanding phase: what it said mattered,
       against what the run actually did with it. */
    important: brief?.important || [],
    bookedKeys: [...new Set(Object.values(contributions).flat().map((c) => norm(c.label || "")))],
    unmatchedKeys: stillUnmatched.map((u) => norm(u.label)),
    failures: brief?.failures || [],
  };
  try {
    const review = await runAgent({ phase: "review", rows: leftovers, facts }, { ask: groqCall, timeoutMs: GROQ_TIMEOUT_MS }, (n) => nodes.push(n.node));
    for (const note of review.notes) messages.push(note);
    // The brief carries the outcomes back, so the activity view shows what
    // happened to each item rather than only what was flagged.
    if (brief) updateEntity(entityId, { agentBrief: { ...brief, important: review.important } });
    for (const f of review.findings) {
      let id = `agent-${f.kind}-${f.key || "x"}`;
      for (let n = 2; usedIds.has(id); n++) id = `agent-${f.kind}-${f.key || "x"}-${n}`;
      usedIds.add(id);
      flags.push({
        id, level: "warn",
        category: f.kind === "period" ? "consistency" : f.kind === "failure" || f.kind === "unused" ? "process" : "tie-out",
        applied: false, sourceLabel: f.caption,
        message: `${AGENT_NAME}: ${f.message}${f.evidence ? ` Evidence: ${citeEvidence(f.evidence)}.` : ""}`,
      });
      result.findings.push(f);
    }
  } catch (err) {
    messages.push(`${AGENT_NAME}: the balance review did not run — ${(err as Error)?.message || String(err)}`);
  }

  const flagIds = new Set(flags.map((f) => f.id));
  updateEntity(entityId, {
    lines, relabels, sourceLabels, contributions, mapOverrides,
    unmatched: stillUnmatched,
    reviewItems: [...fresh.reviewItems.filter((r) => !flagIds.has(r.id)), ...flags],
  });
  messages.push(`${AGENT_NAME}: ${accepted} caption(s) accepted by the 5471 mapping rules · ${exceptions} sent to Review & exceptions · ${result.findings.length} finding(s)`);
  if (accepted || result.findings.length) {
    logEvent("AI agent review", `${accepted} caption(s) mapped · ${exceptions} exception(s) · ${result.findings.length} finding(s) (${AGENT_FRAMEWORK} · ${state.groq.model})`, fresh.name, "groq");
  }
  set({
    agent: {
      ...state.agent,
      lastRun: {
        at: new Date().toLocaleString(), entity: fresh.name,
        considered: rows.length, accepted, exceptions: exceptions,
        findings: result.findings.length, nodes,
      },
    },
  });
  return { considered: rows.length, accepted, exceptions: exceptions, findings: result.findings.length, ranModel: haveModel };
}

export type AiRunResult = { applied: number; considered: number; low: number; left: number };

/**
 * Map the leftovers with the model. Runs as step 6 of processing, and again
 * on demand from the mapping screen.
 *
 * @param log  when given, messages are appended to the caller's log instead of
 *             the entity's — processing owns its log until the step ends.
 * @param forced  a manual run; ignores the auto-map preference.
 */
async function aiRun(entityId: string, log?: string[], forced?: boolean): Promise<AiRunResult> {
  const messages = log || [];
  const ent = state.entities.find((e) => e.id === entityId);
  const nothing: AiRunResult = { applied: 0, considered: 0, low: 0, left: 0 };
  if (!ent) return nothing;
  if (!forced && state.groq.autoMap === false) return nothing;

  const profileCands = ent.unmatchedProfile || [];
  /* Only captions the RULES could not place, and only where the preparer has
     not already decided. An override is a human decision; re-proposing over it
     would undo their work on every re-process. */
  const rows = ent.unmatched
    .map((row) => ({ row }))
    .filter((x) => /No mapping rule matches/.test(x.row.reason || "") && !x.row.agentSeen && !(ent.mapOverrides && ent.mapOverrides[norm(x.row.label)]));
  if (!rows.length && !profileCands.length) return nothing;

  if (!aiReady()) {
    messages.push("AI mapping skipped — no AI key available: this deployment has no server key and none is configured in Settings ▸ AI platform");
    if (!log) updateEntity(entityId, { log: [...ent.log, ...messages] });
    return { ...nothing, left: rows.length + profileCands.length };
  }

  let applied = 0, considered = 0, low = 0, left = 0;
  let failure: string | null = null;

  /* ---- the line-item pass ---- */
  if (rows.length) {
    const catalogue = [
      ...IS_LINES.map((l) => `IS:${l.row} = ${l.label}${l.row === 12 ? " (cost of goods sold ONLY — operating overheads belong on IS:34-50 other deductions)" : ""}`),
      ...BS_LINES.map((l) => `BS:${l.row} = ${l.label}`),
    ].join("\n");
    const answers = new Map<string, Proposal>();

    const ask = async (batchRows: typeof rows, rich: boolean) => {
      const send = async (batch: typeof rows) => {
        considered += batch.length;
        /* Two passes over the same captions, cheap then thorough. The first
           sends captions alone; the second adds the amounts, the year tags,
           the source document and the section banner, and tells the model
           that an "other" line is an acceptable answer. Sending everything to
           everything costs four times the tokens for the ~15% that need it. */
        const body = rich
          ? batch.map((x, i) =>
              `${i}. ${x.row.label} | amounts: ${(x.row.values || []).join(", ")} | year tags: ${(x.row.years || []).map((y) => y ?? "none").join(", ")} | from: ${x.row.docName || "document"}${x.row.page ? " p." + x.row.page : ""}${x.row.section ? ` | printed under the “${x.row.section}” banner (only map to that side)` : ""} | the keyword rules could not place it`).join("\n")
          : batch.map((x, i) => `${i}. ${x.row.label}${x.row.section ? ` [section: ${x.row.section}]` : ""}`).join("\n");
        const preamble = rich
          ? "These captions were not resolved on the first attempt. Use the amounts, year tags and source document as extra evidence, and pick the closest reasonable line — an \"Other income\" or \"Other deduction\" line is a valid answer for an item that fits nowhere else. Only use null when the caption is a subtotal, a total, or not a financial line at all.\n\n"
          : "";
        return parseMap(await groqCall([
          { role: "system", content: "You map trial-balance labels onto US Form 5471 work paper lines. Reply with JSON only." },
          { role: "user", content: `${preamble}Worked examples (same schema): "Creditors" -> {"t":"BS:46","c":"high","r":"trade payables"} · "Salaries and social security" -> {"t":"IS:26","c":"high","r":"personnel cost"} · "Depreciation of tangible fixed assets" -> {"t":"IS:30","c":"high","r":"depreciation"} · "Total operating costs" -> {"t":null,"c":"high","r":"subtotal"} · "Result before taxation" -> {"t":null,"c":"high","r":"subtotal"}\n\nAvailable targets:\n${catalogue}\n\nLabels to map:\n${body}\n\nReturn JSON only: {"map":{"<index>":{"t":"<target id or null>","c":"high|medium|low","r":"<short reason, max 12 words>"}}}. Use null for t when no target fits. c is your confidence that the mapping is correct.` },
        ], true, { maxTokens: maxTokensFor(batch.length), timeoutMs: 2 * GROQ_TIMEOUT_MS }));
      };
      const stopped = await askResume(
        batchRows, send,
        (batch, map) => batch.forEach((x, i) => {
          const p = norm1((map as Record<string, unknown>)[String(i)]);
          if (p && p.t) answers.set(norm(x.row.label), p);
        }),
        (m) => messages.push(m),
      );
      if (stopped) failure = stopped.message || String(stopped);
    };

    await ask(rows, false);
    // Pass two for anything unresolved OR merely low-confidence. A blank in
    // pass two never erases a pass-one answer: `answers` is only ever written
    // when the model returns a target.
    const retry = rows.filter((x) => {
      const p = answers.get(norm(x.row.label));
      return !p || !p.t || !aiOk(p);
    });
    if (retry.length && !failure) await ask(retry, true);

    const fresh = state.entities.find((e) => e.id === entityId);
    if (fresh && answers.size) {
      const lines = { ...fresh.lines };
      const sourceLabels = { ...fresh.sourceLabels };
      const contributions = { ...fresh.contributions };
      const relabels = { ...fresh.relabels };
      const mapOverrides = { ...fresh.mapOverrides };
      const stillUnmatched: Entity["unmatched"] = [];
      const flags: ReviewItem[] = [];
      const booked = new Set<string>();

      for (const row of fresh.unmatched) {
        const key = norm(row.label);
        const p = /No mapping rule matches/.test(row.reason || "") ? answers.get(key) : undefined;
        if (!p || !p.t) { stillUnmatched.push(row); continue; }

        const refuse = (why: string) => {
          const original = row.originalReason || row.reason;
          stillUnmatched.push({
            ...row,
            originalReason: original,
            aiProposal: { to: p.t!, confidence: p.c, reason: p.r, refused: true },
            reason: `${original} · ${why}`,
          });
        };

        if (/^IS:/.test(p.t) && BANK_ACCOUNT.test(row.label || "")) {
          refuse(`AI proposed ${targetLabel(p.t)}, but the caption names a bank account — a balance, not income or expense; refused.`);
          continue;
        }
        if (isTaxRegisterCaption(row.label || "")) {
          refuse(`AI proposed ${targetLabel(p.t)}, but the caption is a tax-register balance (a tax attribute such as RAI, REX, SAC, STUT, CPT, RLI, PPM or a prior-year tax loss), not an income, expense or book balance of the year — refused; place it yourself only if it belongs on the work paper.`);
          continue;
        }
        if (row.section && !sectionOk(row.section, p.t)) {
          refuse(`AI proposed ${targetLabel(p.t)} but the caption was printed under the "${row.section}" banner — refused as a documentary contradiction.`);
          continue;
        }
        const side = statementSideVeto(row.reason, p.t);
        if (side) { refuse(`AI proposed ${targetLabel(p.t)}, but ${side}`); continue; }
        const twice = figureAlreadyBooked(contributions, p.t, row);
        if (twice !== null) {
          refuse(`AI proposed ${targetLabel(p.t)} for ${twice.toLocaleString()}, but that figure is already booked to the same line from page ${row.page} of the same document — one amount, read twice, so it was NOT added again.`);
          continue;
        }
        if (!manualApply(fresh, lines, contributions, relabels, p.t, row, "groq")) {
          // manualApply is the same gate a human assignment passes, so an
          // invalid or unbookable target fails here rather than in the sheet.
          /* A VALID target that manualApply still refused means the row
             itself cannot be booked — several figures and no year identity —
             rather than the model naming a line that does not exist. Two
             different problems, two different messages. */
          refuse(VALID_TARGETS.has(p.t)
            ? `AI proposed ${targetLabel(p.t)} but the row has no single unambiguous current-year figure to book — enter it on the line directly.`
            : `AI proposed an invalid line id (${p.t}) — ignored.`);
          continue;
        }

        sourceLabels[p.t] = { label: row.label, values: row.values, years: row.years };
        mapOverrides[key] = { to: p.t };
        booked.add(key);
        applied++;
        if (!aiOk(p)) {
          low++;
          flags.push({
            id: `ai-low-${key}`, level: "warn", category: "mapping", applied: true,
            message: `“${row.label}” was mapped to ${targetLabel(p.t)} by the model with LOW confidence${p.r ? " — " + p.r : ""}. The figure is booked; verify the line before filing or remap it on Mapping & adjustments.`,
            source: row.docName,
          });
        }
      }

      left = rows.filter((x) => !booked.has(norm(x.row.label))).length;
      const flagIds = new Set(flags.map((f) => f.id));
      updateEntity(entityId, {
        lines, relabels, sourceLabels, contributions, mapOverrides,
        unmatched: stillUnmatched,
        reviewItems: [...fresh.reviewItems.filter((r) => !flagIds.has(r.id)), ...flags],
      });
      messages.push(`AI mapping: ${applied} caption(s) mapped${low ? ` (${low} low-confidence — flagged for review)` : ""}${left ? ` · ${left} could not be placed` : ""}`);
      if (applied) logEvent("AI mapping applied", `${applied} caption(s) mapped, ${low} flagged low-confidence (${state.groq.model})`, fresh.name, "groq");
    } else if (fresh && rows.length) {
      left = rows.length;
      if (!failure) messages.push(`AI mapping: the model reviewed ${rows.length} caption(s) but could not place any of them — they remain in the Review tab`);
    }
  }

  /* ---- the profile pass ---- */
  /* The model names a FIELD; the value is always the document's own. It never
     invents one, and two type guards refuse rather than write: a date field
     that did not parse as a date, and a currency that is not a 3-letter code.
     Only blank fields are filled — a value already present was either read
     with a matcher or typed by the preparer, and both outrank a proposal. */
  if (profileCands.length && !failure) {
    const fields = [...PROFILE_FIELDS, ...OWNERSHIP_FIELDS];
    const catalogue = fields.map((f) => `${f.key} = ${f.label}`).join("\n");
    const answers = new Map<string, Proposal>();

    const send = async (batch: ProfileCandidate[]) => {
      considered += batch.length;
      return parseMap(await groqCall([
        { role: "system", content: "You map document captions onto the entity-profile fields of a US Form 5471 work paper. Reply with JSON only." },
        { role: "user", content: `Available fields:\n${catalogue}\n\nCaptions from the client documents (caption => adjacent value):\n${batch.map((c, i) => `${i}. ${c.caption} => ${String(c.value).slice(0, 60)}`).join("\n")}\n\nReturn JSON only: {"map":{"<index>":{"k":"<field key or null>","c":"high|medium|low","r":"<short reason, max 12 words>"}}}. Use null for k when no field matches. Never guess a value - you only name the field the caption denotes.` },
      ], true, { maxTokens: maxTokensFor(batch.length), timeoutMs: 2 * GROQ_TIMEOUT_MS }));
    };
    const stopped = await askResume(
      profileCands, send,
      (batch, map) => batch.forEach((c, i) => {
        const p = norm1((map as Record<string, unknown>)[String(i)]);
        if (p) answers.set(c.norm, p);
      }),
      (m) => messages.push(m.replace("AI mapping", "AI profile")),
    );
    if (stopped) failure = stopped.message || String(stopped);

    const fresh = state.entities.find((e) => e.id === entityId);
    if (fresh && answers.size) {
      const profile = { ...fresh.profile };
      const ownership = { ...fresh.ownership };
      const detected = { ...fresh.detected };
      const stillUnmatched: ProfileCandidate[] = [];
      const flags: ReviewItem[] = [];
      let filled = 0;
      let currencyChanged = false;

      const profileCaptionNorms = new Set((fresh.unmatchedProfile || []).map((c) => norm(c.caption)));
      for (const cand of fresh.unmatchedProfile || []) {
        const p = answers.get(cand.norm);
        if (!p || !p.t) { stillUnmatched.push(cand); continue; }
        const spec = fields.find((f) => f.key === p.t);
        if (!spec) { stillUnmatched.push(cand); continue; }

        const target = PROFILE_FIELDS.some((f) => f.key === p.t) ? profile : ownership;
        const clean = cleanFor(p.t);
        const value = clean ? clean(cand.value) : cand.value;
        if (value === null || String(value).trim() === "") { stillUnmatched.push(cand); continue; }

        if (/^(cyEnd|pyEnd|formed)$/.test(p.t) && !looksLikeDate(value)) {
          stillUnmatched.push(cand);
          flags.push({
            id: `ai-profile-bad-${norm(cand.caption)}`, level: "warn", category: "profile", applied: false,
            message: `“${cand.caption}” was read as ${spec.label} = “${String(value).slice(0, 48)}” by the model, which does not parse as a date — NOT applied. Enter it in Basic Information if known.`,
            source: cand.src?.doc || undefined,
          });
          continue;
        }
        /* A form caption in the value position: the model was handed a
           caption row ("Región | Capital Efectivo") and named the second
           caption as the first one's value. */
        if (profileCaptionNorms.has(norm(String(value))) || /^\d{1,4}\s+\D+$/.test(String(value).trim())) {
          stillUnmatched.push(cand);
          flags.push({
            id: `ai-profile-bad-${norm(cand.caption)}`, level: "warn", category: "profile", applied: false,
            message: `“${cand.caption}” was read as ${spec.label} = “${String(value).slice(0, 48)}” by the model, but that is another caption printed on the same form, not a value — NOT applied. Enter it in Basic Information if known.`,
            source: cand.src?.doc || undefined,
          });
          continue;
        }
        if (p.t === "currency" && !/^[A-Za-z]{3}$/.test(String(value).trim())) {
          stillUnmatched.push(cand);
          flags.push({
            id: `ai-profile-bad-${norm(cand.caption)}`, level: "warn", category: "profile", applied: false,
            message: `“${cand.caption}” was read as Functional currency = “${String(value).slice(0, 48)}”, which is not a 3-letter code — NOT applied.`,
            source: cand.src?.doc || undefined,
          });
          continue;
        }
        if (target[p.t]) continue;    // already known; a proposal never overwrites

        target[p.t] = String(value);
        detected[p.t] = {
          key: p.t, value: String(value), sourceLabel: cand.caption,
          confidence: p.c === "high" ? "high" : "medium",
          src: { ...cand.src, label: cand.caption, via: "groq" },
        };
        if (p.t === "currency") currencyChanged = true;
        filled++;
        applied++;
        if (!aiOk(p)) {
          low++;
          flags.push({
            id: `ai-profile-${norm(cand.caption)}`, level: "warn", category: "profile", applied: true,
            message: `“${cand.caption}” was read as ${spec.label} = ${String(value)} by the model with LOW confidence${p.r ? " — " + p.r : ""}. It is filled in; verify it in Basic Information before filing.`,
            source: cand.src?.doc || undefined,
          });
        }
      }

      const flagIds = new Set(flags.map((f) => f.id));
      updateEntity(entityId, {
        profile, ownership, detected, unmatchedProfile: stillUnmatched,
        reviewItems: [...fresh.reviewItems.filter((r) => !flagIds.has(r.id)), ...flags],
      });
      if (filled) {
        messages.push(`AI mapped ${filled} entity detail(s) from document captions`);
        logEvent("AI profile mapping applied", `${filled} entity detail(s) filled (${state.groq.model})`, fresh.name, "groq");
      }
      // A currency the model supplied changes which rates apply.
      if (currencyChanged) actions.autoFillRates(entityId, false);
    }
  }

  if (failure) {
    const cur = state.entities.find((e) => e.id === entityId);
    if (cur) {
      updateEntity(entityId, {
        reviewItems: [...cur.reviewItems.filter((r) => r.id !== "ai-error"), {
          id: "ai-error", level: "warn", category: "mapping", applied: false,
          message: `AI mapping could not complete — ${String(failure).slice(0, 300)}. The remaining captions are in the Review tab; fix the issue and run "Map remaining captions with AI".`,
        }],
      });
    }
    toast("AI mapping problem — " + String(failure).slice(0, 140), "bad");
  }

  if (!log) {
    const cur = state.entities.find((e) => e.id === entityId);
    if (cur && messages.length) updateEntity(entityId, { log: [...cur.log, ...messages] });
  }
  return { applied, considered, low, left };
}

/* ---------------- talking to the model ---------------- */

/** Where the key comes from, from what the backend has told us. */
export function aiState(): AiMode {
  try {
    const s = sessionSnapshot();
    return aiMode(!!s.remote, s.connected === null ? undefined : s.connected, s.aiProxy === true);
  } catch {
    return "personal";
  }
}

const useProxy = () => aiState() === "proxy";

/** True when a request can actually be made — the proxy will supply the key,
    or the preparer has entered one. Checked before a run rather than after,
    so the log says "skipped, no key" instead of failing 25 times. */
export const aiReady = () => useProxy() || !!state.groq.key;

const groqEndpoint = () => (useProxy() ? `${apiBase()}/api/ai/chat` : "https://api.groq.com/openai/v1/chat/completions");

function groqHeaders(): Record<string, string> {
  if (!useProxy()) return { "Content-Type": "application/json", Authorization: "Bearer " + state.groq.key };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Never the API key itself: in proxy mode the browser has no key, and the
  // backend authenticates the BROWSER instead.
  try {
    const token = sessionSnapshot().aiToken;
    if (token) headers["X-AI-Proxy-Token"] = token;
  } catch { /* no session yet */ }
  return headers;
}

/** A transient condition worth showing while it lasts, without turning the
    panel red — a rate-limit pause is not an error. */
function groqNote(text: string, patch?: Partial<GroqState>) {
  set({ groq: { ...state.groq, notice: text || "", noticeAt: text ? Date.now() : null, ...(patch || {}) } });
}

const GROQ_TIMEOUT_MS = 12000;

/**
 * One request to the model, with the whole failure surface handled.
 *
 * Every throw carries `kind`, `status` and `retryMs` so askResume can decide
 * what to do without re-parsing the message. A transient failure deliberately
 * leaves `status` and `lastError` as they were: a retry that then succeeds
 * should not have left the panel red in the meantime.
 */
async function groqCall(
  messages: Array<{ role: string; content: string }>,
  jsonMode = false,
  opts?: { maxTokens?: number; timeoutMs?: number },
): Promise<string> {
  const priorStatus = state.groq.status === "testing" ? "online" : state.groq.status;
  const maxTokens = opts?.maxTokens || 1500;

  // Wait for room in the per-minute budget rather than being refused. The
  // estimate is recorded BEFORE the request, so parallel calls see it.
  const estimate = estTokens(messages, maxTokens);
  const wait = tpmWaitMs(estimate);
  if (wait > 0) {
    groqNote(`Pausing ${Math.ceil(wait / 1000)}s so the request fits the model’s ${TPM_BUDGET.toLocaleString("en-US")} tokens-per-minute limit…`);
    await sleep(wait);
  }
  tpmNote(estimate);

  const t0 = Date.now();
  const controller = opts?.timeoutMs && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), opts!.timeoutMs) : null;
  let res: Response;
  try {
    // A model retired by the provider is silently replaced with a current one
    // rather than failing every request until someone reads the error.
    const model = GROQ_MODELS.includes(state.groq.model)
      ? state.groq.model
      : (set({ groq: { ...state.groq, model: GROQ_MODELS[0] } }), GROQ_MODELS[0]);
    res = await fetch(groqEndpoint(), {
      method: "POST",
      headers: groqHeaders(),
      ...(useProxy() ? { credentials: "include" as const } : {}),
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_tokens: maxTokens,
        // The gpt-oss models spend output tokens on reasoning by default,
        // which is charged against the same budget and adds nothing here.
        ...(/gpt-oss/.test(state.groq.model) || !GROQ_MODELS.includes(state.groq.model) ? { reasoning_effort: "low" } : {}),
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (netErr) {
    const err: AiError = new Error(
      (netErr as Error)?.name === "AbortError"
        ? "the request timed out before Groq replied"
        : `could not reach Groq (${(netErr as Error)?.message || "network error"})`,
    );
    err.kind = "transient";
    err.status = 0;
    err.retryMs = 3000;
    set({ groq: { ...state.groq, status: priorStatus, latency: Date.now() - t0, calls: state.groq.calls + 1, notice: err.message, noticeAt: Date.now() } });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const latency = Date.now() - t0;
  set({ usage: { ...state.usage, api: state.usage.api + 1 } });

  if (!res.ok) {
    const body = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(body); } catch { /* not JSON */ }
    const code = parsed?.error?.code || "";
    const detail = parsed?.error?.message || body.slice(0, 400);
    const kind = code === "model_decommissioned" ? "fatal" : classifyFailure(res.status, code || detail);
    const message =
      code === "model_decommissioned"
        ? `the AI model "${state.groq.model}" was retired by Groq — pick a current model in Settings ▸ AI platform`
      : kind === "credential"
        ? (useProxy()
            ? "the backend rejected this browser — the AI proxy token or origin was refused; set the token under Settings ▸ Tool configuration"
            : "Groq rejected the API key — check it in Settings ▸ AI platform (keys start with gsk_ and come from console.groq.com/keys)")
      : res.status === 503 && useProxy()
        ? "the server has no AI key configured (set GROQ_API_KEY on the backend)"
      : res.status === 413
        ? `the batch was larger than the model’s per-minute token limit (${detail.slice(0, 160)})`
      : res.status === 429
        ? `Groq rate limit reached (${detail.slice(0, 160)})`
        : `${res.status} ${detail.slice(0, 400)}`;

    const err: AiError = new Error(message);
    err.kind = kind;
    err.status = res.status;
    err.retryMs = retryAfterMs(res.status, detail, res.headers?.get?.("retry-after"));
    // A refusal for size or rate means the estimate was too low: charge the
    // whole budget so the next request definitely waits.
    if (res.status === 413 || res.status === 429) tpmNote(TPM_BUDGET);
    set({ groq: {
      ...state.groq,
      status: kind === "transient" ? priorStatus : "error",
      latency, calls: state.groq.calls + 1,
      lastError: kind === "transient" ? state.groq.lastError : message,
      notice: kind === "transient" ? message : "",
      noticeAt: kind === "transient" ? Date.now() : null,
    } });
    throw err;
  }

  const data = await res.json();
  const used = data.usage?.total_tokens || 0;
  tpmCorrectLast(used);   // the estimate was a guess; this is the fact
  set({
    groq: {
      ...state.groq,
      status: "online", latency, calls: state.groq.calls + 1,
      tokens: state.groq.tokens + used,
      lastError: "", notice: "", noticeAt: null,
    },
  });
  return data.choices[0].message.content as string;
}
