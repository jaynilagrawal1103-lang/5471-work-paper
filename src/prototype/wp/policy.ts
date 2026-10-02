/* Mapping policy profile.

   Reviewers disagree about where some figures go, and each firm is
   consistent with itself: one keeps every staff cost on Schedule C line 11,
   another puts all of it on line 17; one files a realised exchange loss on
   8b, another on 8a. The keyword rules give ONE answer, so whichever firm the
   rules agree with sees a clean work paper and every other firm re-maps the
   same lines by hand on every client.

   A policy is that firm's answer, written down once. It is a set of named
   switches; every switch left unset keeps the rules' answer, so an empty
   policy changes nothing. The firm's policy is set in Settings and an entity
   can override any switch. Every figure a switch moves keeps its source, and
   its contribution names the switch, so the Provenance sheet says why it is
   where it is.

   Pure: no imports, no state. Both trees use the same code (dist carries
   this module compiled, global EN9POL). */

export type MappingPolicy = {
  /** Staff costs (Schedule C line 11): all on 11 (rules), all on 17, or only
      the owners'/directors' own pay on 11. */
  staffCosts?: "compensation" | "other-deductions" | "owners-only";
  /** Exchange gains and losses: as the caption says (rules), all realised
      (8b) or all unrealised (8a). */
  fxLine?: "auto" | "realized" | "unrealized";
  /** A cost the statement prints under cost of sales (outbound freight,
      payment-processor fees, bank charges) stays in cost of goods sold. */
  cogsAsPrinted?: boolean;
  /** Credit cards, deferred revenue and customer deposits: other current
      liabilities (rules) or other liabilities (line 19). */
  shortTermCredit?: "current" | "non-current";
  /** Trade payables vs other current liabilities. */
  payables?: "auto" | "all-accounts-payable" | "all-other-current-liabilities";
  /** "Acreedores varios", sundry/other creditors. */
  sundryCreditors?: "auto" | "accounts-payable" | "other-current-liabilities" | "other-liabilities";
  /** Advances to staff and tax credits/prepaid taxes: other current assets
      (rules) or trade receivables. */
  advances?: "other-current-assets" | "receivables";
  /** Loans from shareholders: line 18 (rules) or other liabilities (19). */
  shareholderLoans?: "line-18" | "other-liabilities";
  /** Equipment, machinery and vehicle hire: rents (12a) or line 17. */
  equipmentRental?: "rents" | "other-deductions";
  /** Gain or loss on disposal of assets: line 7 or other income (9). */
  capitalGains?: "line-7" | "other-income";
  /** Sales returns and discounts: line 1b (rules) or netted into 1a. */
  salesReturns?: "line-1b" | "net-in-1a";
  /** Fixed assets at cost less depreciation (9a/9b), or one net figure on
      other assets (line 13). */
  fixedAssets?: "gross" | "net-other-assets";
  /** Trade debtors and trade creditors netted into other current assets. */
  netTradeBalances?: boolean;
  /** Share capital on common stock (20b, rules) or paid-in capital (21). */
  shareCapital?: "common-stock" | "paid-in";
  /** A UK pack prints the statutory P&L and a "Detailed profit and loss
      account" behind it. Book the face (rules) or the detailed account,
      which itemises compensation, rent and depreciation onto their own lines. */
  detailedAccounts?: "face" | "detail";
  /** Each Schedule C and F line written in whole units of the local
      currency, as hand-prepared papers are; the figures behind them keep
      their cents. */
  wholeUnits?: boolean;
  /** The template's line 23a is captioned "Current year net income or (loss)
      per books"; some reviewers fill it, so other comprehensive income (24)
      equals net income. */
  ociEqualsNetIncome?: boolean;
};

export type PolicySwitch = keyof MappingPolicy;

/** The switches, their choices and plain-English labels — the Settings and
    Entity screens render these, so the two trees cannot drift. The first
    choice is always the rules' own answer. */
