/* The terminology layer — meaning before matching.
 *
 * Identification used to ask one question: does this page's title appear in a
 * list somebody wrote down? A Chilean income tax return answers no, and so
 * did every document in a language nobody had got to yet: read perfectly,
 * classified UNKNOWN, mapped nothing. This module answers the question the
 * pipeline actually needs — what does the page SAY — before anything is
 * classified, extracted or mapped, and it does it offline: no key, no
 * network, no model. A translation service can only run after a document has
 * been read and queued; identification happens first, so identification needs
 * its own vocabulary.
 *
 * Two tables, both plain data:
 *   DOC_TERMS      — what a document calls itself, in the languages clients
 *                    actually send, mapped to what it IS.
 *   CAPTION_TERMS  — accounting captions, mapped to the English a preparer
 *                    would write. Whole phrases only: a partial guess on an
 *                    accounting caption is worse than no guess at all.
 *
 * Nothing here maps to a Form 5471 line. The mapping catalogue keeps that
 * job; this only supplies the English it already understands.
 */

/** Diacritics are decoration. Folding is applied to both sides of every
    comparison in this file, so "Posición" and "Posicion" are one word. */
export const fold = (s: string): string =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export type DocTermKind = "tax-return" | "balance-sheet" | "income-statement" | "equity" | "notes";

/* What the document calls itself. Matched against the FOLDED text of a page,
   so the accented and unaccented spellings are one entry.

   A tax return is not a set of accounts, and the difference decides what may
   be booked from it: a return states totals a statement itemises. */
export const DOC_TERMS: { re: RegExp; kind: DocTermKind; lang: string; en: string }[] = [
  // ---- income tax returns ----
  { re: /impuestos? anuales? a la renta/, kind: "tax-return", lang: "es", en: "annual income tax return" },
  { re: /declaracion (anual )?(de )?(impuesto a la )?renta/, kind: "tax-return", lang: "es", en: "income tax return" },
  { re: /servicio de impuestos internos/, kind: "tax-return", lang: "es", en: "internal revenue service" },
  { re: /formulario\s*n?\.?\s*22\b|form\.?\s*22\b/, kind: "tax-return", lang: "es", en: "form 22" },
  { re: /declaracion jurada anual/, kind: "tax-return", lang: "es", en: "annual return" },
  { re: /declaracion de renta de personas juridicas/, kind: "tax-return", lang: "es", en: "corporate income tax return" },
  { re: /company tax return|corporation(?: income)? tax return/, kind: "tax-return", lang: "en", en: "company tax return" },
  { re: /declaration de resultats|liasse fiscale/, kind: "tax-return", lang: "fr", en: "corporate tax return" },
  { re: /korperschaftsteuererklarung|steuererklarung/, kind: "tax-return", lang: "de", en: "corporate tax return" },
  { re: /dichiarazione dei redditi/, kind: "tax-return", lang: "it", en: "income tax return" },
  { re: /declaracao de (imposto de renda|rendimentos)/, kind: "tax-return", lang: "pt", en: "income tax return" },
  { re: /aangifte vennootschapsbelasting/, kind: "tax-return", lang: "nl", en: "corporate tax return" },
  // ---- balance sheets ----
  { re: /balance general|posicion financiera|situacion financiera|balance de situacion/, kind: "balance-sheet", lang: "es", en: "balance sheet" },
  { re: /estado de situacion patrimonial/, kind: "balance-sheet", lang: "es", en: "balance sheet" },
  { re: /balanco patrimonial/, kind: "balance-sheet", lang: "pt", en: "balance sheet" },
  { re: /bilan\b/, kind: "balance-sheet", lang: "fr", en: "balance sheet" },
  { re: /bilanz\b/, kind: "balance-sheet", lang: "de", en: "balance sheet" },
  { re: /stato patrimoniale|bilancio\b/, kind: "balance-sheet", lang: "it", en: "balance sheet" },
  { re: /balans\b/, kind: "balance-sheet", lang: "nl", en: "balance sheet" },
  // ---- income statements ----
  { re: /estado de resultados?|cuenta de resultados|estado de ganancias y perdidas/, kind: "income-statement", lang: "es", en: "income statement" },
  { re: /demonstracao do resultado/, kind: "income-statement", lang: "pt", en: "income statement" },
  { re: /compte de resultat|compte de profits et pertes/, kind: "income-statement", lang: "fr", en: "income statement" },
  { re: /gewinn- und verlustrechnung|erfolgsrechnung/, kind: "income-statement", lang: "de", en: "income statement" },
  { re: /conto economico/, kind: "income-statement", lang: "it", en: "income statement" },
  { re: /winst- en verliesrekening/, kind: "income-statement", lang: "nl", en: "income statement" },
  // ---- other sections ----
  { re: /estado de cambios en el patrimonio/, kind: "equity", lang: "es", en: "statement of changes in equity" },
  { re: /notas a los estados financieros/, kind: "notes", lang: "es", en: "notes to the financial statements" },
];

