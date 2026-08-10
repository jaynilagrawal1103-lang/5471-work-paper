"use client";

import {
  BS_LINES, CATEGORY_CELLS, DEFAULT_RULES, FX_FIELDS, IS_LINES,
  OWNERSHIP_FIELDS, PROFILE_FIELDS, SHEET,
  extractRows, matchRule, readSpreadsheet,
  type ExtractedRow, type MappingRule,
} from "./engine";
import { applyWrites, templateBytes, type Writes } from "./xlsxPatch";
import { safeDownload } from "./safeBrowser";
import { lookupRates } from "./fxRates";
import { PROVIDERS, fetchLiveRate, sourceLangHint, translateFree, type LiveRate } from "./providers";
import { detectProfile, sniffCurrency, type DetectedField } from "./detectProfile";

declare const JSZip: any;

export type EntityFile = { id: string; name: string; size: number; parsable: boolean; blob: File };
export type LineValue = { amount?: number | null; boy?: number | null; eoy?: number | null };
export type EntityStatus = "idle" | "processing" | "ready" | "error";

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
  fxAuto: boolean;
  detected: Record<string, DetectedField>;
  lines: Record<string, LineValue>;
  relabels: Record<string, string>;
  sourceLabels: Record<string, { label: string; values: number[] }>;
  translations: Record<string, string>;
  unmatched: ExtractedRow[];
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
    profile: { clientName: stakeholder, entityShort: name, cyEnd: "12/31/25", pyEnd: "12/31/24" },
    ownership: {},
    categories: {},
    fx: {},
    fxAuto: false,
    detected: {},
    lines: {},
    relabels: {},
    sourceLabels: {},
    translations: {},
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

