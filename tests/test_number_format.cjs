/* Number formats the parser must read.
 *
 * Chile (and Spain, Germany, Brazil) group thousands with dots. The parser
 * only stripped dots when a comma was also present, so a dot-grouped figure
 * fell through to parseFloat, which stops at the second dot: the Cecilia
 * Gonzalez Acuna SpA balance sheet read 2.555.002.379 as 2.555 — a billion
 * times too small, silently.
 *
 * Figures below are the real ones from the client's SII Form 22 filings.
 */
const assert = require("assert");
const fs = require("fs");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

/* numeric(), lifted from the shipped engine so the test tracks the real code. */
const src = fs.readFileSync(require.resolve("../src/prototype/wp/engine.ts"), "utf8");
const body = src.slice(src.indexOf("export function numeric("));
/* The body starts at the LAST brace on the signature line, not the first one
   in the file: `numeric(v, opts?: { dotThousands?: boolean })` puts an options
   type ahead of it, and taking the first brace lifted that type instead of the
   function and made this whole suite fail to parse. */
const head = body.slice(0, body.indexOf("\n"));
const start = body.lastIndexOf("{", head.length);
const fnText = body.slice(start, body.indexOf("\n}") + 2)
  .replace(/: unknown|: number \| null|: string/g, "");
const numeric = new Function("v", "opts", fnText.slice(1, -1).replace(/^\s*/, ""));

t("Chilean thousands: total assets", () => assert.strictEqual(numeric("2.555.002.379"), 2555002379));
t("Chilean thousands: total liabilities", () => assert.strictEqual(numeric("2.349.644.310"), 2349644310));
t("Chilean thousands: operating revenue", () => assert.strictEqual(numeric("1.973.582.648"), 1973582648));
t("Chilean thousands: salaries", () => assert.strictEqual(numeric("779.000.384"), 779000384));
t("Chilean thousands: Charlie Brawn total assets", () => assert.strictEqual(numeric("464.138.576"), 464138576));
t("Chilean thousands: negative", () => assert.strictEqual(numeric("-3.658.471"), -3658471));

/* Formats that already worked and must not regress. */
t("US thousands with comma", () => assert.strictEqual(numeric("2,555,002,379"), 2555002379));
t("US figure with trailing period", () => assert.strictEqual(numeric("43,240."), 43240));
t("European decimal comma", () => assert.strictEqual(numeric("1.449,37"), 1449.37));
t("plain decimal point", () => assert.strictEqual(numeric("1449.37"), 1449.37));
t("six-place decimal is NOT a thousands group", () => assert.strictEqual(numeric("0.241879"), 0.241879));
t("bracketed negative", () => assert.strictEqual(numeric("(1,274)"), -1274));
t("credit suffix", () => assert.strictEqual(numeric("1,234 CR"), -1234));
t("blank is null", () => assert.strictEqual(numeric(""), null));
t("text is null", () => assert.strictEqual(numeric("Total del Activo"), null));

/* A single dot stays ambiguous and keeps its existing reading — documented so
   a future change does not silently flip it. */
t("one dot is still read as a decimal point", () => assert.strictEqual(numeric("464.138"), 464.138));

/* …until the DOCUMENT settles the convention. The Charlie Brawn Form 22
   prints 928.368.104 in one box and 49.943 in another; read in isolation the
   second is 49.94, a thousand times too small, on the same form as figures
   that can only be dot-grouped. The caller opts in once the page has been
   read as a whole (dotThousandsDocument), never from one token. */
t("a single dot IS a thousands group once the document says so", () => {
  assert.strictEqual(numeric("49.943", { dotThousands: true }), 49943);
  assert.strictEqual(numeric("622.624", { dotThousands: true }), 622624);
  assert.strictEqual(numeric("-3.658", { dotThousands: true }), -3658);
});

t("opting in does not touch anything that is not a bare 1-3 / 3 group", () => {
  assert.strictEqual(numeric("1.449,37", { dotThousands: true }), 1449.37, "European decimal comma");
  assert.strictEqual(numeric("0.241879", { dotThousands: true }), 0.241879, "six-place decimal");
  assert.strictEqual(numeric("1449.37", { dotThousands: true }), 1449.37, "two-place decimal");
  assert.strictEqual(numeric("2.555.002.379", { dotThousands: true }), 2555002379);
});

/* The whole point of the document-level test: it must NOT fire on an ordinary
   English statement that happens to print a three-place decimal. */
const dotDoc = (text) => /\d{1,3}(?:\.\d{3}){2,}/.test(String(text || ""));
t("the document test needs two or more groups before it fires", () => {
  assert.strictEqual(dotDoc("928.368.104 49.943 622.624"), true);
  assert.strictEqual(dotDoc("Rate 1.234 and 5.678"), false);
  assert.strictEqual(dotDoc(""), false);
});

/* Both trees: the grid reader is where the Chilean boxed form is booked, and
   the shipped bundle ignored the flag entirely until this was mirrored. */
(async () => {
  const D = require("./fixtures/harness.cjs");
  await D.boot();
  const M = D.M;
  t("dist: the flag reaches numericCell", () => {
    assert.strictEqual(M.Oa("622.624"), 622.624, "off by default");
    assert.strictEqual(M.Oa("622.624", { dotThousands: true }), 622624);
  });
  t("dist: a dot-grouped grid books whole pesos, an ordinary one does not", () => {
    const chile = M.Jv([["Ingresos del giro percibidos", "928.368.104"],
                        ["Otros ingresos percibidos o devengados", "49.943"],
                        ["Otros gastos deducibles de los ingresos", "622.624"]]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(chile)).map((r) => r.values),
      [[928368104], [49943], [622624]]);
    const plain = M.Jv([["Sales", "1.234"], ["Other", "5.678"]]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(plain)).map((r) => r.values),
      [[1.234], [5.678]]);
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