/** What a page says it is, from its own words, in any of the languages above.
    The FIRST match wins, and a tax return outranks a statement because a
    return quotes statement headings inside its own boxes. */
export function identifyByTerms(text: string): { kind: DocTermKind; lang: string; en: string; term: string } | null {
  const t = fold(text);
  let best: { kind: DocTermKind; lang: string; en: string; term: string } | null = null;
  for (const e of DOC_TERMS) {
    const m = e.re.exec(t);
    if (!m) continue;
    const hit = { kind: e.kind, lang: e.lang, en: e.en, term: m[0] };
    if (e.kind === "tax-return") return hit;
    if (!best) best = hit;
  }
  return best;
}

/* Accounting captions, to the English a preparer would write. Whole phrases,
   because a partial translation of an accounting caption is a mistranslation:
   "otros gastos deducibles de los ingresos" is an expense and "otros
   ingresos" is income, and the two share a word.

   These do not decide any mapping. They give the preparer, the provenance
   sheet and the review items the English beside the original. */
export const CAPTION_TERMS: Record<string, string> = {
  // Spanish — statement of income
  "ingresos del giro percibidos": "trading income received",
  "ingresos del giro percibidos o devengados": "trading income received or accrued",
  "otros ingresos percibidos o devengados": "other income received or accrued",
  "total de ingresos anuales": "total annual income",
  "costo directo de los bienes y servicios": "direct cost of goods and services",
  "existencias, insumos y servicios del negocio, pagados": "inventories, supplies and services paid",
  "remuneraciones": "wages and salaries",
  "remuneraciones pagadas": "wages and salaries paid",
  "honorarios pagados": "professional fees paid",
  "arriendos": "rent",
  "arriendos pagados": "rent paid",
  "intereses pagados o adeudados": "interest paid or owing",
  "intereses y reajustes pagados por prestamos y otros": "interest and indexation paid on loans and other",
  "depreciacion financiera del ejercicio": "book depreciation for the year",
  "depreciacion tributaria del ejercicio": "tax depreciation for the year",
  "otros gastos deducibles de los ingresos": "other deductible expenses",
  "otros gastos deducidos de los ingresos brutos": "other expenses deducted from gross income",
  "total de egresos anuales": "total annual expenses",
  "resultado financiero": "financial result",
  "correccion monetaria": "monetary correction",
  "corteccion monetaria": "monetary correction",
  "utilidad del ejercicio": "profit for the year",
  "perdida del ejercicio": "loss for the year",
  "perdidas tributarias de ejercicios anteriores": "tax losses brought forward",
  "renta liquida imponible": "taxable income",
  // Spanish — balance sheet
  "total del activo": "total assets",
  "total del pasivo": "total liabilities",
  "activo inmovilizado": "fixed assets",
  "capital efectivo": "paid-up capital",
  "patrimonio financiero": "shareholders' equity",
  "capital propio tributario": "tax capital",
  "bancos": "cash at bank",
  "caja": "cash",
  "deudores diversos": "sundry debtors",
  "acreedores diversos": "sundry creditors",
  "proveedores": "trade creditors",
  "terrenos": "land",
  "edificios": "buildings",
  "maquinaria y equipo": "machinery and equipment",
  "equipo de transporte": "transport equipment",
  "mobiliario y equipo de oficina": "office furniture and equipment",
  "depreciacion acumulada": "accumulated depreciation",
  "impuestos por pagar": "taxes payable",
  "impuestos a favor": "taxes recoverable",
  "impuestos anticipados": "prepaid taxes",
  "anticipo a proveedores": "advances to suppliers",
  "capital social": "common stock",
  "resultado de ejercicios anteriores": "retained earnings",
  "resultado del ejercicio": "result for the year",
  // Portuguese
  "receita bruta": "gross revenue",
  "custo dos produtos vendidos": "cost of goods sold",
  "despesas operacionais": "operating expenses",
  "lucro liquido do exercicio": "net profit for the year",
  // French
  "chiffre d'affaires": "turnover",
  // French and Swiss statements — leaf captions only. A subtotal line is
  // left out on purpose ("Trésorerie", "Passifs de régularisation"): it is
  // dropped by its arithmetic, and translating it would book it twice.
  // "Bénéfice de l'exercice" is left out too: on a balance sheet it is the
  // year's result inside equity, and "profit for the year" is a skipped total.
  "banques": "cash at bank",
  "caisse": "cash on hand",
  "caisses": "cash on hand",
  "liquidites": "cash",
  "clients": "trade receivables",
  "debiteurs": "accounts receivable",
  "c/c associe": "loan to shareholder",
  "compte courant associe": "loan to shareholder",
  "comptes courants associes": "loan to shareholder",
  "stocks": "inventory",
  "marchandises": "inventory",
  "actifs transitoires": "prepaid expenses",
  "charges constatees d'avance": "prepaid expenses",
  "immobilisations corporelles": "property, plant and equipment",
  "mobilier et installations": "furniture and fittings",
  "materiel informatique": "computer equipment",
  "vehicules": "motor vehicles",
  "amortissements cumules": "accumulated depreciation",
  "fournisseurs": "trade creditors",
  "dettes fournisseurs": "trade creditors",
  "creanciers": "trade creditors",
  "charges a payer": "accrued expenses",
  "passifs transitoires": "accrued expenses",
  "provision pour impots": "income tax payable",
  "provisions pour impots": "income tax payable",
  "impots a payer": "income tax payable",
  "capital-actions": "share capital",
  "capital actions": "share capital",
  "capital-social": "share capital",
  "report a nouveau": "retained earnings",
  "benefice reporte": "retained earnings",
  "perte reportee": "retained earnings",
  "prestations de services": "revenue from services",
  "ventes": "sales",
  "ventes de marchandises": "sales of goods",
  "loyer": "rent",
  "loyers": "rent",
  "loyers et charges": "rent",
  "salaires": "salaries and wages",
  "charges sociales": "payroll taxes",
  "fournitures de bureau": "office expenses",
  "fournitures de bureau et informatique": "office expenses",
  "cotisations": "subscriptions",
  "cotisations, affiliations": "subscriptions",
  "frais de communication": "telephone and communications",
  "frais de telecommunication": "telephone and communications",
  "frais de publicite": "advertising",
  "publicite": "advertising",
  "frais de deplacements": "travel expenses",
  "frais de deplacement": "travel expenses",
  "frais de documentation et de formation": "books and subscriptions",
  "frais de comptabilite": "accounting fees",
  "petit materiel": "small material",
  "petit materiel et fournitures": "small material and supplies",
  "petit materiel et fournitures de training": "small material and training supplies",
  "honoraires comptables": "accounting fees",
  "honoraires juridiques": "legal fees",
  "assurances": "insurance",
  "entretien et reparations": "repairs and maintenance",
  "interets crediteurs": "interest income",
  "produits financiers": "interest income",
  "interets debiteurs": "interest expense",
  "charges financieres": "interest expense",
  "frais bancaires": "bank charges",
  "impots": "income tax expense",
  "impots directs": "income tax expense",
  "impots sur le benefice": "income tax expense",
  "amortissements": "depreciation",
  "achats de marchandises": "purchases of goods",
  "charges de personnel": "personnel costs",
  "dotations aux amortissements": "depreciation charge",
  "resultat de l'exercice": "result for the year",
  // German
  "umsatzerlose": "revenue",
  "personalaufwand": "personnel expenses",
  "abschreibungen": "depreciation",
  "jahresuberschuss": "profit for the year",
  // Italian
  "ricavi delle vendite": "sales revenue",
  "costi per il personale": "personnel costs",
  "ammortamenti": "depreciation",
  // Dutch
  "omzet": "turnover",
  "personeelskosten": "personnel costs",
  "afschrijvingen": "depreciation",
};