export const POLICY_SWITCHES: Array<{ key: PolicySwitch; label: string; choices: Array<[string, string]> }> = [
  { key: "staffCosts", label: "Staff costs", choices: [["compensation", "All on line 11 (compensation)"], ["other-deductions", "All on line 17 (other deductions)"], ["owners-only", "Only owners'/directors' pay on line 11, the rest on 17"]] },
  { key: "fxLine", label: "Exchange gains and losses", choices: [["auto", "As the caption says (8a unless realised)"], ["realized", "Always 8b (realised)"], ["unrealized", "Always 8a (unrealised)"]] },
  { key: "cogsAsPrinted", label: "Costs printed under cost of sales", choices: [["false", "Delivery and processor fees move to line 17"], ["true", "Keep everything the statement puts in cost of sales on line 2"]] },
  { key: "shortTermCredit", label: "Credit cards, deferred revenue, customer deposits", choices: [["current", "Other current liabilities (line 16)"], ["non-current", "Other liabilities (line 19)"]] },
  { key: "payables", label: "Payables", choices: [["auto", "Trade payables on 15, the rest on 16"], ["all-accounts-payable", "Every current payable on line 15"], ["all-other-current-liabilities", "Every current payable on line 16"]] },
  { key: "sundryCreditors", label: "Sundry creditors (acreedores varios)", choices: [["auto", "As the rules place them"], ["accounts-payable", "Accounts payable (15)"], ["other-current-liabilities", "Other current liabilities (16)"], ["other-liabilities", "Other liabilities (19)"]] },
  { key: "advances", label: "Advances to staff, tax credits", choices: [["other-current-assets", "Other current assets (line 5)"], ["receivables", "Trade receivables (line 2a)"]] },
  { key: "shareholderLoans", label: "Loans from shareholders", choices: [["line-18", "Line 18"], ["other-liabilities", "Other liabilities (line 19)"]] },
  { key: "equipmentRental", label: "Equipment hire", choices: [["rents", "Rents (line 12a)"], ["other-deductions", "Other deductions (line 17)"]] },
  { key: "capitalGains", label: "Gain or loss on disposal of assets", choices: [["line-7", "Line 7"], ["other-income", "Other income (line 9)"]] },
  { key: "salesReturns", label: "Sales returns and discounts", choices: [["line-1b", "Line 1b"], ["net-in-1a", "Netted into gross receipts (1a)"]] },
  { key: "fixedAssets", label: "Fixed assets", choices: [["gross", "Cost on 9a, depreciation on 9b"], ["net-other-assets", "One net figure on other assets (line 13)"]] },
  { key: "netTradeBalances", label: "Trade debtors and creditors", choices: [["false", "Separately (2a and 15)"], ["true", "Netted into other current assets (line 5)"]] },
  { key: "shareCapital", label: "Share capital", choices: [["common-stock", "Common stock (20b)"], ["paid-in", "Paid-in or capital surplus (21)"]] },
  { key: "detailedAccounts", label: "Detailed profit and loss account", choices: [["face", "Book the statutory face statement"], ["detail", "Book the detailed account line by line"]] },
  { key: "wholeUnits", label: "Rounding of Schedule C and F lines", choices: [["false", "As booked (to the cent)"], ["true", "Whole units, line by line"]] },
  { key: "ociEqualsNetIncome", label: "Line 23a (other comprehensive income)", choices: [["false", "Blank"], ["true", "Net income per books, as the template captions it"]] },
];

/** Firm policy, then the entity's own switches on top. Unset = rules. */
export function effectivePolicy(firm?: MappingPolicy | null, entity?: MappingPolicy | null): MappingPolicy {
  const out: MappingPolicy = {};
  for (const src of [firm || {}, entity || {}]) {
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined || v === null || (v as unknown) === "") continue;
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/** True when the policy moves nothing. */
export function isEmptyPolicy(p?: MappingPolicy | null): boolean {
  const e = effectivePolicy(p, null);
  return !POLICY_SWITCHES.some((s) => {
    const v = (e as Record<string, unknown>)[s.key];
    return v !== undefined && String(v) !== s.choices[0][0];
  });
}

export type PolicyRow = {
  label: string;
  feed?: string | null;
  section?: string | null;
  /** Names of the shareholders/owners, for "owners-only" staff costs. */
  ownerNames?: string[];
};

export type PolicyMove = {
  target: string;
  /** Plain-English reason, stamped on the contribution. */
  rule: string;
  /** Book these into ONE pool row captioned so. */
  group?: string;
  /** Force the booked value's sign after routing: -1 = always negative. */
  sign?: -1;
};

const OWNER_WORDS = /\b(director|directors'?|owner|owners'?|officer|officers'?|shareholder|proprietor|partner|member|socio|accionista|gerente|g[eé]rant|gesch[aä]ftsf[uü]hrer|bestuurder|amministrator|administrador|management (?:salar|fee))/i;
const STAFF_ADVANCE = /\b(antic\.?|anticipos?|advances?|loans?)\s+(?:a\s+|to\s+)?(trabajadores|empleados|personal|staff|employees?)\b|\b(antic\.?|anticipos?)\s+(?:de\s+)?(imptos|impuestos)|\bsaldo a favor\b|\b(tax|vat|gst)\s+(credit|receivable|refund)/i;
const SUNDRY = /\b(acreedores\s+(varios|diversos)|otros\s+acreedores|sundry\s+creditors?|other\s+creditors?|cr[eé]diteurs\s+divers)\b/i;
const SHORT_CREDIT = /\b(credit\s*cards?|amex|visa|mastercard|deferred\s+(revenue|income)|unearned\s+(revenue|income)|customer\s+deposits?|anticipos?\s+de\s+clientes)\b/i;
const EQUIPMENT_HIRE = /\b(equipment|machinery|plant|vehicle|car|truck|tool)s?\s+(rental|hire|lease|leasing)\b|\b(rental|hire|lease)\s+of\s+(equipment|machinery|plant|vehicles?)\b/i;
/* "Wages - Heather Claycomb": pay booked under a person's name. */
const NAMED_PAY = /\b(?:[Ww]ages?|WAGES?|[Ss]alar(?:y|ies)|SALAR(?:Y|IES)|[Rr]emuneration|[Pp]ay)\s*[-–:]\s*\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)+/u;

function isOwnersPay(row: PolicyRow): boolean {
  const l = String(row.label || "");
  if (OWNER_WORDS.test(l) || NAMED_PAY.test(l)) return true;
  const low = l.toLowerCase();
  return (row.ownerNames || []).some((n) => String(n || "").toLowerCase().split(/[\s,]+/)
    .filter((w) => w.length >= 3).some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(low)));
}

