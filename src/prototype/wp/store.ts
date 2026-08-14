"use client";

import {
  BS_LINES, CATEGORY_CELLS, DEFAULT_RULES, DEMO_RELABELS, FORMULA_REFS, FX_FIELDS, IS_LINES,
  OWNERSHIP_FIELDS, POOLS, PROFILE_FIELDS, SHEET,
  detectRulers, extractPositionedRows, extractRows, matchRule, numeric, readDocument, signForLabel,
  type ExtractedRow, type MappingRule, type ParsedDoc,
} from "./engine";
import {
  classifyParsedDoc, deriveCaseYears, entitySimilarity, markDuplicates, pagesForFeed,
  type DocClass, type DocKind,
} from "./classify";
import { extractCarryForwards, type CarryForward } from "./carryForward";

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
import { summarizeLedger, type LedgerSummary } from "./relatedPartyLedger";
import { applyWrites, resolveTemplateRows, templateBytes, type Writes } from "./xlsxPatch";
import { safeDownload } from "./safeBrowser";
import { lookupRates, yearFromPeriod } from "./fxRates";
import { seedRateDb, type RateDb } from "./rateDb";
import { PROVIDERS, fetchLiveRate, fxOfxAverage, isMostlyNonLatin, sourceLangHint, translateFree, type LiveRate } from "./providers";
import { detectProfile, sniffCurrency, type DetectedField } from "./detectProfile";

declare const JSZip: any;

export type EntityFile = { id: string; name: string; size: number; parsable: boolean; blob: File };
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
  via: "rule" | "groq" | "manual";
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
};

export type ReviewItem = {
  id: string;
  level: "block" | "warn" | "info";
  category: "fx" | "mapping" | "carry-forward" | "related-party" | "source-gap" | "profile" | "consistency" | "process";
  message: string;
  target?: string;                    // "Balance Sheet!F54"
  source?: string;
  suggestedValue?: string | number;
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

export type DocKindOverride = { kind: DocKind; pageHint?: "fs-pnl" | "fs-balance-sheet" };

/** A direct shareholder row (Shareholding Details rows 19–26). Seeded from
    the prior 5471's Schedule B Part II; editable in the Shareholders tab. */
export type Shareholder = {
  id: string;
  name: string;
  classOfShares: string;
  boy: number;
  eoy: number;
  source?: string;
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
  fxMeta: Record<string, { source: string; asOf: string }>;
  fxAuto: boolean;
  /** C-01: an auto-DETECTED functional currency must be confirmed by the
      preparer before the workbook can generate; manual entry confirms. */
  currencyConfirmed: boolean;
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
  unmatched: (ExtractedRow & { docId?: string; docName?: string })[];
  log: string[];
  processedAt: string | null;
};

export type GroqState = {
  key: string;
  model: string;
  status: "not configured" | "online" | "error" | "testing";
  latency: number | null;
  calls: number;
  tokens: number;
  lastError: string;
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
  policies: PolicyRule[];
  rateDb: RateDb;
  groq: GroqState;
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

export const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3-32b",
];

export const QUOTA = { aiTokens: 500000, documents: 500, storageMB: 2048, apiRequests: 5000 };
export const DOC_TYPES = [".xlsx", ".xls", ".csv", ".tsv", ".pdf", ".png", ".jpg", ".docx", ".txt"];
export const NATIVE_PARSE = [".xlsx", ".xlsm", ".csv", ".tsv", ".txt", ".pdf"];
export const MAX_FILE_MB = 25;

export const PROCESS_STEPS = [
  "Receive and secure documents",
  "Inventory and classify",
  "Extract and normalise line items",
  "Map to work paper schedule lines",
  "Apply FX policy and validations",
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
    detected: {},
    lines: {},
    relabels: {},
    sourceLabels: {},
    contributions: {},
    mapOverrides: {},
    docClasses: {},
    docKindOverrides: {},
    shareholders: [],
    excludedSheets: [],
    reviewItems: [],
    extraWrites: [],
    dividends: [],
    translations: {},
    translationFailures: {},
    unmatched: [],
    log: [],
    processedAt: null,
  };
}

/* ---------------- store ---------------- */
const initialStakeholder = "New stakeholder";

let state: WpState = {
  stakeholder: initialStakeholder,
  entities: [makeEntity("Entity 1", initialStakeholder)],
  activeEntityId: null,
  rules: DEFAULT_RULES.map((r) => ({ t: r.t, kw: [...r.kw] })),
  policies: [],
  rateDb: seedRateDb(),
  groq: { key: "", model: GROQ_MODELS[0], status: "not configured", latency: null, calls: 0, tokens: 0, lastError: "" },
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
  state = next;
  listeners.forEach((fn) => fn());
}

function set(patch: Partial<WpState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
  hooks.onMutate?.(patch);
}