/** The English for one caption, or null. Whole-phrase only — see above. */
export function translateCaption(label: string): string | null {
  const k = fold(label).replace(/[.:;]+$/, "").replace(/\s*\.{2,}\s*$/, "");
  const hit = CAPTION_TERMS[k] || CAPTION_SQUEEZED().get(squeeze(k));
  if (hit) return hit;
  /* "Frais de comptabilitée": a doubled final e (a common typo, and an OCR
     echo) is the only difference from the glossary word. */
  const e = k.replace(/ee\b/g, "e");
  return e !== k ? CAPTION_TERMS[e] || CAPTION_SQUEEZED().get(squeeze(e)) || null : null;
}

/* OCR drops spaces and apostrophes in running text ("Report à nouveau" →
   "Reporta nouveau", "pour impôts" → "pourimpots") and confuses the thin
   strokes ("C/C" → "CIC"). The second look-up compares the whole caption
   with those removed or merged — still whole-phrase, never a partial match,
   and only for keys of five or more characters. "rn" read as "m"
   ("fournitures" → "foumitures") is folded the same way. */
const squeeze = (s: string): string =>
  fold(s).replace(/[\s'\u2019.,&-]+/g, "").replace(/[/|il1]/g, "l").replace(/0/g, "o").replace(/rn/g, "m");
let squeezed: Map<string, string> | null = null;
function CAPTION_SQUEEZED(): Map<string, string> {
  if (squeezed) return squeezed;
  squeezed = new Map();
  for (const [k, v] of Object.entries(CAPTION_TERMS)) {
    const z = squeeze(k);
    if (z.length >= 5 && !squeezed.has(z)) squeezed.set(z, v);
  }
  return squeezed;
}

/* Function words that give a language away. Script alone cannot separate
   Spanish from Portuguese or French from Italian, and an accounting page is
   mostly proper nouns and numbers, so the small words decide. */
const LANG_WORDS: [string, RegExp][] = [
  ["Spanish", /\b(del|de los|las|por|segun|ejercicio|impuesto|renta|anual|pagados|cuenta)\b/g],
  ["Portuguese", /\b(das|dos|exercicio|imposto|receita|despesas|liquido)\b/g],
  ["French", /\b(des|les|du|charges|produits|exercice|resultat|societe)\b/g],
  ["German", /\b(und|der|die|das|aufwand|ertrag|jahres|gesellschaft)\b/g],
  ["Italian", /\b(dei|delle|degli|esercizio|ricavi|costi|societa)\b/g],
  ["Dutch", /\b(van|het|een|kosten|opbrengsten|boekjaar|vennootschap)\b/g],
  ["English", /\b(the|and|for|year|ended|total|income|assets|liabilities)\b/g],
];

/** The language of a body of text, by function words over folded text.
 *
 * Run BEFORE classification, not after mapping: a document's language decides
 * which vocabulary can identify it, and knowing it afterwards is knowing it
 * too late. Returns "English" when nothing else scores higher, because that
 * is the assumption the rest of the pipeline already makes. */
export function detectTextLanguage(text: string): { name: string; score: number } {
  const t = fold(text);
  let best = "English";
  let top = 0;
  for (const [name, re] of LANG_WORDS) {
    re.lastIndex = 0;
    const n = (t.match(re) || []).length;
    if (n > top) { top = n; best = name; }
  }
  return { name: best, score: top };
}