/** Where the policy puts a figure the rules sent to `target`, or null when
    the policy leaves it there. Never called for a preparer's own
    assignment: that is a decision, not a convention. */
export function policyTarget(target: string, row: PolicyRow, p: MappingPolicy): PolicyMove | null {
  if (!target || target === "SKIP") return null;
  const l = String(row.label || "");
  const isOD = (t: string) => t === "IS:OD" || /^IS:(3[3-9]|4\d|5[0-8])$/.test(t);
  if (target === "IS:26" && p.staffCosts === "other-deductions") return { target: "IS:OD", rule: "staff costs on line 17" };
  if (target === "IS:26" && p.staffCosts === "owners-only" && !isOwnersPay(row)) return { target: "IS:OD", rule: "only owners' and directors' pay on line 11" };
  if ((target === "IS:19" || target === "IS:20") && p.fxLine === "realized" && target !== "IS:20") return { target: "IS:20", rule: "exchange differences on 8b" };
  if ((target === "IS:19" || target === "IS:20") && p.fxLine === "unrealized" && target !== "IS:19") return { target: "IS:19", rule: "exchange differences on 8a" };
  if (p.cogsAsPrinted && row.feed === "is" && row.section === "cogs" && isOD(target)) return { target: "IS:12", rule: "costs printed under cost of sales stay in cost of goods sold" };
  if (target === "IS:27" && p.equipmentRental === "other-deductions" && EQUIPMENT_HIRE.test(l)) return { target: "IS:OD", rule: "equipment hire on line 17" };
  if (target === "IS:18" && p.capitalGains === "other-income") return { target: "IS:OI", rule: "disposal gains and losses in other income" };
  if (/^BS:(46|OCL|4[7-9]|50|OL|5[3-6])$/.test(target) && SUNDRY.test(l) && p.sundryCreditors && p.sundryCreditors !== "auto") {
    const to = p.sundryCreditors === "accounts-payable" ? "BS:46" : p.sundryCreditors === "other-liabilities" ? "BS:OL" : "BS:OCL";
    if (to !== target) return { target: to, rule: "sundry creditors on " + (to === "BS:46" ? "line 15" : to === "BS:OL" ? "line 19" : "line 16") };
  }
  if (/^BS:(OCL|4[7-9]|50)$/.test(target) && p.shortTermCredit === "non-current" && SHORT_CREDIT.test(l)) return { target: "BS:OL", rule: "credit cards and deferred revenue on line 19" };
  if (target === "BS:46" && p.netTradeBalances) return { target: "BS:OCA", rule: "trade creditors netted into other current assets", group: "Trade debtors less trade creditors", sign: -1 };
  if (target === "BS:11" && p.netTradeBalances) return { target: "BS:OCA", rule: "trade debtors netted into other current assets", group: "Trade debtors less trade creditors" };
  if (target === "BS:46" && p.payables === "all-other-current-liabilities") return { target: "BS:OCL", rule: "every current payable on line 16" };
  if (/^BS:(OCL|4[7-9]|50)$/.test(target) && p.payables === "all-accounts-payable") return { target: "BS:46", rule: "every current payable on line 15" };
  if (/^BS:(OCA|1[5-8])$/.test(target) && p.advances === "receivables" && STAFF_ADVANCE.test(l)) return { target: "BS:11", rule: "advances and tax credits with trade receivables" };
  if (target === "BS:52" && p.shareholderLoans === "other-liabilities") return { target: "BS:OL", rule: "shareholder loans on line 19" };
  if ((target === "BS:28" || target === "BS:29") && p.fixedAssets === "net-other-assets") return { target: "BS:39", rule: "fixed assets at net book value on line 13", group: "Fixed assets (net book value)" };
  if (target === "BS:59" && p.shareCapital === "paid-in") return { target: "BS:60", rule: "share capital on line 21" };
  return null;
}

/** Sales returns netted into gross receipts. Applied AFTER the contra-revenue
    sign rule, so the line-1b magnitude is subtracted from 1a. */
export function policyNetReturns(target: string, p: MappingPolicy): PolicyMove | null {
  return target === "IS:8" && p.salesReturns === "net-in-1a" ? { target: "IS:7", rule: "returns and discounts netted into gross receipts", sign: -1 } : null;
}

/** A one-line description of the switches that differ from the rules, for the
    log and the Provenance sheet. */
export function describePolicy(p: MappingPolicy): string {
  const parts: string[] = [];
  for (const s of POLICY_SWITCHES) {
    const v = (p as Record<string, unknown>)[s.key];
    if (v === undefined || String(v) === s.choices[0][0]) continue;
    const c = s.choices.find((x) => x[0] === String(v));
    parts.push(`${s.label}: ${c ? c[1] : String(v)}`);
  }
  return parts.join("; ");
}
