/* Writes cell values into an existing .xlsx while leaving every other byte of
   the template untouched. The workbook is never re-serialised: only the
   targeted <c> elements inside sheetN.xml are rewritten, so styles, merges,
   hidden sheets, data validation and every existing formula survive. */

declare const JSZip: any;

const XML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => XML_ESC[c]);

function colToNum(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
  return n;
}

function splitRef(ref: string) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error("Bad cell reference: " + ref);
  return { col: m[1], colNum: colToNum(m[1]), row: parseInt(m[2], 10) };
}

export type CellValue = string | number | boolean | null | undefined;

function buildCell(ref: string, value: CellValue, styleAttr: string | null): string {
  const s = styleAttr ? ` s="${styleAttr}"` : "";
  if (value === null || value === undefined || value === "") return `<c r="${ref}"${s}/>`;
  if (typeof value === "number" && isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = String(value);
  if (text.charAt(0) === "=") return `<c r="${ref}"${s}><f>${esc(text.slice(1))}</f></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

export function setCell(xml: string, ref: string, value: CellValue): string {
  const { colNum, row } = splitRef(ref);

  // 1. Cell already present — swap it, keeping its style index.
  const cellRe = new RegExp(`<c r="${ref}"(?![0-9])([^>]*?)(/>|>[\\s\\S]*?</c>)`);
  const hit = cellRe.exec(xml);
  if (hit) {
    const styleMatch = /\bs="(\d+)"/.exec(hit[1]);
    return xml.replace(cellRe, buildCell(ref, value, styleMatch ? styleMatch[1] : null));
  }

  // 2. Row present — insert the cell in column order.
  const rowRe = new RegExp(`<row r="${row}"(?![0-9])([^>]*?)(/>|>([\\s\\S]*?)</row>)`);
  const rowHit = rowRe.exec(xml);
  if (rowHit) {
    const newCell = buildCell(ref, value, null);
    if (rowHit[2] === "/>") return xml.replace(rowRe, `<row r="${row}"${rowHit[1]}>${newCell}</row>`);
    const inner = rowHit[3];
    let insertAt = inner.length;
    for (const m of inner.matchAll(/<c r="([A-Z]+)(\d+)"/g)) {
      if (colToNum(m[1]) > colNum) { insertAt = m.index!; break; }
    }
    const merged = inner.slice(0, insertAt) + newCell + inner.slice(insertAt);
    return xml.replace(rowRe, `<row r="${row}"${rowHit[1]}>${merged}</row>`);
  }

  // 3. Row absent — insert a new row in row order.
  const newRow = `<row r="${row}">${buildCell(ref, value, null)}</row>`;
  for (const m of xml.matchAll(/<row r="(\d+)"/g)) {
    if (parseInt(m[1], 10) > row) return xml.slice(0, m.index!) + newRow + xml.slice(m.index!);
  }
  if (/<sheetData\s*\/>/.test(xml)) return xml.replace(/<sheetData\s*\/>/, `<sheetData>${newRow}</sheetData>`);
  return xml.replace("</sheetData>", newRow + "</sheetData>");
}

async function sheetIndex(zip: any): Promise<Record<string, string>> {
  const wbXml: string = await zip.file("xl/workbook.xml").async("string");
  const relsXml: string = await zip.file("xl/_rels/workbook.xml.rels").async("string");

  const rels: Record<string, string> = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0]);
    const target = /Target="([^"]+)"/.exec(m[0]);
    if (id && target) rels[id[1]] = "xl/" + target[1].replace(/^\/?xl\//, "").replace(/^\.\//, "");
  }

  const map: Record<string, string> = {};
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = /name="([^"]*)"/.exec(m[0]);
    const rid = /r:id="([^"]+)"/.exec(m[0]);
    if (name && rid && rels[rid[1]]) {
      const clean = name[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      map[clean] = rels[rid[1]];
    }
  }
  return map;
}

/* Untouched formulas now hold stale cached results, so ask the spreadsheet
   application to recalculate everything the moment the file opens. */
function forceRecalc(wbXml: string): string {
  if (/<calcPr\b[^>]*\/>/.test(wbXml)) {
    return wbXml.replace(/<calcPr\b([^>]*)\/>/, (_all, attrs: string) => {
      const cleaned = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
      return `<calcPr${cleaned} fullCalcOnLoad="1"/>`;
    });
  }
  return wbXml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
}

export type PatchReport = { written: number; skippedSheets: string[] };
export type Writes = Record<string, Record<string, CellValue>>;

export async function applyWrites(zip: any, writes: Writes): Promise<PatchReport> {
  const sheets = await sheetIndex(zip);
  const report: PatchReport = { written: 0, skippedSheets: [] };

  for (const [sheetName, cells] of Object.entries(writes)) {
    const path = sheets[sheetName];
    if (!path || !zip.file(path)) { report.skippedSheets.push(sheetName); continue; }
    let xml: string = await zip.file(path).async("string");
    for (const [ref, value] of Object.entries(cells)) {
      xml = setCell(xml, ref, value);
      report.written++;
    }
    zip.file(path, xml);
  }

  zip.remove("xl/calcChain.xml");
  const wbXml: string = await zip.file("xl/workbook.xml").async("string");
  zip.file("xl/workbook.xml", forceRecalc(wbXml));
  return report;
}

/** Decode the master template embedded in the page. */
export function templateBytes(): Uint8Array {
  const node = document.getElementById("wp-template");
  if (!node) throw new Error("Master template is not embedded in this build");
  const bin = atob((node.textContent || "").trim());
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
