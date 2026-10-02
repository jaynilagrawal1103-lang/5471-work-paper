/* A creditors line on the face of the balance sheet, broken down by its note.

   UK small-company accounts print one figure for "Creditors: amounts falling
   due within one year" and list what it is made of in a note: trade
   creditors, taxes and social security, a director's loan, finance leases,
   accruals. Those components belong on different Schedule F lines — 15, 16,
   18 and 19 — and line 18 also drives Schedule M, so booking the face figure
   whole on accounts payable misstates three lines at once.

   The note replaces the face row only when its arithmetic proves it is the
   same balance: consecutive rows under a heading that names the face caption
   add up to the face figure in every year printed. Anything less and the face
   row stays as it was. Debtors are left whole: their components (trade and
   other debtors) sit on lines 2a and 5, both current assets, and the reviewed
   papers book the face figure.

   Pure: no imports. Both trees use this code (dist: global EN9NB). */

export type NoteRowLike = {
  label: string;
  values: number[];
  years?: (number | null)[];
  page?: number;
  x0?: number;
};

/** The side of the balance sheet the components sit on. They are printed on
    a notes page, under no banner, so the face caption has to say it: "falling
    due within one year" is current (Schedule F lines 15-18), "after more than
    one year" is long-term. Without it a finance lease in the current
    creditors was booked as a long-term borrowing and the taxes and accruals
    found no line at all. */
export type NoteBreakdown = { faceIndex: number; components: NoteRowLike[]; heading: string; page?: number;
  section: "liabilities" | "termLiabilities" };

const LONG_TERM = /\b(after (?:more than )?one year|more than (?:one|1) year|non[- ]?current|long[- ]term|largo plazo|lange termijn|langfristig|plus d'un an)\b/i;
const sideOf = (label: string): NoteBreakdown["section"] => (LONG_TERM.test(label) ? "termLiabilities" : "liabilities");

/* A caption that groups several balances: "Creditors", "Trade and other
   payables". One tax owed ("Income Tax Payable") is a single balance; its
   note is a movement (opening balance, tax paid, charge for the year) that
   adds up to it without being made of it. */
const LIABILITY_CAPTION = /\b(creditors?|payables|acreedores|dettes|verbindlichkeiten|schulden|crediteuren)\b/i;
const NOT_A_COMPOSITION = /\b(tax|taxation|impuesto|imp[o\u00f4]t|steuer)\b/i;
/** A row of a movement schedule, not a balance: the run it sits in is a
    reconciliation of one balance, never its parts. */
const MOVEMENT_ROW = /\b(opening|closing)\s+balance|balance\s+(?:at|brought|carried|b\/f|c\/f)|brought\s+forward|carried\s+forward|\bb\/f\b|\bpaid\b|refunded|charge\s+for\s+the\s+year|saldo\s+inicial/i;
const key = (s: string): string => String(s || "").toLowerCase()
  .replace(/^\s*(?:note\s*)?\d+(?:\.\d+)*[.)]?\s+/, "")
  .replace(/[^a-z0-9]+/g, " ").trim();

/** The face row's figures keyed by year (or by position when it carries no
    year tags); a note reference printed before them ("6") has no year and is
    ignored. */
function faceKeys(f: NoteRowLike): Array<[string, number]> {
  const v = f.values || [], ys = f.years || [];
  if (ys.length === v.length && ys.some((y) => typeof y === "number")) {
    return v.map((x, i) => [typeof ys[i] === "number" ? `y${ys[i]}` : "", x] as [string, number]).filter((p) => p[0]);
  }
  const tail = v.slice(Math.max(0, v.length - 2));
  return tail.map((x, i) => [`p${i}`, x] as [string, number]);
}

/** A component's figures on the face's keys. Untagged figures fill the keys
    in order, current year first — a note prints "7,362  -" for a balance
    that did not exist last year. */
function onKeys(r: NoteRowLike, keys: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const v = r.values || [], ys = r.years || [];
  if (ys.length === v.length && ys.some((y) => typeof y === "number") && keys[0]?.startsWith("y")) {
    v.forEach((x, i) => { const y = ys[i]; if (typeof y === "number") out.set(`y${y}`, (out.get(`y${y}`) || 0) + x); });
    return out;
  }
  const take = v.length >= keys.length ? v.slice(v.length - keys.length) : v;
  take.forEach((x, i) => out.set(keys[i], (out.get(keys[i]) || 0) + x));
  return out;
}

const ties = (sums: Map<string, number>, target: Array<[string, number]>) =>
  target.every(([k, v]) => Math.abs(Math.abs(sums.get(k) || 0) - Math.abs(v)) <= 1);

/** Consecutive rows from `start` on one page whose figures add up to the
    face row in every printed year; at least two of them. */
function run(noteRows: NoteRowLike[], start: number, target: Array<[string, number]>): NoteRowLike[] | null {
  const keys = target.map((p) => p[0]);
  const sums = new Map<string, number>();
  const comps: NoteRowLike[] = [];
  const page = noteRows[start]?.page;
  for (let j = start; j < noteRows.length && comps.length < 15; j++) {
    const r = noteRows[j];
    if (r.page !== page) break;
    if (!String(r.label || "").trim() || !(r.values || []).length) { if (comps.length) break; continue; }
    if (MOVEMENT_ROW.test(r.label)) return null;
    comps.push(r);
    for (const [k, v] of onKeys(r, keys)) sums.set(k, (sums.get(k) || 0) + v);
    if (comps.length >= 2 && ties(sums, target)) return comps;
  }
  return null;
}

export function liabilityNoteBreakdown(noteRows: NoteRowLike[], face: NoteRowLike[], pageText?: Record<number, string>): NoteBreakdown[] {
  const out: NoteBreakdown[] = [];
  const used = new Set<number>();
  face.forEach((f, fi) => {
    if (!LIABILITY_CAPTION.test(f.label || "") || NOT_A_COMPOSITION.test(f.label || "") || !(f.values || []).length) return;
    const fk = key(f.label);
    if (fk.length < 8) return;
    const target = faceKeys(f);
    if (!target.length || target.every(([, v]) => !v)) return;
    /* 1. a heading row naming the face caption, the components under it */
    for (let h = 0; h < noteRows.length; h++) {
      if (used.has(h)) continue;
      const hk = key(noteRows[h].label);
      if (!hk || hk.length < 8 || !(hk === fk || hk.endsWith(fk) || fk.endsWith(hk))) continue;
      const comps = run(noteRows, h + 1, target);
      if (comps) { out.push({ faceIndex: fi, components: comps, heading: noteRows[h].label, page: noteRows[h].page, section: sideOf(f.label) }); used.add(h); return; }
    }
    /* 2. the heading was not read as a row (a numbered note title): any run
       on a page whose text names the caption, proved by the arithmetic in
       every printed year */
    if (!pageText || target.length < 2) return;
    for (let j = 0; j < noteRows.length; j++) {
      const pg = noteRows[j].page;
      if (pg == null || !key(pageText[pg] || "").includes(fk)) continue;
      const comps = run(noteRows, j, target);
      if (comps) { out.push({ faceIndex: fi, components: comps, heading: f.label, page: pg, section: sideOf(f.label) }); return; }
    }
  });
  return out;
}