function set(patch: Partial<WpState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
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
export const actions = {
  setStakeholder(name: string) {
    const clean = name.trim() || "Unnamed stakeholder";
    logEvent("Stakeholder renamed", clean);
    set({
      stakeholder: clean,
      entities: state.entities.map((e) => ({ ...e, profile: { ...e.profile, clientName: clean } })),
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
    // Currency or period end changed -> refresh the published rates, unless the
    // preparer has overridden them by hand.
    if (bucket === "profile" && (key === "currency" || key === "cyEnd" || key === "pyEnd")) {
      actions.autoFillRates(entityId, false);
    }
    if (bucket === "fx") updateEntity(entityId, { fxAuto: false });
  },

  /** Populate C59/C60/C61 from the IRS and Treasury tables. */
  autoFillRates(entityId: string, force = true) {
    const ent = state.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const code = (ent.profile.currency || "").toUpperCase().trim();
    if (!code) { if (force) toast("Set the functional currency first", "bad"); return; }
    const hit = lookupRates(code, ent.profile.cyEnd || "", ent.profile.pyEnd || "");
    if (!hit.avgRate && !hit.cyRate && !hit.pyRate) {
      if (force) toast(`No published rates for ${code} in those years — enter them manually`, "bad");
      return;
    }
    const fx = { ...ent.fx };
    const put = (k: string, v: number | null) => {
      if (v === null) return;
      if (force || fx[k] === undefined || fx[k] === "" || ent.fxAuto) fx[k] = String(v);
    };
    put("avgRate", hit.avgRate);
    put("cyRate", hit.cyRate);
    put("pyRate", hit.pyRate);
    updateEntity(entityId, { fx, fxAuto: true });
    logEvent("Exchange rates applied", `${code} · avg ${hit.avgRate ?? "—"} (${hit.cyYear}) · CY spot ${hit.cyRate ?? "—"} · PY spot ${hit.pyRate ?? "—"}`, ent.name, "system");
    if (force) toast(`${code} rates applied from published tables`, "ok");
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
    logEvent("Unmatched label assigned", `"${row.label}" → ${target}`, ent.name);
    const sourceLabels = { ...ent.sourceLabels, [target]: { label: row.label, values: row.values } };
    const lines = { ...ent.lines };
    applyRowToLines(lines, target, row);
    updateEntity(entityId, {
      lines,
      sourceLabels,
      unmatched: ent.unmatched.filter((_, i) => i !== index),
    });
  },

  async processEntity(entityId: string) {
    const start = state.entities.find((e) => e.id === entityId);
    if (!start) return;
    if (!start.files.length) { toast("Add at least one document first", "bad"); return; }

    logEvent("Processing started", `${start.files.length} document(s)`, start.name);
    updateEntity(entityId, { status: "processing", progress: 0, log: [] });
    const log: string[] = [];
    const parsed: ExtractedRow[] = [];
    const detectedRows: string[][][] = [];

    try {
    for (let step = 0; step < PROCESS_STEPS.length; step++) {
      updateEntity(entityId, { progress: step });
      await new Promise((r) => setTimeout(r, 220));

      if (step === 2) {
        const ent = state.entities.find((e) => e.id === entityId);
        if (!ent) return;   // removed mid-run
        for (const f of ent.files) {
          try {
            const rows = await readSpreadsheet(f.blob);
            if (rows) {
              const ex = extractRows(rows);
              parsed.push(...ex);
              detectedRows.push(rows);
              log.push(`${f.name}: ${ex.length} candidate line items read`);
            } else {
              log.push(`${f.name}: no native parser — queued for AI extraction`);
            }
          } catch (err) {
            log.push(`${f.name}: could not be read (${(err as Error).message})`);
          }
        }
        set({ usage: { ...state.usage, docs: state.usage.docs + ent.files.length } });
        updateEntity(entityId, { log: [...log] });
      }

      if (step === 3) {
        const ent = state.entities.find((e) => e.id === entityId);
        if (!ent) return;   // removed mid-run
        const lines: Record<string, LineValue> = { ...ent.lines };
        const sourceLabels = { ...ent.sourceLabels };
        const unmatched: ExtractedRow[] = [];
        for (const row of parsed) {
          const target = matchRule(row.label, state.rules);
          if (!target) { unmatched.push(row); continue; }
          applyRowToLines(lines, target, row);
          sourceLabels[target] = { label: row.label, values: row.values };
        }
        log.push(`${Object.keys(lines).length} schedule lines populated · ${unmatched.length} unmatched`);
        updateEntity(entityId, { lines, sourceLabels, unmatched, log: [...log] });

        // Entity particulars: proposals only, and only into fields left blank.
        const fresh = state.entities.find((e) => e.id === entityId);
        if (fresh) {
          const profile = { ...fresh.profile };
          const ownership = { ...fresh.ownership };
          const categories = { ...fresh.categories };
          const detected = { ...fresh.detected };
          let filled = 0;

          for (const rows of detectedRows) {
            const found = detectProfile(rows);
            for (const d of found.profile) {
              if (profile[d.key] !== undefined && profile[d.key] !== "") continue;
              profile[d.key] = d.value;
              detected[d.key] = d;
              filled++;
            }
            for (const d of found.ownership) {
              if (ownership[d.key] !== undefined && ownership[d.key] !== "") continue;
              ownership[d.key] = d.value;
              detected[d.key] = d;
              filled++;
            }
            for (const cat of found.categories) {
              if (!categories[cat]) { categories[cat] = true; filled++; }
            }
          }

          // Currency is what unblocks the FX rates, so fall back to sniffing
          // a bare ISO code when no caption named it.
          if (!profile.currency) {
            for (const rows of detectedRows) {
              const sniff = sniffCurrency(rows);
              if (sniff) {
                profile.currency = sniff.value;
                detected.currency = sniff;
                filled++;
                break;
              }
            }
          }
          if (!profile.entityShort && profile.legalName) profile.entityShort = profile.legalName;

          if (filled) {
            updateEntity(entityId, { profile, ownership, categories, detected });
            log.push(`${filled} entity detail(s) detected from the documents`);
            logEvent("Entity details detected", `${filled} field(s) auto-filled from ${detectedRows.length} document(s)`, fresh.name, "system");
            updateEntity(entityId, { log: [...log] });
          }
          // A detected currency means the rates can be resolved straight away.
          if (profile.currency) actions.autoFillRates(entityId, false);
        }
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
      logEvent("Processing completed", `${Object.keys(done.lines).length} lines mapped · ${done.unmatched.length} unmatched`, done.name, "system");
      toast(`${done.name} processed — ${Object.keys(done.lines).length} lines mapped`, "ok");
    }
    } catch (err) {
      updateEntity(entityId, { status: "error" });
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
      const still: ExtractedRow[] = [];
      let n = 0;
      fresh.unmatched.forEach((u, i) => {
        const t = parsed && parsed.map ? parsed.map[String(i)] : null;
        if (!t || typeof t !== "string") { still.push(u); return; }
        applyRowToLines(lines, t, u);
        n++;
      });
      logEvent("Groq mapping applied", `${n} label(s) resolved with ${state.groq.model}`, fresh.name, "groq");
      updateEntity(entityId, {
        lines,
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
        let n = 0;
        w.labels.forEach((label, i) => {
          const v = parsed?.t?.[String(i)];
          if (typeof v === "string" && v.trim()) { translations[label] = v.trim(); n++; }
        });
        updateEntity(w.entityId, { translations });
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
      for (const label of w.labels) {
        const t0 = Date.now();
        const { result, attempts } = await translateFree(label, state.translateOrder, sourceLangHint(label));
        const latency = Date.now() - t0;
        for (const a of attempts) recordProvider(a.provider, 0, false, a.error, null);
        if (result.ok) {
          recordProvider(result.provider, result.units, true, "", latency);
          translations[label] = result.value;
          done++;
        } else {
          recordProvider("mymemory", 0, false, result.error, latency);
          lastError = result.error;
          failed++;
          break;   // a failing provider will keep failing; stop burning the quota
        }
        set({ usage: { ...state.usage, api: state.usage.api + 1 } });
      }
      updateEntity(w.entityId, { translations });
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
    set({ busy: true });
    try {
      const { blob, report } = await buildWorkbook(ent);
      const fname = `5471_Workpaper_${safeName(state.stakeholder)}_${safeName(ent.name)}.xlsx`;
      downloadBlob(blob, fname);
      logEvent("Work paper generated", `${fname} · ${report.written} cells written`, ent.name, "system");
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

/* ---------------- helpers ---------------- */
function applyRowToLines(lines: Record<string, LineValue>, target: string, row: ExtractedRow) {
  const last = row.values[row.values.length - 1];
  if (target.startsWith("IS")) {
    const prev = lines[target] && typeof lines[target].amount === "number" ? (lines[target].amount as number) : 0;
    lines[target] = { amount: prev + last };
  } else {
    const boy = row.values.length > 1 ? row.values[row.values.length - 2] : null;
    const cur = lines[target] || {};
    lines[target] = {
      boy: boy === null ? (cur.boy ?? null) : (typeof cur.boy === "number" ? cur.boy + boy : boy),
      eoy: typeof cur.eoy === "number" ? cur.eoy + last : last,
    };
  }
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
  if (Object.keys(is).length) writes[SHEET.is] = is;
  if (Object.keys(bs).length) writes[SHEET.bs] = bs;
  return writes;
}

export type Blocker = { level: "block" | "warn"; message: string };

/** Anything that would make the generated workbook wrong or unusable. */
export function validateEntity(ent: Entity): Blocker[] {
  const out: Blocker[] = [];
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
    out.push({ level: "block", message: "Average exchange rate (C59) is missing — Schedule C USD columns will show #DIV/0!" });
  }
  if (hasBS && !rate("cyRate")) {
    out.push({ level: "block", message: "Current year end rate (C60) is missing — Schedule F end-of-year USD column will show #DIV/0!" });
  }
  if (hasBS && !rate("pyRate")) {
    out.push({ level: "block", message: "Prior year end rate (C61) is missing — Schedule F beginning-of-year USD column will show #DIV/0!" });
  }
  if (!ent.profile.currency) {
    out.push({ level: "warn", message: "Functional currency is not set — rates cannot be looked up automatically" });
  }
  if (!ent.profile.cyEnd) {
    out.push({ level: "warn", message: "Current year end is not set — the workbook header and rate year depend on it" });
  }
  if (ent.unmatched.length) {
    out.push({ level: "warn", message: `${ent.unmatched.length} extracted label(s) are still unassigned` });
  }
  if (!Object.keys(ent.categories).some((k) => ent.categories[k])) {
    out.push({ level: "warn", message: "No filing category selected" });
  }
  return out;
}

export function blockingIssues(ent: Entity): Blocker[] {
  return validateEntity(ent).filter((b) => b.level === "block");
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
      documents: e.files.map((f) => ({ name: f.name, size: f.size })),
      linesMapped: Object.keys(e.lines).length,
      unmatched: e.unmatched.length,
      cellsToWrite: cellCount(e),
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

async function buildWorkbook(ent: Entity) {
  const zip = await JSZip.loadAsync(templateBytes());
  const report = await applyWrites(zip, buildWrites(ent));
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