function updateEntity(id: string, patch: Partial<Entity>) {
  set({ entities: state.entities.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
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
let fanningOut = false;

async function fanOutSiblings(parentId: string, plans: CfCandidate[]): Promise<void> {
  const parent = state.entities.find((e) => e.id === parentId);
  if (!parent) return;
  const fresh = plans.filter((plan) => {
    const match = state.entities.find((e) =>
      (plan.refIds.length && !!e.profile.refId && plan.refIds.includes(e.profile.refId)) ||
      entitySimilarity(e.profile.legalName || e.name, plan.cfcName) >= 0.5);
    return !match;
  });
  if (!fresh.length) return;
  toast(`${fresh.length + 1} foreign corporations found in ${fresh[0].source} — creating ${fresh.map((p) => p.cfcName).join(", ")}`, "ok");
  for (const plan of fresh) {
    const sib = makeEntity(plan.cfcName, state.stakeholder);
    sib.profile.legalName = plan.cfcName;   // drives the sibling's own block selection + backend naming
    if (plan.refIds[0]) sib.profile.refId = plan.refIds[0];
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

export const actions = {
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

  addFiles(id: string, fileList: FileList | File[]) {
    const ent = state.entities.find((e) => e.id === id);
    if (!ent) return;
    const added: EntityFile[] = [];
    let bytesAdded = 0;
    for (const f of Array.from(fileList)) {
      if (f.size > MAX_FILE_MB * 1048576) { toast(`${f.name} exceeds ${MAX_FILE_MB} MB`, "bad"); continue; }
      const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
      added.push({ id: uid(), name: f.name, size: f.size, parsable: NATIVE_PARSE.includes(ext), blob: f });
      bytesAdded += f.size;
    }
    if (!added.length) return;
    added.forEach((f) => logEvent("Document added", `${f.name} · ${f.size} bytes · ${f.parsable ? "native parse" : "AI extraction"}`, ent.name));
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
    if (!kind) delete overrides[fileId];
    else overrides[fileId] = { kind, ...(pageHint ? { pageHint } : {}) };
    updateEntity(entityId, { docKindOverrides: overrides });
    logEvent("Document type set", `${f?.name ?? fileId} → ${kind || "automatic"}${pageHint ? ` (${pageHint})` : ""}`, ent.name);
    toast(kind ? "Document type saved — re-process to apply" : "Document type back to automatic", "ok");
  },

  removeFile(entityId: string, fileId: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const f = ent.files.find((x) => x.id === fileId);
    if (f) logEvent("Document removed", f.name, ent.name);
    updateEntity(entityId, { files: ent.files.filter((x) => x.id !== fileId) });
    if (f) set({ usage: { ...state.usage, storage: Math.max(0, state.usage.storage - f.size) } });
  },

  setField(entityId: string, bucket: "profile" | "ownership" | "fx", key: string, value: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    updateEntity(entityId, { [bucket]: { ...ent[bucket], [key]: value } } as Partial<Entity>);
    if (ent.detected[key] && ent.detected[key].value !== value) {
      const detected = { ...ent.detected };
      delete detected[key];                       // now a manual value
      updateEntity(entityId, { detected });
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
    // Currency or period end changed -> refresh the published rates, unless the
    // preparer has overridden them by hand.
    if (bucket === "profile" && (key === "currency" || key === "cyEnd" || key === "pyEnd")) {
      actions.autoFillRates(entityId, false);
    }
    if (bucket === "fx") updateEntity(entityId, { fxAuto: false });
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
        if (w.sheet === SHEET.schM && w.ref === "E32" && avgRate) return { ...w, value: Math.round(d.amountFunctional / avgRate) };
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

  /** C-01: the preparer confirms an auto-detected functional currency. */
  confirmCurrency(entityId: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent || !ent.profile.currency) return;
    updateEntity(entityId, { currencyConfirmed: true });
    logEvent("Functional currency confirmed", `${ent.profile.currency} confirmed by the preparer`, ent.name);
    toast(`${ent.profile.currency} confirmed`, "ok");
    actions.autoFillRates(entityId, false);
  },

  /** Populate C59/C60/C61 from the IRS and Treasury tables. */
  autoFillRates(entityId: string, force = true) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const code = (ent.profile.currency || "").toUpperCase().trim();
    if (!code) { if (force) toast("Set the functional currency first", "bad"); return; }
    // FISCAL-YEAR GUARD: the IRS yearly-average and Treasury 12/31 tables are
    // calendar-year figures. A period ending in any month but December must
    // never receive them — the rates stay blank for manual entry, and the
    // derived fx-fiscal-manual review item says exactly what to enter.
    if (isFiscalPeriod(ent.profile.cyEnd)) {
      logEvent("Exchange rates skipped", `fiscal year ending ${ent.profile.cyEnd} — published calendar-year tables not applicable`, ent.name, "system");
      if (force) toast(`Fiscal year ending ${ent.profile.cyEnd} — published calendar-year tables don't apply; enter the rates manually`, "bad");
      return;
    }
    // Priority 1: the currency-rate database (uploaded Rates.xlsx, else the
    // built-in IRS + Treasury tables it was seeded from).
    const db = state.rateDb;
    const hit = lookupRates(code, ent.profile.cyEnd || "", ent.profile.pyEnd || "", {
      irsAvg: db.irsAvg, spot: db.spot, source: db.source,
    });
    const fx = { ...ent.fx };
    const fxMeta = { ...ent.fxMeta };
    const put = (k: string, v: number | null, meta: { source: string; asOf: string }) => {
      if (v === null) return;
      if (force || fx[k] === undefined || fx[k] === "" || ent.fxAuto) {
        fx[k] = String(v);
        fxMeta[k] = meta;
      }
    };
    // The as-of dates derive from the entity's own period ends when set — the
    // calendar path only reaches here, but the provenance must not claim a
    // 12/31 date the profile does not carry.
    const cyAsOf = ent.profile.cyEnd?.trim() || `12/31/${hit.cyYear}`;
    const pyAsOf = ent.profile.pyEnd?.trim() || `12/31/${hit.pyYear}`;
    put("avgRate", hit.avgRate, { source: `${db.source} · IRS yearly average`, asOf: `calendar ${hit.cyYear}` });
    put("cyRate", hit.cyRate, { source: `${db.source} · Treasury 12/31 spot`, asOf: cyAsOf });
    put("pyRate", hit.pyRate, { source: `${db.source} · Treasury 12/31 spot`, asOf: pyAsOf });
    updateEntity(entityId, { fx, fxAuto: true, fxMeta });
    if (hit.avgRate || hit.cyRate || hit.pyRate) {
      logEvent("Exchange rates applied", `${code} · avg ${hit.avgRate ?? "—"} (${hit.cyYear}) · CY spot ${hit.cyRate ?? "—"} · PY spot ${hit.pyRate ?? "—"} · ${db.source}`, ent.name, "system");
      if (force) toast(`${code} rates applied from ${db.source}`, "ok");
    }
    // Priority 2/3: a spot rate the database lacks is fetched from the live
    // providers — Frankfurter can serve the exact historical date; a dateless
    // provider is only trusted for CURRENT period ends. Averages have no live
    // source and stay blank rather than guessed.
    const missing: Array<{ k: "cyRate" | "pyRate"; end: string }> = [];
    if (!fx.cyRate && ent.profile.cyEnd) missing.push({ k: "cyRate", end: ent.profile.cyEnd });
    if (!fx.pyRate && ent.profile.pyEnd) missing.push({ k: "pyRate", end: ent.profile.pyEnd });
    if (missing.length) {
      void (async () => {
        for (const m of missing) {
          const iso = toIsoDate(m.end, Number(yearFromPeriod(m.end)) || 0) || undefined;
          const recent = iso ? Date.now() - new Date(iso).getTime() < 7 * 86400000 : false;
          try {
            const { result } = await fetchLiveRate(code, iso && !recent ? ["frankfurter"] : state.fxOrder, iso);
            if (result.ok && result.value.rate > 0) {
              const fresh = state.entities.find((e) => e.id === entityId);
              if (!fresh || fresh.fx[m.k]) continue;
              updateEntity(entityId, {
                fx: { ...fresh.fx, [m.k]: String(result.value.rate) },
                fxMeta: { ...fresh.fxMeta, [m.k]: { source: `${result.value.provider} (live fallback)`, asOf: result.value.asOf || iso || "latest" } },
              });
              logEvent("Live rate fallback applied", `${code} ${m.k} = ${result.value.rate} · ${result.value.provider} · ${result.value.asOf || iso || "latest"}`, ent.name, "system");
            }
          } catch { /* stays blank — the missing-rate blocker says exactly what to enter */ }
        }
      })();
    }
    // Average-rate chain (RAT-001, user-decided): IRS table → OFX daily
    // average over the entity's period → blank + reasoned review item for
    // manual entry. An OFX figure is ALWAYS labelled as such.
    if (!fx.avgRate && ent.profile.cyEnd) {
      const cyYearNum = Number(yearFromPeriod(ent.profile.cyEnd));
      const endIso = toIsoDate(ent.profile.cyEnd, cyYearNum || 0);
      // The period is the year ENDING on cyEnd: one day past the same date a
      // year earlier ("2024-12-31" → "2024-01-01".."2024-12-31").
      const startIso = endIso
        ? new Date(Date.parse(`${Number(endIso.slice(0, 4)) - 1}${endIso.slice(4)}`) + 86400000).toISOString().slice(0, 10)
        : null;
      if (endIso && startIso) {
        void (async () => {
          const r = await fxOfxAverage(code, startIso, endIso).catch(
            (err): { ok: false; error: string } => ({ ok: false, error: (err as Error).message }),
          );
          const fresh = state.entities.find((e) => e.id === entityId);
          if (!fresh || fresh.fx.avgRate) return;   // filled meanwhile — keep it
          if (r.ok) {
            const v = r.value;
            updateEntity(entityId, {
              fx: { ...fresh.fx, avgRate: String(v.rate) },
              fxMeta: { ...fresh.fxMeta, avgRate: { source: `OFX daily average (fallback — ${db.source} has no ${code} average)`, asOf: `${v.from}..${v.to} (${v.points} daily points)` } },
            });
            logEvent("OFX average-rate fallback applied", `${code} average ${v.rate} over ${v.from}..${v.to} (${v.points} points) — IRS table has no figure`, ent.name, "system");
            const again = state.entities.find((e) => e.id === entityId);
            if (again && !again.reviewItems.some((x) => x.id === "avg-ofx-fallback")) {
              updateEntity(entityId, {
                reviewItems: [...again.reviewItems, {
                  id: "avg-ofx-fallback", level: "warn", category: "fx", applied: true,
                  message: `C59 average rate ${v.rate} was computed from OFX daily mid-market rates over ${v.from}..${v.to} (${v.points} points) because the IRS table has no ${code} average. OFX is an indicative source — confirm or replace it before filing.`,
                  target: `${SHEET.basic}!C59`, source: "OFX", suggestedValue: v.rate,
                } as ReviewItem],
              });
            }
          } else {
            // Blank stays blank; the derived fx-avg-missing block explains the
            // chain's outcome so the preparer knows WHY manual entry is needed.
            updateEntity(entityId, { fxMeta: { ...fresh.fxMeta, avgRateNote: { source: `no IRS ${code} average; OFX fallback failed: ${r.error}`, asOf: "" } } });
            logEvent("Average-rate fallback unavailable", `${code}: no IRS figure; OFX: ${r.error} — manual entry required`, ent.name, "system");
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
      toast(`"${row.label}" could not be booked to ${target} — the row's year columns don't identify a current-year value. Enter it directly on the line instead.`, "bad");
      return;
    }
    logEvent("Unmatched label assigned", `"${row.label}" → ${target}`, ent.name);
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
      toast(`Mapped and remembered — future documents will map "${row.label}" automatically`, "ok");
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
    logEvent(
      "Caption remapped",
      `"${label}": ${fromTarget} → ${to ?? "unassigned"}${droppedBoy ? ` · ${droppedBoy} prior-year value(s) not carried` : ""}`,
      ent.name,
    );
    updateEntity(entityId, { lines, contributions, sourceLabels, relabels, unmatched, mapOverrides });
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
    const start = state.entities.find((e) => e.id === entityId);
    if (!start) return;
    if (!start.files.length) { toast("Add at least one document first", "bad"); return; }

    logEvent("Processing started", `${start.files.length} document(s)`, start.name);
    // A re-run starts clean: mapped lines, provenance and review state rebuild.
    // Snapshot what the wipe destroys so a mid-run failure can restore it,
    // and so sign-offs survive a re-process.
    const before = {
      lines: start.lines, relabels: start.relabels, sourceLabels: start.sourceLabels,
      contributions: start.contributions, unmatched: start.unmatched,
      reviewItems: start.reviewItems, extraWrites: start.extraWrites,
      dividends: start.dividends, docClasses: start.docClasses,
    };
    updateEntity(entityId, {
      status: "processing", progress: 0, log: [],
      lines: {}, relabels: {}, sourceLabels: {}, contributions: {}, unmatched: [],
      reviewItems: [], extraWrites: [], dividends: [], docClasses: {},
    });
    const log: string[] = [];
    const bundles: { file: EntityFile; parsed: ParsedDoc; cls: DocClass }[] = [];
    const mapRows: { row: ExtractedRow; docId: string; docName: string; feed: "is" | "bs" | "both"; kind: "pdf" | "grid" }[] = [];
    const profileGrids: string[][][] = [];
    const review: ReviewItem[] = [];
    let caseYears: { cy: number | null; py: number | null } = { cy: null, py: null };
    let equity: EquityFacts | null = null;
    let ato: AtoFacts = {};
    let cf: CarryForward | null = null;
    let cfSource = "";
    // Every 5471 block found across the prior-year documents. Exactly one
    // feeds THIS entity; the remaining named blocks fan out to siblings.
    const cfCandidates: CfCandidate[] = [];
    let siblingPlans: CfCandidate[] = [];
    let ledger: LedgerSummary | null = null;

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
        for (const f of ent.files) {
          try {
            const parsed = await readDocument(f.blob);
            if (!parsed) {
              // Honesty over hope: there is no AI-extraction path — say so.
              const ext = "." + (f.name.split(".").pop() || "?").toLowerCase();
              log.push(`${f.name}: unsupported format (${ext}) — nothing extracted`);
              rv({
                level: "warn", category: "process",
                message: `${f.name} is a format the tool cannot read (${ext}) — NOTHING from it feeds the work paper. Re-save legacy .xls workbooks as .xlsx (File ▸ Save As) and re-upload.`,
                source: f.name,
              });
              continue;
            }
            const cls = classifyParsedDoc(f.id, f.name, parsed);
            // Manual type override wins over the rules — the preparer said
            // what this document is; unclassified PDF pages follow the hint.
            const ov = ent.docKindOverrides?.[f.id];
            if (ov) {
              cls.kind = ov.kind;
              cls.confidence = 1;
              cls.method = "user";
              if (ov.pageHint) {
                cls.pages = cls.pages.map((p) => (p.kind === "unknown" ? { ...p, kind: ov.pageHint!, score: 1 } : p));
              }
              log.push(`${f.name}: document type set manually → ${ov.kind}${ov.pageHint ? ` (${ov.pageHint})` : ""}`);
            }
            bundles.push({ file: f, parsed, cls });
            parsedByFile.set(f.id, parsed);
          } catch (err) {
            log.push(`${f.name}: could not be read (${(err as Error).message})`);
          }
        }
        markDuplicates(bundles.map((b) => b.cls), parsedByFile);
        const derived = deriveCaseYears(bundles.map((b) => b.cls));
        caseYears = { cy: derived.cy, py: derived.py };
        if (derived.dissent.length) {
          rv({
            id: "case-year-dissent", level: "warn", category: "consistency",
            message: `Documents report on different years: ${derived.cy} was taken as the case year; ${derived.dissent.join(", ")} document(s) were treated as reference material. Confirm the engagement year.`,
          });
        }
        for (const b of bundles) {
          log.push(`${b.file.name}: classified as ${b.cls.kind}${b.cls.statementYear ? ` (${b.cls.statementYear})` : ""}${b.cls.duplicateOf ? " — duplicate, excluded" : ""}`);
          for (const n of b.cls.notes) rv({ level: n.level, category: "process", message: n.message, source: b.file.name });
          if (b.cls.kind === "unknown" && !b.cls.duplicateOf) {
            rv({
              level: "warn", category: "process",
              message: `${b.file.name} could not be classified and fed NOTHING into the work paper. Set its document type manually in Document intake (Type column) and re-process — or map its lines by hand.`,
              source: b.file.name,
            });
          }
          if (b.cls.kind === "prior-year-us-return" && caseYears.cy && b.cls.statementYear === caseYears.cy) {
            rv({
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
        });
      }

      /* Step 2 — extract rows per feed policy; run the special modules. */
      if (step === 2) {
        for (const b of bundles) {
          if (b.cls.duplicateOf) continue;
          const { parsed, cls, file } = b;
          let read = 0;
          if (parsed.pdf) {
            const rulers = detectRulers(parsed.pdf);
            const isPages = pagesForFeed(cls, "generic-is");
            const bsPages = pagesForFeed(cls, "generic-bs");
            for (const row of isPages.size ? extractPositionedRows(parsed.pdf, rulers, { pages: isPages }) : []) {
              mapRows.push({ row, docId: file.id, docName: file.name, feed: "is", kind: "pdf" });
              read++;
            }
            for (const row of bsPages.size ? extractPositionedRows(parsed.pdf, rulers, { pages: bsPages }) : []) {
              mapRows.push({ row, docId: file.id, docName: file.name, feed: "bs", kind: "pdf" });
              read++;
            }
            const eqPages = pagesForFeed(cls, "equity");
            if (eqPages.size && !equity) equity = pullEquityFacts(parsed.pdf, eqPages, detectRulers(parsed.pdf), caseYears.cy);
            const atoPages = pagesForFeed(cls, "targeted-ato");
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
            const profilePages = pagesForFeed(cls, "profile");
            if (profilePages.size) {
              profileGrids.push(parsed.pdf.rows.filter((r) => profilePages.has(r.page)).map((r) => r.cells.map((c) => c.text)));
            }
          } else if (cls.kind === "related-party-ledger") {
            ledger = summarizeLedger(parsed.grid, file.name) || ledger;
          } else if (cls.kind === "trial-balance") {
            for (const row of extractRows(parsed.grid)) {
              mapRows.push({ row, docId: file.id, docName: file.name, feed: "both", kind: "grid" });
              read++;
            }
            profileGrids.push(parsed.grid);
          }
          if (read) log.push(`${file.name}: ${read} candidate line items read`);
        }

        // A recognized statement document that produced ZERO mapped rows is a
        // silent failure — name it, with its page kinds, instead of letting
        // the preparer discover empty schedules later.
        for (const b of bundles) {
          if (b.cls.duplicateOf) continue;
          const feedsStatements =
            b.cls.kind === "cfc-financial-statements" || b.cls.kind === "trial-balance";
          if (!feedsStatements) continue;
          if (mapRows.some((m) => m.docId === b.file.id)) continue;
          const kinds = [...new Set(b.cls.pages.map((p) => p.kind))].join(", ");
          rv({
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
            const dupAt = deduped.findIndex((d) =>
              (cand.refIds.length && d.refIds.some((id) => cand.refIds.includes(id))) ||
              (!!cand.cfcName && !!d.cfcName && entitySimilarity(cand.cfcName, d.cfcName) >= 0.5));
            if (dupAt < 0) { deduped.push(cand); continue; }
            const kept = deduped[dupAt];
            if (cand.pageCount > kept.pageCount) deduped[dupAt] = cand;
            if (cand.fileId !== kept.fileId) {
              rv({
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
              for (const cand of deduped) {
                rv({
                  level: "warn", category: "carry-forward",
                  message: `${cand.source} names "${cand.cfcName}" as the foreign corporation, but this work paper's entity is "${knownName}" — its carry-forward figures were NOT used.`,
                  source: cand.source,
                });
              }
            }
          } else {
            selected = deduped[0] ?? null;
          }
          if (selected) {
            cf = selected.cf;
            cfSource = selected.source;
            // A reference copy OLDER than the immediately prior year: its
            // Schedule J line 14 opens the WRONG year — flag, never adjust.
            if (caseYears.cy && selected.statementYear && selected.statementYear < caseYears.cy - 1) {
              rv({
                id: "cf-year-gap", level: "warn", category: "carry-forward",
                message: `${selected.source} is a FY${selected.statementYear} filing but the case year is ${caseYears.cy} — its Schedule J line 14 is the opening balance of FY${selected.statementYear + 1}, NOT ${caseYears.cy}. Confirm the opening E&P and the prior-filed balances before relying on them.`,
                source: selected.source,
              });
            }
          }
          // Remaining NAMED blocks become sibling work papers after this run;
          // a nameless leftover block is surfaced instead — never guess.
          siblingPlans = deduped.filter((c) => c !== selected && !!c.cfcName);
          for (const c of deduped) {
            if (c !== selected && !c.cfcName) {
              rv({
                level: "warn", category: "carry-forward",
                message: `An additional Form 5471 was found in ${c.source} but its foreign corporation could not be identified — create that entity manually and re-process.`,
                source: c.source,
              });
            }
          }
        }
        updateEntity(entityId, { log: [...log] });
      }

      /* Step 3 — map with year routing, pools and provenance; detect profile. */
      if (step === 3) {
        const ent = state.entities.find((e) => e.id === entityId);
        if (!ent) return;   // removed mid-run
        const lines: Record<string, LineValue> = {};
        const relabels: Record<string, string> = { ...ent.relabels };
        const sourceLabels: Record<string, SourceLabel> = {};
        const contributions: Record<string, Contribution[]> = {};
        const unmatched: (ExtractedRow & { docId?: string; docName?: string })[] = [];
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

        for (const m of mapRows) {
          let target = matchRule(m.row.label, state.rules);
          if (target === "SKIP") continue;
          const ov = overrides[norm(m.row.label)];
          if (ov !== undefined) {
            // The user's standing decision wins over rules and feed scoping.
            if (ov.to === null) { unmatched.push({ ...m.row, docId: m.docId, docName: m.docName, reason: "You unassigned this caption — pick a template line to book it." }); continue; }
            target = ov.to;
          } else {
            // Feed scoping: a P&L page may only hit IS lines, a balance-sheet
            // page only BS lines. A related-party balance is recognized by the
            // group name in its caption.
            if (target && m.feed === "is" && !target.startsWith("IS")) target = null;
            if (target && m.feed === "bs" && !target.startsWith("BS")) target = null;
            if (!target && m.feed === "bs") {
              const rp = relatedPartyTarget(m.row.label, groupStems);
              if (rp) {
                target = rp;
                rv({
                  level: "warn", category: "related-party",
                  message: `"${m.row.label}" was routed to ${rp === "BS:19" ? "loans to related persons (Sch F line 6)" : "loans from related persons (Sch F line 18)"} because the caption names a group entity — confirm, and consider Schedule M.`,
                  target: `${SHEET.bs}!${rp === "BS:19" ? "D/F19" : "D/F52"}`, source: m.docName,
                });
              }
            }
          }
          if (!target) {
            unmatched.push({
              ...m.row, docId: m.docId, docName: m.docName,
              reason: m.feed === "is"
                ? "No mapping rule matches this caption on an income-statement page — assign it to a Schedule C line (or a Schedule F line if it is really a balance)."
                : m.feed === "bs"
                  ? "No mapping rule matches this caption on a balance-sheet page — assign it to a Schedule F line."
                  : "No mapping rule matches this caption — assign it to the right schedule line.",
            });
            continue;
          }

          const routed = routeRow(m.row, target.startsWith("BS"), caseYears, m.kind);
          if (routed === "ambiguous") {
            unmatched.push({
              ...m.row, docId: m.docId, docName: m.docName,
              reason: "The row carries several numbers with no year identity — assigning it manually books the value the routing can verify.",
            });
            continue;
          }
          if (!routed.length) continue;   // prior-year-only income row etc — correctly ignored

          const isOverride = ov !== undefined && ov.to !== null;
          const resolved = isOverride ? { target, relabel: undefined, overflowNote: undefined } : resolvePool(pools, target, m.row.label);
          if (isOverride && specFor(target)?.relabel && !relabels[target]) relabels[target] = m.row.label;
          if (resolved.relabel) relabels[resolved.target] = resolved.relabel;
          if (resolved.overflowNote) rv({ level: "info", category: "mapping", message: resolved.overflowNote, source: m.docName });

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
                level: "info", category: "mapping",
                message: `"${m.row.label}" (${r.value.toLocaleString()}) appears on two pages of ${m.docName} — counted once.`,
                source: m.docName,
              });
              continue;
            }
            const booked = taxBookValue(resolved.target, r.field, r.value);
            if (booked !== r.value) {
              rv({
                id: `tax-sign-${resolved.target}`, level: "warn", category: "mapping", applied: true,
                message: `"${m.row.label}" ${r.value.toLocaleString()} was booked to ${resolved.target === "IS:54" ? "income tax expense — current (row 54)" : "deferred tax (row 55)"} as a NEGATIVE amount: the template's net income (row 56) is a plain SUM of rows 52–55, so a positive tax would increase profit. If this line is genuinely a tax credit, edit the value in the Exception Center.`,
                target: `${SHEET.is}!F${resolved.target.split(":")[1]}`, source: m.docName,
              });
            }
            const cur = lines[resolved.target] || {};
            if (r.field === "amount") lines[resolved.target] = { amount: (typeof cur.amount === "number" ? cur.amount : 0) + booked };
            else if (r.field === "eoy") lines[resolved.target] = { ...cur, eoy: (typeof cur.eoy === "number" ? cur.eoy : 0) + booked };
            else lines[resolved.target] = { ...cur, boy: (typeof cur.boy === "number" ? cur.boy : 0) + booked };
            (contributions[resolved.target] ||= []).push({
              docId: m.docId, docName: m.docName, page: m.row.page,
              label: m.row.label, value: booked, field: r.field, year: r.year, via: "rule",
              srcValues: m.row.values, srcYears: m.row.years, period: m.row.period,
            });
          }
          sourceLabels[resolved.target] = { label: m.row.label, values: m.row.values, years: m.row.years };
        }

        log.push(`${Object.keys(lines).length} schedule lines populated · ${unmatched.length} unmatched`);
        updateEntity(entityId, { lines, relabels, sourceLabels, contributions, unmatched, log: [...log] });

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
          if (fiscalSeed && periodEndYear && caseYears.cy && caseYears.cy !== periodEndYear + 1) {
            rv({
              id: "cf-period-year-mismatch", level: "warn", category: "consistency",
              message: `The statements report on ${caseYears.cy} but the prior 5471's accounting period ends ${cf!.periodEnd} — confirm the engagement year and the period ends in Basic Information.`,
              source: cfSource,
            });
          } else if (fiscalSeed) {
            const nextEnd = periodPlusOneYear(cf!.periodEnd!);
            if (nextEnd) {
              propose(profile, "cyEnd", shortPeriod(nextEnd), `${cfSource} · annual accounting period`);
              propose(profile, "pyEnd", shortPeriod(cf!.periodEnd!), `${cfSource} · annual accounting period`);
            }
          }
          if (caseYears.cy) propose(profile, "cyEnd", `12/31/${String(caseYears.cy).slice(2)}`, "statement year");
          if (caseYears.py) propose(profile, "pyEnd", `12/31/${String(caseYears.py).slice(2)}`, "statement year");
          if (cf?.periodEnd && !fiscalSeed) {
            const nextEnd = periodPlusOneYear(cf.periodEnd);
            if (nextEnd) {
              propose(profile, "cyEnd", shortPeriod(nextEnd), `${cfSource} · annual accounting period`);
              propose(profile, "pyEnd", shortPeriod(cf.periodEnd), `${cfSource} · annual accounting period`);
            }
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
            propose(profile, "addr1", cf.cfcAddress[0] || "", `${cfSource} · 5471 face`);
            propose(profile, "addr2", cf.cfcAddress[1] || "", `${cfSource} · 5471 face`);
            propose(profile, "addr3", cf.cfcAddress[2] || "", `${cfSource} · 5471 face`);
            propose(profile, "formed", cf.formed || "", `${cfSource} · 5471 face`);
            propose(profile, "countryInc", cf.countryInc || "", `${cfSource} · 5471 face`);
            propose(profile, "activity", cf.activity || "", `${cfSource} · 5471 face`);
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
            if (cf.pctVoting !== undefined) {
              propose(ownership, "ownStart", String(cf.pctVoting), `${cfSource} · 5471 face`);
              propose(ownership, "ownEnd", String(cf.pctVoting), `${cfSource} · 5471 face`);
            }
            propose(ownership, "cfc", "Yes", `${cfSource} · prior-year filing`);
            if (cf.pctVoting === undefined || cf.pctVoting >= 10) {
              propose(ownership, "tenPct", "Yes",
                cf.pctVoting !== undefined
                  ? `${cfSource} · ${cf.pctVoting}% voting per prior filing`
                  : `${cfSource} · prior-year filing`);
            }
            if (cf.pctVoting !== undefined && cf.pctVoting < 50) {
              rv({
                id: "cf-cfc-status", level: "warn", category: "carry-forward",
                message: `CFC = Yes was carried from the prior filing, but this filer's voting share is ${cf.pctVoting}% — CFC status depends on COMBINED US-shareholder ownership (more than 50%). Confirm it still holds for the current year.`,
                source: cfSource, applied: true,
              });
            }
            const fiscalDays = fiscalSeed ? daysBetweenPeriods(profile.pyEnd, profile.cyEnd) : null;
            if (fiscalDays) {
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
              !b.cls.duplicateOf && (b.cls.kind === "cfc-financial-statements" || b.cls.kind === "cfc-tax-return"));
            if (!hasCurrentDocs) {
              rv({
                id: "cf-seed-only", level: "warn", category: "source-gap",
                message: `This work paper was seeded from the prior-year Form 5471 only — upload ${profile.legalName || fresh.name}'s current-year financial statements and re-process to fill the income statement and balance sheet.`,
                source: cfSource,
              });
            }
            for (const cat of cf.categories) if (!categories[cat]) { categories[cat] = true; filled++; }
            if (cf.categories.length) {
              rv({
                id: "cf-categories", level: "warn", category: "carry-forward",
                message: `Filer categories ${cf.categories.join(", ")} pre-filled from the prior-year 5471 checkbox row ("${(cf.categoriesRaw || "").replace(/^.*?(1a)/, "$1")}") — confirm they still apply for ${caseYears.cy ?? "the current year"}.`,
                target: `${SHEET.basic}!B42:B50`, source: cfSource, applied: true,
              });
            }
          }

          for (const rows of profileGrids) {
            const found = detectProfile(rows);
            for (const d of found.profile) propose(profile, d.key, d.value, d.sourceLabel);
            for (const d of found.ownership) propose(ownership, d.key, d.value, d.sourceLabel);
            for (const cat of found.categories) if (!categories[cat]) { categories[cat] = true; filled++; }
          }

          if (!profile.currency) {
            for (const rows of profileGrids) {
              const sniff = sniffCurrency(rows);
              if (sniff) { propose(profile, "currency", sniff.value, sniff.sourceLabel); break; }
            }
          }
          // C-02: ONE legal-name input drives the header. The card name and
          // the B4 header follow legalName while still default-ish; renaming
          // the card by hand stops the follow (renameEntity sets both).
          if (profile.legalName && (!profile.entityShort || /^Entity \d+$/.test(profile.entityShort))) {
            profile.entityShort = profile.legalName;
          }
          const nameSync = profile.legalName && /^Entity \d+$/.test(fresh.name) ? { name: profile.legalName } : {};

          updateEntity(entityId, { profile, ownership, categories, detected, ...nameSync });
          if (filled) {
            log.push(`${filled} entity detail(s) detected from the documents`);
            logEvent("Entity details detected", `${filled} field(s) auto-filled`, fresh.name, "system");
            updateEntity(entityId, { log: [...log] });
          }
          if (profile.currency) actions.autoFillRates(entityId, false);
        }
      }

      /* Step 4 — materialize schedule writes and the review record. */
      if (step === 4) {
        // Shareholders seed from the prior 5471's Sch B Part II first —
        // merge-by-name, so hand-edited or hand-added rows always survive.
        if (cf?.holders?.length) {
          const cur = state.entities.find((e) => e.id === entityId);
          if (cur) {
            const merged = [...(cur.shareholders || [])];
            for (const h of cf.holders) {
              if (!merged.some((s) => s.name.toLowerCase() === h.name.toLowerCase())) {
                merged.push({ id: uid(), name: h.name, classOfShares: h.classOfShares, boy: h.boy, eoy: h.eoy, source: `${cfSource} · Sch B p.${h.page}` });
              }
            }
            if (merged.length !== (cur.shareholders || []).length) updateEntity(entityId, { shareholders: merged });
          }
        }
        const ent = state.entities.find((e) => e.id === entityId);
        if (!ent) return;   // removed mid-run
        const writes = await materializeCaseWrites(ent, { caseYears, equity, ato, cf, cfSource, ledger, rv });
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
    }

    updateEntity(entityId, {
      progress: PROCESS_STEPS.length,
      status: "ready",
      processedAt: new Date().toLocaleString(),
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

  async resolveWithGroq(entityId: string) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent || !ent.unmatched.length) { toast("Nothing unmatched to resolve"); return; }
    if (!state.groq.key) { toast("Add a Groq API key in Settings first", "bad"); return; }

    const targets = [
      ...IS_LINES.map((l) => `IS:${l.row} = ${l.label}`),
      ...BS_LINES.map((l) => `BS:${l.row} = ${l.label}`),
    ].join("\n");
    const labels = ent.unmatched.map((u, i) => `${i}. ${u.label}`).join("\n");

    set({ busy: true });
    try {
      const raw = await groqCall([
        { role: "system", content: "You map trial-balance labels onto US Form 5471 work paper lines. Reply with JSON only." },
        {
          role: "user",
          content: `Available targets:\n${targets}\n\nLabels to map:\n${labels}\n\nReturn JSON only: {"map":{"<index>":"<target id or null>"}}. Use null when no target fits.`,
        },
      ], true);
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      const fresh = state.entities.find((e) => e.id === entityId);
      if (!fresh) { set({ busy: false }); return; }
      const lines = { ...fresh.lines };
      const sourceLabels = { ...fresh.sourceLabels };
      const contributions = { ...fresh.contributions };
      const relabels = { ...fresh.relabels };
      const mapOverrides = { ...fresh.mapOverrides };
      const still: (ExtractedRow & { docId?: string; docName?: string })[] = [];
      let n = 0;
      fresh.unmatched.forEach((u, i) => {
        const t = parsed && parsed.map ? parsed.map[String(i)] : null;
        if (!t || typeof t !== "string" || !manualApply(fresh, lines, contributions, relabels, t, u, "groq")) {
          still.push(u);
          return;
        }
        sourceLabels[t] = { label: u.label, values: u.values, years: u.years };
        mapOverrides[norm(u.label)] = { to: t };
        n++;
      });
      logEvent("Groq mapping applied", `${n} label(s) resolved with ${state.groq.model}`, fresh.name, "groq");
      updateEntity(entityId, {
        lines,
        relabels,
        sourceLabels,
        contributions,
        mapOverrides,
        unmatched: still,
        log: [...fresh.log, `Groq resolved ${n} unmatched labels (${state.groq.model})`],
      });
      toast(`Groq mapped ${n} of ${n + still.length} labels`, "ok");
    } catch (err) {
      toast("Groq mapping failed: " + (err as Error).message, "bad");
    }
    set({ busy: false });
  },

  /** Translate every non-English caption via Groq. Labels only — never amounts. */
  async translateLabels() {
    if (!state.groq.key) { toast("Add a Groq API key in Settings first", "bad"); return; }
    const work: Array<{ entityId: string; labels: string[] }> = state.entities.map((ent) => {
      const all = [
        ...Object.values(ent.sourceLabels).map((s2) => s2.label),
        ...ent.unmatched.map((u) => u.label),
      ];
      return { entityId: ent.id, labels: [...new Set(all)].filter((l) => !ent.translations[l]) };
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
          if (value && !(isMostlyNonLatin(label) && isMostlyNonLatin(value))) {
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
      const all = [
        ...Object.values(ent.sourceLabels).map((s2) => s2.label),
        ...ent.unmatched.map((u) => u.label),
      ];
      return { entityId: ent.id, labels: [...new Set(all)].filter((l) => !ent.translations[l]) };
    }).filter((w) => w.labels.length);

    if (!work.length) { toast("Nothing left to translate"); return; }
    set({ busy: true });
    let done = 0, failed = 0;
    let lastError = "";

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
        const { result, attempts } = await translateFree(label, state.translateOrder, sourceLangHint(label));
        const latency = Date.now() - t0;
        for (const a of attempts) recordProvider(a.provider, 0, false, a.error, null);
        if (result.ok) {
          const value = result.value.trim();
          const unusable =
            !value ||
            (isMostlyNonLatin(label) && (value === label.trim() || isMostlyNonLatin(value)));
          if (unusable) {
            // The service echoed the input or stayed in the source script —
            // that is not a translation, and storing it would be a guess.
            failures[label] = "Unreadable characters or unsupported text — the service returned nothing usable.";
            recordProvider(result.provider, result.units, true, "", latency);
          } else {
            recordProvider(result.provider, result.units, true, "", latency);
            translations[label] = value;
            delete failures[label];
            done++;
          }
        } else {
          recordProvider("mymemory", 0, false, result.error, latency);
          failures[label] = `Translation service unavailable (${result.error}) — retry later.`;
          lastError = result.error;
          failed++;
          break;   // a failing provider will keep failing; stop burning the quota
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
    const targets = state.entities.filter((e) => cellCount(e) > 0);
    if (!targets.length) { toast("Nothing to write yet — process an entity or fill its profile", "bad"); return; }
    const blocked = targets.filter((e) => blockingIssues(e).length);
    if (blocked.length) {
      const first = blockingIssues(blocked[0])[0];
      logEvent("Generation blocked", `${blocked[0].name}: ${first.message}`, blocked[0].name, "system");
      toast(`${blocked[0].name}: ${first.message}`, "bad");
      return;
    }
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

/* ---------------- mapping helpers ---------------- */

/** Caption key for user overrides — case/whitespace insensitive. */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The entity's current year: profile cyEnd first, classified years second. */
export function entityCaseCy(ent: Entity): number | null {
  const y = yearFromPeriod(ent.profile.cyEnd || "");
  if (y) {
    const n = Number(y);
    if (isFinite(n) && n > 1990) return n;
  }
  return deriveCaseYears(Object.values(ent.docClasses)).cy;
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

/* Pool allocation: one relabel row per distinct caption, in document order;
   overflow aggregates into the pool's last row. */
type PoolState = Record<string, { byLabel: Map<string, number>; free: number[]; overflow: string[] }>;

function makePoolState(): PoolState {
  const s: PoolState = {};
  for (const [key, pool] of Object.entries(POOLS)) {
    s[key] = { byLabel: new Map(), free: [...pool.rows], overflow: [] };
  }
  return s;
}

function resolvePool(
  pools: PoolState,
  target: string,
  label: string,
): { target: string; relabel?: string; overflowNote?: string } {
  const pool = POOLS[target];
  if (!pool) return { target };
  const st = pools[target];
  const key = label.toLowerCase().trim();
  const prefix = pool.sheet === "is" ? "IS" : "BS";
  const existing = st.byLabel.get(key);
  if (existing !== undefined) return { target: `${prefix}:${existing}` };
  if (st.free.length > 1) {
    const row = st.free.shift()!;
    st.byLabel.set(key, row);
    return { target: `${prefix}:${row}`, relabel: label };
  }
  // Last slot aggregates everything that no longer fits.
  const row = st.free[0];
  st.overflow.push(label);
  const note = st.overflow.length > 1
    ? `${st.overflow.length} captions aggregated into one "${target}" slot: ${st.overflow.join(" · ")}`
    : undefined;
  return {
    target: `${prefix}:${row}`,
    relabel: st.overflow.length > 1 ? `Other (${st.overflow.length} items — see exceptions)` : label,
    overflowNote: note,
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
/** Regenerate the Shareholding-row writes after a shareholders-tab edit —
    the workbook must always reflect the CURRENT list without a re-process. */
function rebuildShareholderWrites(ent: Entity): CellWrite[] {
  const keep = ent.extraWrites.filter((w) => !(w.sheet === SHEET.shareholding && /^[BFHJ](19|2[0-6])$/.test(w.ref)));
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
  return [...keep, ...add];
}

/** Row-56 net income is a plain SUM of rows 52–55 — income tax expense must
    book NEGATIVE, or a statement-positive tax would INCREASE profit (RAT-003). */
const TAX_TARGETS = new Set(["IS:54", "IS:55"]);
const taxBookValue = (target: string, field: "amount" | "eoy" | "boy", value: number): number =>
  field === "amount" && TAX_TARGETS.has(target) && value > 0 ? -value : value;

function manualApply(
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
  const caseYears = deriveCaseYears(Object.values(ent.docClasses));
  const routed = routeRow(row, target.startsWith("BS"), caseYears, row.years?.some((y) => y !== null) ? "pdf" : "grid");
  if (routed === "ambiguous" || !routed.length) return false;
  for (const r of routed) {
    const booked = taxBookValue(target, r.field, r.value);
    const cur = lines[target] || {};
    if (r.field === "amount") lines[target] = { amount: (typeof cur.amount === "number" ? cur.amount : 0) + booked };
    else if (r.field === "eoy") lines[target] = { ...cur, eoy: (typeof cur.eoy === "number" ? cur.eoy : 0) + booked };
    else lines[target] = { ...cur, boy: (typeof cur.boy === "number" ? cur.boy : 0) + booked };
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
  ledger: LedgerSummary | null;
  rv: (item: Omit<ReviewItem, "id"> & { id?: string }) => void;
};

async function materializeCaseWrites(
  ent: Entity,
  facts: CaseFacts,
): Promise<{ list: CellWrite[]; dividends: DividendRec[] }> {
  const { caseYears, equity, ato, cf, cfSource, ledger, rv } = facts;
  const list: CellWrite[] = [];
  const dividends: DividendRec[] = [];
  const avgRate = numeric(ent.fx.avgRate);
  const cyRate = numeric(ent.fx.cyRate);
  const pyRate = numeric(ent.fx.pyRate);
  const w = (write: CellWrite) => list.push(write);

  /* ---- carry-forward: opening E&P, shareholding, prior-filed USD ---- */
  if (cf?.openingEP) {
    w({
      sheet: SHEET.schJ, ref: "F15", value: cf.openingEP.value,
      source: `${cfSource} p.${cf.openingEP.page} · prior Sch J line 14`, reviewId: "cf-opening-ep",
      prov: { docName: cfSource, page: cf.openingEP.page, rowText: cf.openingEP.rowText },
    });
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
  if (cf || holderRows.length) {
    for (let row = 19 + Math.min(holderRows.length, 8); row <= 22; row++) {
      for (const col of ["B", "J"]) w({ sheet: SHEET.shareholding, ref: `${col}${row}`, value: "", source: "template demo data cleared" });
      if (row > 19) w({ sheet: SHEET.shareholding, ref: `H${row}`, value: "", source: "template demo data cleared" });
    }
    if (cf && !holderRows.length) {
      rv({
        id: "cf-holders-missing", level: "warn", category: "carry-forward",
        message: "A prior-year 5471 was recognized but no shareholder rows could be read from its Schedule B Part II — the template's DEMO shareholders were cleared. Enter the real holders in the Shareholders tab before generating.",
        target: `${SHEET.shareholding}!B19`, source: cfSource,
      });
    }
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
    if (cf.referenceIds.length) {
      rv({
        id: "cf-refid", level: "info", category: "carry-forward",
        message: `Reference ID ${cf.referenceIds[0]} must be identical on every year's filing; the template has no designated cell for it — carry it on the form itself.`,
        source: cfSource, suggestedValue: cf.referenceIds[0],
      });
    }
    if (cf.referenceIds.length > 1) {
      rv({
        id: "cf-refid-mismatch", level: "warn", category: "consistency",
        message: `Two different reference IDs appear in the prior-year return (${cf.referenceIds.join(" vs ")}) — the Form 5472 names the entity differently. Fix before filing.`,
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

  /* ---- dividend: one record drives four schedules ---- */
  const divAmount = equity?.dividendsCY ?? ato.frankedDividendsPaid ?? null;
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
    if (usdPerUnit !== null) w({ sheet: SHEET.dividends, ref: "D3", value: usdPerUnit, reviewId: "dividend-rate", source: rateSource === "frankfurter" ? `ECB reference rate ${iso}` : "1 ÷ year-end spot (fallback)" });
    rv({
      id: "dividend-rate", level: rateSource === "frankfurter" ? "info" : "warn", category: "fx", applied: true,
      message: rateSource === "frankfurter"
        ? `Dividend of ${divAmount.toLocaleString()} paid ${date} translated at the ECB reference rate for that date (${usdPerUnit}).`
        : `Dividend of ${divAmount.toLocaleString()} paid ${date} was translated at the ${ent.profile.cyEnd || "year-end"} spot rate (${usdPerUnit ?? "n/a"}) because no payment-date rate was reachable — replace Dividends!D3 with the ${date} spot rate.`,
      target: `${SHEET.dividends}!D3`,
    });

    w({ sheet: SHEET.schR, ref: "B10", value: `Cash dividend distribution to ${cf?.holderName || "the US parent"}`, source: "equity movement / AU return" });
    w({ sheet: SHEET.schR, ref: "E10", value: date, source: "AU return dividend schedule" });
    w({ sheet: SHEET.schR, ref: "G10", value: divAmount, source: "equity movement / AU return" });
    w({ sheet: SHEET.schR, ref: "I10", value: divAmount, source: "distribution of E&P" });

    w({
      sheet: SHEET.schJ, ref: "F33", value: -divAmount, reviewId: "dividend-schj-sign",
      source: "Sch J line 9 actual distributions",
    });
    rv({
      id: "dividend-schj-sign", level: "info", category: "carry-forward", applied: true,
      message: `Schedule J line 9 (actual distributions) entered as −${divAmount.toLocaleString()}: the template's closing balance is a plain SUM, so distributions must carry a minus sign.`,
      target: `${SHEET.schJ}!F33`,
    });

    if (avgRate) {
      w({
        sheet: SHEET.schM, ref: "E32", value: Math.round(divAmount / avgRate),
        labelKey: { col: "B", contains: "dividends paid", excludes: "hybrid" },
        source: "dividend at the year-average rate", reviewId: "dividend-schm",
      });
      rv({
        id: "dividend-schm", level: "warn", category: "related-party", applied: true,
        message: `Schedule M dividends-paid entered in column (b) at the year-average rate (US$${Math.round(divAmount / avgRate).toLocaleString()}). Column (b) is an inference — the recipient is the filer itself; Schedule M instructions use the average rate, the 18-Dec spot alternative would be US$${dividends[0].usdPerUnit ? Math.round(divAmount * dividends[0].usdPerUnit).toLocaleString() : "n/a"}. Confirm both choices.`,
        target: `${SHEET.schM}!dividends-paid row`,
      });
    }
  }

  /* ---- related-party ledger → Schedule M services ---- */
  if (ledger && avgRate && ledger.invoiceCount + ledger.creditNoteCount === 0) {
    rv({
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

  /* ---- Schedule E: a nil-tax year is documented, not skipped ---- */
  if (ato.taxPayable === 0 || (equity && (equity.profitCY ?? 0) < 0)) {
    if (ent.profile.legalName) w({ sheet: SHEET.schE, ref: "B16", value: ent.profile.legalName, source: "nil-tax documentation row" });
    if (cf?.referenceIds[0]) w({ sheet: SHEET.schE, ref: "E16", value: cf.referenceIds[0], source: "reference ID" });
    if (ent.profile.countryInc) w({ sheet: SHEET.schE, ref: "G16", value: ent.profile.countryInc, source: "country" });
    if (ent.profile.cyEnd) {
      w({ sheet: SHEET.schE, ref: "I16", value: ent.profile.cyEnd, source: "foreign tax year" });
      w({ sheet: SHEET.schE, ref: "K16", value: ent.profile.cyEnd, source: "US tax year" });
    }
    w({ sheet: SHEET.schE, ref: "O16", value: 0, source: "loss year — no Australian tax", reviewId: "sch-e-nil" });
    if (avgRate) w({ sheet: SHEET.schE, ref: "Q16", value: avgRate, source: "average rate" });
    w({ sheet: SHEET.schE, ref: "E48", value: 0, source: "prior E-1 closed at zero", reviewId: "sch-e1-opening" });
    rv({
      id: "sch-e-nil", level: "info", category: "fx", applied: true,
      message: "Schedule E carries an explicit zero row: taxable income is nil (loss year), so no Australian tax was paid or accrued on current-year income — recorded deliberately rather than left blank.",
      target: `${SHEET.schE}!O16`,
    });
    rv({
      id: "sch-e1-opening", level: "warn", category: "carry-forward", applied: true,
      message: "Schedule E-1 opening tax pool pre-filled at 0 — the prior-year E-1 closed at zero (taxes removed under the high-tax reduction). Confirm the opening pool is nil.",
      target: `${SHEET.schE}!E48`,
    });
    rv({
      id: "high-tax-2024", level: "info", category: "consistency",
      message: "The prior year excluded all tested income under the GILTI high-tax exception (23.7% effective rate). This year there is a LOSS and NO Australian tax — the high-tax exception is not available and must not be repeated.",
    });
  } else {
    /* ---- Schedule E: current-year income tax flows from the P&L ----
       Row 16 gets the local tax; S16/U16/U21 are template formulas, and
       Schedule I & I-1's D45 reads Sch E&E-1!U21 — the tested-taxes flow
       happens in the template itself, no I-1 writes needed (RAT-003). */
    const taxBooked = ent.lines["IS:54"]?.amount;
    const taxCur = typeof taxBooked === "number" && isFinite(taxBooked) ? taxBooked : null;
    if (taxCur && Math.abs(taxCur) > 0) {
      const taxAbs = Math.abs(taxCur);
      if (ent.profile.legalName) w({ sheet: SHEET.schE, ref: "B16", value: ent.profile.legalName, source: "current-year tax row" });
      const refId = cf?.referenceIds[0] || ent.profile.refId;
      if (refId) w({ sheet: SHEET.schE, ref: "E16", value: refId, source: "reference ID" });
      if (ent.profile.countryInc) w({ sheet: SHEET.schE, ref: "G16", value: ent.profile.countryInc, source: "country" });
      if (ent.profile.cyEnd) {
        w({ sheet: SHEET.schE, ref: "I16", value: ent.profile.cyEnd, source: "foreign tax year" });
        w({ sheet: SHEET.schE, ref: "K16", value: ent.profile.cyEnd, source: "US tax year" });
      }
      w({ sheet: SHEET.schE, ref: "O16", value: taxAbs, source: "P&L income tax expense", reviewId: "sch-e-current-tax" });
      if (avgRate) w({ sheet: SHEET.schE, ref: "Q16", value: avgRate, source: "average rate" });
      rv({
        id: "sch-e-current-tax", level: "warn", category: "consistency", applied: true,
        message: `Schedule E row 16 carries the ${taxAbs.toLocaleString()} income tax expense from the P&L. Confirm whether it was PAID or ACCRUED in the year (Schedule E wants taxes paid or accrued — an accrual-only figure may need the accrued column treatment). The USD amount and the Schedule I-1 tested-taxes flow compute in the template's own formulas.`,
        target: `${SHEET.schE}!O16`, source: "income statement", suggestedValue: taxAbs,
      });
    }
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

export function buildWrites(ent: Entity): Writes {
  const basic: Record<string, string | number> = {};
  PROFILE_FIELDS.forEach((f) => {
    const v = ent.profile[f.key];
    if (v !== undefined && v !== "") basic[f.cell] = v;
  });
  OWNERSHIP_FIELDS.forEach((f) => {
    const v = ent.ownership[f.key];
    if (v === undefined || v === "") return;
    basic[f.cell] = f.type === "pct" ? Number(v) / 100 : f.type === "num" ? Number(v) : v;
  });
  Object.entries(CATEGORY_CELLS).forEach(([cat, cell]) => { if (ent.categories[cat]) basic[cell] = "Yes"; });
  FX_FIELDS.forEach((f) => {
    const v = ent.fx[f.key];
    if (v !== undefined && v !== "") basic[f.cell] = Number(v);
  });

  const is: Record<string, string | number> = {};
  IS_LINES.forEach((l) => {
    const d = ent.lines[`IS:${l.row}`];
    if (d && typeof d.amount === "number") is[`F${l.row}`] = d.amount;
    const rl = ent.relabels[`IS:${l.row}`];
    if (l.relabel && rl) is[`C${l.row}`] = rl;
  });

  const bs: Record<string, string | number> = {};
  BS_LINES.forEach((l) => {
    const d = ent.lines[`BS:${l.row}`];
    if (d) {
      if (typeof d.boy === "number") bs[`D${l.row}`] = d.boy;
      if (typeof d.eoy === "number") bs[`F${l.row}`] = d.eoy;
    }
    const rl = ent.relabels[`BS:${l.row}`];
    if (l.relabel && rl) bs[`B${l.row}`] = rl;
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
    if (sheet[w.ref] !== undefined && sheet[w.ref] !== "" && sheet[w.ref] !== w.value) continue;
    sheet[w.ref] = w.value;
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
  const rate = (k: string) => {
    const v = ent.fx[k];
    const n = v === undefined || v === "" ? NaN : Number(v);
    return isFinite(n) && n > 0 ? n : null;
  };
  const hasBS = BS_LINES.some((l) => ent.lines[`BS:${l.row}`]);
  const hasIS = IS_LINES.some((l) => ent.lines[`IS:${l.row}`]);

  // The template divides by these; a blank or zero rate yields #DIV/0! in every
  // USD column of Schedule C and Schedule F.
  if (hasIS && !rate("avgRate")) {
    const code = (ent.profile.currency || "the functional currency").toUpperCase();
    const why = ent.fxMeta?.avgRateNote?.source
      ? ` ${ent.fxMeta.avgRateNote.source}.`
      : ent.profile.currency
        ? ` No IRS-table average was found for ${code} and no fallback figure was applied.`
        : "";
    out.push({
      id: "fx-avg-missing", level: "block", category: "fx",
      message: `Average exchange rate (C59) is missing — Schedule C USD columns will show #DIV/0!.${why} Enter the period's average rate manually.`,
      target: `${SHEET.basic}!C59`,
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
  // Fiscal year: the published tables are calendar-year — the guard leaves
  // the rates blank on purpose, and this item says what to enter by hand.
  if (isFiscalPeriod(ent.profile.cyEnd) && (!rate("avgRate") || !rate("cyRate") || !rate("pyRate"))) {
    out.push({
      id: "fx-fiscal-manual", level: "warn", category: "fx",
      message: `Fiscal year ending ${ent.profile.cyEnd}: the IRS yearly-average and Treasury 12/31 tables are calendar-year figures and were NOT applied. Enter the period's average rate (C59) and the ${ent.profile.cyEnd} / ${ent.profile.pyEnd || "prior period-end"} spot rates (C60/C61) manually.`,
      target: `${SHEET.basic}!C59`,
    });
  }
  if (!ent.profile.currency) {
    out.push({ id: "profile-currency", level: "warn", category: "profile", message: "Functional currency is not set — rates cannot be looked up automatically" });
  }
  if (!ent.profile.cyEnd) {
    out.push({ id: "profile-cyend", level: "warn", category: "profile", message: "Current year end is not set — the workbook header and rate year depend on it" });
  }
  if (ent.unmatched.length) {
    out.push({ id: "mapping-unmatched", level: "warn", category: "mapping", message: `${ent.unmatched.length} extracted label(s) are still unassigned` });
  }
  if (!Object.keys(ent.categories).some((k) => ent.categories[k])) {
    out.push({ id: "profile-category", level: "warn", category: "profile", message: "No filing category selected" });
  }
  return out;
}

/** Ids validateEntity can produce — stored dismissal tombstones for these
    must vanish once the underlying condition is resolved. */
const DERIVED_IDS = new Set([
  "fx-avg-missing", "fx-cy-missing", "fx-py-missing", "fx-fiscal-manual", "fx-currency-unconfirmed",
  "profile-currency", "profile-cyend", "mapping-unmatched", "profile-category",
]);

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
  const merged = [...derived, ...ent.reviewItems.filter((r) => !currentIds.has(r.id) && !DERIVED_IDS.has(r.id))];
  if (opts?.raw || !state.policies.length) return merged;
  return merged.map((r) => applyPolicy(r, state.policies)).filter((r): r is ReviewItem => r !== null);
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

  const report = await applyWrites(zip, writes);
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

async function groqCall(messages: Array<{ role: string; content: string }>, jsonMode = false): Promise<string> {
  const t0 = Date.now();
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + state.groq.key },
    body: JSON.stringify({
      model: state.groq.model,
      messages,
      temperature: 0,
      max_tokens: 1500,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const latency = Date.now() - t0;
  set({ usage: { ...state.usage, api: state.usage.api + 1 } });

  if (!res.ok) {
    const body = await res.text();
    const msg = `${res.status} ${body.slice(0, 160)}`;
    set({ groq: { ...state.groq, status: "error", latency, calls: state.groq.calls + 1, lastError: msg } });
    throw new Error(msg);
  }
  const data = await res.json();
  set({
    groq: {
      ...state.groq,
      status: "online",
      latency,
      calls: state.groq.calls + 1,
      tokens: state.groq.tokens + (data.usage ? data.usage.total_tokens || 0 : 0),
      lastError: "",
    },
  });
  return data.choices[0].message.content as string;
}
