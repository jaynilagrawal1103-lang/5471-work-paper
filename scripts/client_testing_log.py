#!/usr/bin/env python3
"""Builds docs/Client_Testing_Log.xlsx — the running record of every client the
tool has been tested against.

Add a client by appending to CLIENTS, DOCUMENTS, DEFECTS and (where a manually
prepared work paper exists) GOLD, then re-run:

    python3 scripts/client_testing_log.py

Every figure here was measured by running the shipped dist/index.html in a real
browser against the client's own files, or read off the client's own documents.
Nothing is estimated.
"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# ---------------------------------------------------------------- data ------

CLIENTS = [
    dict(id="C-01", name="Cuadras, Romy", entity="ATHLETIC PRIME SARL",
         country="Switzerland", ccy="CHF", year="2024", tested="2026-09-07",
         gold="No — none supplied", before=0, after=22,
         status="Working — 22 lines, all tie to the signed original"),
    dict(id="C-02", name="Santmyer, Jaimie & Gonzalez, Ricardo",
         entity="CECILIA GONZALEZ ACUNA SPA", country="Chile", ccy="CLP",
         year="2024", tested="2026-09-04", gold="Yes — 2024 work paper supplied",
         before=0, after=8,
         status="Partly working — income statement only; needs the document type set by hand"),
    dict(id="C-03", name="Santmyer, Jaimie & Gonzalez, Ricardo",
         entity="CORPORACION EDUCACIONAL CHARLIE BRAWN LTDA", country="Chile",
         ccy="CLP", year="2024", tested="2026-09-04",
         gold="Yes — 2024 work paper supplied", before=0, after=7,
         status="Partly working — income statement only; needs the document type set by hand"),
]

DOCUMENTS = [
    # client, document, what it is, readable?, what the tool got from it, verdict
    ("C-01", "Romy_Cuadras-AP_Balance_Sheet___Income_statement_2024 (original)",
     "Signed French accounts, 2 pages", "No — scan, no text layer",
     "Nothing until OCR runs", "Now OCR'd automatically; this is the ONLY sound source of the figures"),
    ("C-01", "Romy_Cuadras-AP_Balance_Sheet___Income_statement_2024_English",
     "Chatbot translation of the above, 3 pages", "Yes",
     "22 schedule lines", "USABLE BUT UNSAFE — see defect D-19, it dropped every minus sign"),
    ("C-01", "Cuadras_Romy__2023US_I25511_Clnt_V1",
     "2023 US individual return incl. full Form 5471, 92 pages", "Yes",
     "Full entity profile, filer categories, shareholder, opening balances, opening E&P",
     "Excellent — every opening balance ties to the filed return"),
    ("C-02", "Cecilia_Gonzalez_Acuna_Spa_Financials",
     "Chilean SII Form 22 tax return, 2 pages", "Yes",
     "8 income-statement lines", "Income statement only — the form has no balance sheet"),
    ("C-02", "Santmyer_Jaimie_2023US_I1604_Clnt_V1_1",
     "2023 US return incl. Form 5471", "Yes", "Profile + opening balances",
     "Opening balances tie to the manually prepared work paper exactly"),
    ("C-02", "2024_5471_Workpaper__CECILIA_GONZALEZ_ACUNA_SPA.XLSX",
     "Manually prepared work paper (the benchmark)", "Yes", "Used for comparison only",
     "Benchmark — see the 'Gold comparison' sheet"),
    ("C-03", "Corporacion_Educacional_Charlie_Brawn_Limitada__Financials",
     "Chilean SII Form 22 tax return, 2 pages", "Yes",
     "7 income-statement lines", "Income statement only — the form has no balance sheet"),
    ("C-03", "2024_5471_Workpaper__CORPORACION_EDUCACIONAL_CHARLIE_BRAWN_LIMITADA.XLSX",
     "Manually prepared work paper (the benchmark)", "Yes", "Used for comparison only",
     "Benchmark — the tool's bottom line matches it to the peso"),
]

MISSING = [
    # client, what is missing, why it matters, what cannot be produced without it, who can supply it
    ("C-01", "The tax computation behind the CHF 84.80 charge",
     "The tool cannot tell whether that 84.80 is income tax or another tax",
     "Schedule E (foreign tax credit) — currently a labelled zero placeholder", "The Swiss accountant"),
    ("C-01", "A related-party ledger for the partner current account (C/C Associé CHF 26,027.29)",
     "Money owed by the partner is a related-party transaction",
     "Schedule M", "The client"),
    ("C-01", "A prepared work paper for 2024 to check against",
     "Nothing independent to compare the tool's output with",
     "No accuracy benchmark for this client", "Your team"),
    ("C-02", "Financial statements (balance sheet and profit & loss)",
     "The Form 22 is a TAX RETURN. It carries only 5 aggregate balance-sheet boxes — no cash, receivables, payables or inventory detail",
     "Schedule F (balance sheet) — 8 of its 11 lines do not exist on the Form 22", "The Chilean accountant"),
    ("C-02", "The corporate tax return detail behind CLP 95,791,979 of tax",
     "The prepared work paper notes this is Impto Primera Categoria + Reajustes + tax return balance — a figure assembled by hand",
     "Schedule E", "The Chilean accountant"),
    ("C-02", "A related-party ledger",
     "The prepared work paper shows USD 130,694.55 of compensation paid to a related party",
     "Schedule M", "The client"),
    ("C-03", "Financial statements (balance sheet and profit & loss)",
     "Same as C-02 — the Form 22 has no balance sheet",
     "Schedule F", "The Chilean accountant"),
]

# id, date, client(s), stage it broke at, what you saw, why (plain language), the fix,
# status, risk to other clients, how it was proved
DEFECTS = [
    ("D-01", "2026-09-04", "C-02, C-03", "3. Reading the numbers",
     "Every figure a billion times too small",
     "Chile writes two and a half billion as 2.555.002.379. The tool read the first dot as a decimal point and stopped, so it saw 2.555.",
     "Read dots as thousands separators when there is more than one and no comma.",
     "Fixed", "All clients — improves every dot-grouped language (Chile, Spain, Germany, Brazil)",
     "16 unit tests across 8 number formats"),
    ("D-02", "2026-09-04", "C-02, C-03", "5. Converting to US dollars",
     "No exchange rate for Chile at all",
     "All three rate tables called the Chilean peso CLF. CLF is a different Chilean unit (the Unidad de Fomento), not the peso.",
     "Renamed to CLP.", "Chile only", "Rates now resolve; totals tie to the prepared work paper"),
    ("D-03", "2026-09-04", "C-02, C-03", "2. Pairing labels with numbers",
     "0 lines — nothing read from the filing at all",
     "The Chilean form prints the box NUMBER at the far left, the CAPTION on the line above and the AMOUNT inside the box. The tool needed a label and a number on the SAME line, so it saw nothing.",
     "New reader that rebuilds the pairs from the page layout.",
     "Fixed", "None — only fires on forms laid out this way",
     "17 unit tests; verified on both Chilean filings"),
    ("D-04", "2026-09-04", "C-02, C-03", "4. Choosing the right line",
     "An expense booked as REVENUE",
     "The box is called 'Otros gastos deducibles de los ingresos' — other expenses deducted FROM INCOME. The only word the tool recognised was 'income'.",
     "Added Spanish expense keywords that outrank the word 'income'.",
     "Fixed", "Spanish-language clients", "Both wordings tested"),
    ("D-05", "2026-09-04", "C-02", "4. Choosing the right line",
     "Depreciation counted twice",
     "The Chilean return states depreciation twice — book and tax. Both matched the depreciation rule.",
     "The tax version is now skipped.", "Fixed", "Chile only", "Unit test"),
    ("D-06", "2026-09-04", "C-02, C-03", "3. Reading the numbers",
     "A sentence booked as a telephone expense",
     "A sentence wrapped across two lines; its tail '...deberá declarar por Internet)' looked like a caption and matched the word 'Internet'.",
     "A caption with unmatched brackets is a wrapped sentence, not a line.",
     "Fixed", "All clients — low risk, guards a real error", "Unit test incl. the 'a) Cash' case"),
    ("D-07", "2026-09-04", "C-02", "1. Working out what the document is",
     "The tool thought a Chilean company reported in INDIAN RUPEES",
     "It counted every three-letter code it saw. 'REX/INR/ Remanente' appears twice; the cell that just says CLP appears once. INR won on a count of 2 to 1.",
     "A code standing alone in a cell now beats the same letters buried in a sentence.",
     "Fixed", "All clients — this decides which exchange rate is used, so it affects every converted figure",
     "Unit tests; shipped code run against the real filing"),
    ("D-08", "2026-09-04", "C-02, C-03", "1. Working out what the document is",
     "Company name read as '02 Apellido Materno'",
     "On a boxed form the cell to the RIGHT of a caption is the next box's caption, not this box's value. The value is on the line below.",
     "On a boxed form, read the value from the line below.",
     "Fixed", "None — an ordinary questionnaire cannot trigger it",
     "Both filings now read the right name and activity"),
    ("D-09", "2026-09-04", "C-02, C-03", "1. Working out what the document is",
     "Country left blank on a form headed REPUBLICA DE CHILE",
     "The form has no 'country of incorporation' caption, and the tool only ever read that caption.",
     "The country is taken from the currency (the rate tables already know CLP is Chile).",
     "Fixed", "All clients — proposal only, always editable", "Unit test"),
    ("D-10", "2026-09-04", "C-02", "6. Filling the schedules",
     "Schedule E said the company paid no tax — it had paid CLP 95,791,979",
     "'We found no tax figure' and 'the accounts show zero tax' were treated as the same thing.",
     "They are now separate. A missing figure gives a labelled placeholder and a warning, not a statement of fact.",
     "Fixed", "All clients", "Unit test; 2Hats (which genuinely books zero) unaffected"),
    ("D-11", "2026-09-04", "C-02, C-03", "1. Working out what the document is",
     "0 lines unless you set the document type by hand",
     "The tool identifies documents by headings like 'Balance Sheet'. The Chilean Form 22 says 'IMPUESTOS ANUALES A LA RENTA' — it is a tax return, not a set of accounts, so nothing matched.",
     "PROPOSED: teach it the Chilean form's own headings. Not yet implemented — you chose to defer it.",
     "Open", "Would be additive only — no effect on other clients",
     "Root cause confirmed; the manual override is proven to unlock 7-8 lines"),
    ("D-12", "2026-09-04", "C-02, C-03", "Source document",
     "Balance sheet stays empty",
     "The Form 22 simply does not contain a balance sheet. It has 5 aggregate boxes; a Schedule F needs 11 lines. Your own prepared work paper took the rest from financial statements.",
     "Cannot be fixed in software. Ask the client for financial statements.",
     "Cannot fix", "n/a", "Compared against the prepared work paper line by line"),
    ("D-13", "2026-09-07", "C-01", "1. Working out what the document is",
     "0 lines from a perfectly ordinary set of accounts",
     "The tool would only look at a page's TITLE if the page also carried a company registration number or a 'Page 1 of 3' footer. This Swiss accountant prints neither — just the company name, address and 'BILAN AU 31 DECEMBRE 2024'.",
     "A title starting a line of its own, over at least five label-and-amount rows, is now enough.",
     "Fixed", "All clients — helps any small-practice accounts; prose ABOUT a balance sheet still does not qualify",
     "11 unit tests; live browser run on the client's file"),
    ("D-14", "2026-09-07", "C-01", "3. Reading the numbers",
     "Every row thrown away as 'which year is this?'",
     "The columns are headed '2024 CHF' and '2023 CHF'. The tool stripped currency codes from headings using a hard-coded list of TEN. CHF was not on it — nor SEK, CLP, THB, ZAR or about 140 others.",
     "Any code in the tool's own currency list is now stripped.",
     "Fixed", "All clients — unlocks roughly 140 currencies. Only changes behaviour where the leftover is exactly a currency code",
     "Shipped parser run on 6 currencies; 'Total 2024' still correctly refused"),
    ("D-15", "2026-09-07", "C-01", "5. Converting to US dollars",
     "No exchange rate for Switzerland",
     "All three rate tables called the Swiss franc CHE. CHE is the WIR Euro, a private Swiss currency used by a business barter network — not the franc. Same mistake as D-02.",
     "Renamed to CHF.", "Fixed", "Switzerland only",
     "CHF 35,378.04 at the stored 2023 rate = USD 42,217, the prior return's filed total assets to the dollar"),
    ("D-16", "2026-09-07", "C-01", "4. Choosing the right line",
     "Revenue exactly DOUBLE, and three subtotals booked as expenses",
     "'Total revenue' was added on top of the revenue line it totals ('total revenues' was on the skip list, 'total revenue' was not). 'Operating profit', 'Net financial income' and 'Profit before tax' were booked as three separate deductions.",
     "Added those subtotals, plus their French names, to the skip list.",
     "Fixed", "All clients — prevents double counting anywhere",
     "Expenses now total 11,211.70, exactly 'Total des charges' on the original"),
    ("D-17", "2026-09-07", "C-01", "4. Choosing the right line",
     "Share capital and retained earnings rejected",
     "The heading 'EQUITY CAPITAL' was not in the list of section headings, so those rows stayed under the page's stale 'ASSETS' header and were refused as balance-sheet items.",
     "Added equity, foreign capital, actif, passif and capitaux headings.",
     "Fixed", "All clients — additive", "Both now map; live browser run"),
    ("D-18", "2026-09-07", "C-01", "0. Reading the file at all",
     "A scanned document was reported unreadable and left there",
     "The OCR engine was already built into the tool, but starting it was a manual step: you had to know the OCR card existed, find it, pick the file again and choose a language.",
     "The tool now starts OCR by itself when a PDF opens with no text, choosing the language from the country the other documents established.",
     "Fixed", "All clients with scans. Runs once per file, only when idle, never on its own output",
     "8 wiring tests; full chain driven in a real browser; the same engine read this client's scan at 88% confidence"),
    ("D-19", "2026-09-07", "C-01", "Source document",
     "THE ENGLISH TRANSLATION REVERSES THE RESULT",
     "The client supplied a chatbot translation of the accounts. It dropped every minus sign. The company made a LOSS of CHF 9,303.78; the translation states a PROFIT of the same amount.",
     "Cannot be fixed in software. Do not use chatbot translations of financial statements. The tool survives this only because it now adds up the components itself instead of trusting the stated total (see D-16).",
     "Cannot fix", "n/a — this is a data quality issue",
     "Read the signed French original as an image and checked it: 1,540.00 income less 11,211.70 costs = -9,671.70"),
    ("D-20", "2026-09-07", "C-01", "6. Filling the schedules",
     "Opening retained earnings do not tie to the prior return",
     "The 2023 US return's retained earnings INCLUDE that year's profit; the Swiss statement's 'report à nouveau' EXCLUDES it. The gap is exactly the 2023 result, CHF 2,899.24.",
     "The tool reports the mismatch and names both figures. A person has to decide which basis to use.",
     "Flagged for the preparer", "n/a", "Live browser run raised it automatically"),
    ("D-21", "2026-09-07", "C-01", "4. Choosing the right line",
     "'Taxes 84.80' went to Other deductions, not income tax",
     "The line is just called 'Taxes'. That could be income tax or a business rate; the tool will not guess.",
     "Open. Adding the French 'Impôts' would fix it for the original document once OCR'd.",
     "Open", "Small — about USD 75 here, but it decides whether Schedule E is filled",
     "Live browser run"),
    ("D-22", "2026-09-04", "C-02, C-03", "5. Converting to US dollars",
     "Year-end rates differ from your prepared work paper by 0.4%",
     "Your preparer used OFX rates for all three. The tool takes the year-end rate from the US Treasury (992.6 / 880.0 vs 993.209169 / 876.363062).",
     "DELIBERATELY NOT CHANGED. Switching the default would move the US dollar balance sheet of every existing client. Left as a preparer override.",
     "Deferred by decision", "Would be very high if changed", "Both sources compared"),
    ("D-23", "2026-09-04", "C-02", "Source document",
     "Cost of sales and other deductions split differently from your work paper",
     "Your preparer moved amounts between cost of sales, taxes and other deductions using the financial statements. The Form 22 does not show that split.",
     "Cannot be fixed without the financial statements. Note: for Charlie Brawn the tool's BOTTOM LINE matches your work paper to the peso — only the classification differs.",
     "Cannot fix", "n/a", "Traced every peso of the difference"),
]

# Chile — the tool against the manually prepared work paper, local currency
GOLD = [
    # entity, line, prepared work paper, tool, tie?, note
    ("CHARLIE BRAWN", "Gross receipts", 928368104, 928368104, "Yes", ""),
    ("CHARLIE BRAWN", "Cost of goods sold", 271608960, 287881281, "No",
     "Preparer moved 16,272,321 into other deductions"),
    ("CHARLIE BRAWN", "Other income", 0, 49943, "No", "Preparer treated it as a tax credit"),
    ("CHARLIE BRAWN", "Compensation", 420161804, 420161804, "Yes", ""),
    ("CHARLIE BRAWN", "Interest", 4605602, 4605602, "Yes", ""),
    ("CHARLIE BRAWN", "Taxes (not income tax)", 534626, 0, "No", "Not separable on the Form 22"),
    ("CHARLIE BRAWN", "Other deductions", 27545029, 11807334, "No", "Same reclassification as above"),
    ("CHARLIE BRAWN", "Income tax", -49943, 0, "No", "Not on the Form 22"),
    ("CHARLIE BRAWN", "NET RESULT FOR THE YEAR", 203962026, 203962026, "Yes",
     "MATCHES TO THE PESO — only the classification differs"),
    ("CECILIA", "Gross receipts", 1973582648, 1973582648, "Yes", ""),
    ("CECILIA", "Cost of goods sold", 664631774, 703095833, "No", "Preparer used the financial statements"),
    ("CECILIA", "Other income", 97509381, 97509381, "Yes", ""),
    ("CECILIA", "Compensation", 779000384, 779000384, "Yes", ""),
    ("CECILIA", "Rents", 31464925, 31464925, "Yes", ""),
    ("CECILIA", "Interest", 59235438, 59235438, "Yes", ""),
    ("CECILIA", "Depreciation", 115585728, 115585728, "Yes", ""),
    ("CECILIA", "Taxes (not income tax)", 6186356, 0, "No", "Not separable on the Form 22"),
    ("CECILIA", "Other deductions", 165961197, 184913638, "No", "Preparer used the financial statements"),
    ("CECILIA", "Income tax", 95791979, 0, "No", "Assembled by hand from the corporate tax return"),
    ("CECILIA", "NET RESULT FOR THE YEAR", 153234248, 197796083, "No",
     "Differs because the preparer used the financial statements, which the Form 22 does not contain"),
]

# Switzerland — the tool against the signed French original (no prepared work paper exists)
SWISS = [
    ("Income", 1540.00, 1540.00, "Yes", "Prestations de services"),
    ("Total costs", 11211.70, 11211.70, "Yes", "Sum of 9 expense lines = 'Total des charges'"),
    ("Interest income", 505.42, 505.42, "Yes", "Intérêts créditeurs"),
    ("Bank charges", 52.70, 52.70, "Yes", "Frais bancaires"),
    ("Tax", 84.80, 84.80, "Yes", "Impôts — but posted to Other deductions, see D-21"),
    ("RESULT FOR THE YEAR", -9303.78, -9303.78, "Yes",
     "The tool computes the LOSS correctly even though the English file it read says PROFIT"),
    ("Total assets", 26027.29, 26027.29, "Yes", "Total de l'actif"),
    ("Total liabilities", 1403.03, 1403.03, "Yes", "Total des capitaux étrangers"),
    ("Share capital", 20000.00, 20000.00, "Yes", "Capital-actions"),
    ("Opening cash (USD, from the 2023 return)", 86, 86, "Yes", "Ties to the filed return"),
    ("Opening receivables (USD)", 42131, 42131, "Yes", "Ties to the filed return"),
    ("Opening payables (USD)", 1551, 1551, "Yes", "Ties to the filed return"),
    ("Opening retained earnings (USD)", 16621, 13161, "No",
     "Flagged by the tool — see D-20, the two sources use different bases"),
]

# ------------------------------------------------------------- styling ------

FONT = "Arial"
H1 = Font(name=FONT, size=14, bold=True, color="1F3864")
H2 = Font(name=FONT, size=11, bold=True, color="FFFFFF")
BODY = Font(name=FONT, size=10)
BOLD = Font(name=FONT, size=10, bold=True)
NOTE = Font(name=FONT, size=9, italic=True, color="595959")
HFILL = PatternFill("solid", fgColor="1F3864")
BANDS = PatternFill("solid", fgColor="F2F5FA")
OKF = PatternFill("solid", fgColor="E2EFDA")
BADF = PatternFill("solid", fgColor="FCE4E4")
WARNF = PatternFill("solid", fgColor="FFF2CC")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")
TOP = Alignment(vertical="top")


def header(ws, row, cols, widths):
    for i, (c, w) in enumerate(zip(cols, widths), start=1):
        cell = ws.cell(row=row, column=i, value=c)
        cell.font, cell.fill, cell.border = H2, HFILL, BOX
        cell.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = ws.cell(row=row + 1, column=1)


def put(ws, row, values, fills=None, bold_cols=()):
    for i, v in enumerate(values, start=1):
        cell = ws.cell(row=row, column=i, value=v)
        cell.font = BOLD if i in bold_cols else BODY
        cell.alignment = WRAP
        cell.border = BOX
        if fills and i in fills:
            cell.fill = fills[i]
        elif row % 2 == 0:
            cell.fill = BANDS


def title(ws, text, sub=None):
    ws["A1"] = text
    ws["A1"].font = H1
    ws.row_dimensions[1].height = 22
    if sub:
        ws["A2"] = sub
        ws["A2"].font = NOTE


wb = Workbook()

# ---------------------------------------------------------------- Read me ---
ws = wb.active
ws.title = "Read me"
title(ws, "Form 5471 work paper tool — client testing log")
ws["A3"] = "What this workbook is"
ws["A3"].font = BOLD
rows = [
    ("", ""),
    ("Purpose", "A running record of every client the tool has been tested against: what went wrong, why, what was fixed, and what is still missing. Add a client each time one is tested."),
    ("How the figures were obtained", "Each client's real files were uploaded to the actual tool running in a web browser, and the results read back out of it. Nothing here is estimated or assumed."),
    ("How to add a client", "Edit scripts/client_testing_log.py — add to CLIENTS, DOCUMENTS, MISSING, DEFECTS and (if a manually prepared work paper exists) GOLD — then run:  python3 scripts/client_testing_log.py"),
    ("", ""),
    ("The five steps a document goes through", "Every 'why did it read 0 lines' answer is one of these five steps failing. Each sheet says which step broke."),
    ("  0. Reading the file at all", "Can the PDF be opened and does it contain text? A scan contains only a picture, so it needs OCR first."),
    ("  1. Working out what the document is", "Is this a balance sheet? a profit & loss? a tax return? If the tool cannot tell, it deliberately throws the numbers away rather than guess."),
    ("  2. Pairing labels with numbers", "Matching each caption to the amount that belongs to it."),
    ("  3. Reading the numbers", "Getting the value right — decimal points, thousands separators, which year each column is."),
    ("  4. Choosing the right line", "Deciding that 'Remuneraciones' belongs on the Compensation line."),
    ("  5. Converting to US dollars", "Finding the right exchange rate for the currency."),
    ("  6. Filling the schedules", "Writing everything onto the Form 5471 schedules."),
    ("", ""),
    ("Colour key", "Green = matches / working.   Red = wrong or missing.   Yellow = needs a person to decide."),
]
r = 4
for a, b in rows:
    ws.cell(row=r, column=1, value=a).font = BOLD if a and not a.startswith(" ") else BODY
    c = ws.cell(row=r, column=2, value=b)
    c.font, c.alignment = BODY, WRAP
    r += 1
ws.column_dimensions["A"].width = 34
ws.column_dimensions["B"].width = 108
for rr in range(4, r):
    ws.row_dimensions[rr].height = 30

# -------------------------------------------------------- Client register ---
ws = wb.create_sheet("Client register")
title(ws, "Clients tested", "One row per foreign company. 'Lines' means schedule lines the tool filled in by itself.")
header(ws, 4,
       ["ID", "Client", "Foreign company", "Country", "Currency", "Year",
        "Date tested", "Prepared work paper to compare?", "Lines BEFORE", "Lines AFTER", "Where it stands"],
       [7, 30, 38, 13, 9, 7, 12, 26, 12, 12, 46])
r = 5
for c in CLIENTS:
    fills = {9: BADF, 10: OKF if c["after"] else BADF}
    put(ws, r, [c["id"], c["name"], c["entity"], c["country"], c["ccy"], c["year"],
                c["tested"], c["gold"], c["before"], c["after"], c["status"]], fills)
    r += 1
tot = r
ws.cell(row=tot, column=2, value="TOTAL").font = BOLD
for col, letter in ((9, "I"), (10, "J")):
    cell = ws.cell(row=tot, column=col, value=f"=SUM({letter}5:{letter}{r-1})")
    cell.font = BOLD
    cell.fill = OKF if col == 10 else BADF
ws.cell(row=tot + 2, column=2,
        value="'Lines BEFORE' is what the tool produced before this engagement's fixes. 'AFTER' is what it produces now, measured in the browser.").font = NOTE
ws.cell(row=tot + 3, column=2,
        value="C-02 and C-03 still need the document type set by hand on the Documents tab — see defect D-11.").font = NOTE

# ------------------------------------------------------------ Defect log ----
ws = wb.create_sheet("Defect log")
title(ws, "Everything found, and what was done about it",
      "One row per defect. 'Step' points at the five-step list on the Read me sheet.")
header(ws, 4,
       ["ID", "Found", "Client(s)", "Step that broke", "What you saw",
        "Why it happened (plain language)", "What was done", "Status",
        "Effect on other clients", "How it was proved"],
       [7, 12, 14, 26, 34, 60, 52, 20, 40, 40])
r = 5
counts = {}
for d in DEFECTS:
    st = d[7]
    counts[st] = counts.get(st, 0) + 1
    fill = {"Fixed": OKF, "Open": WARNF, "Cannot fix": BADF,
            "Deferred by decision": WARNF, "Flagged for the preparer": WARNF}.get(st, BANDS)
    put(ws, r, list(d), fills={8: fill}, bold_cols=(1,))
    ws.row_dimensions[r].height = 74
    r += 1
last = r - 1
r += 1
ws.cell(row=r, column=4, value="Summary").font = BOLD
for i, st in enumerate(["Fixed", "Open", "Deferred by decision", "Flagged for the preparer", "Cannot fix"]):
    ws.cell(row=r + 1 + i, column=4, value=st).font = BODY
    c = ws.cell(row=r + 1 + i, column=5, value=f'=COUNTIF(H5:H{last},"{st}")')
    c.font = BOLD
    c.fill = OKF if st == "Fixed" else (BADF if st == "Cannot fix" else WARNF)
ws.cell(row=r + 7, column=4, value="Total defects logged").font = BOLD
ws.cell(row=r + 7, column=5, value=f"=COUNTA(A5:A{last})").font = BOLD
ws.cell(row=r + 9, column=4,
        value='"Cannot fix" means the information is not in the documents supplied, or the document itself is wrong. No amount of software work changes those — they need a document from the client.').font = NOTE

# -------------------------------------------------------------- Documents ---
ws = wb.create_sheet("Documents supplied")
title(ws, "What each client gave us, and what the tool got out of it")
header(ws, 4,
       ["Client", "Document", "What it is", "Could the tool read it?",
        "What the tool got from it", "Verdict"],
       [9, 46, 40, 26, 40, 56])
r = 5
for d in DOCUMENTS:
    fill = BADF if d[3].startswith("No") else OKF
    vf = BADF if "UNSAFE" in d[5] else None
    fills = {4: fill}
    if vf:
        fills[6] = vf
    put(ws, r, list(d), fills)
    ws.row_dimensions[r].height = 44
    r += 1

# --------------------------------------------------------------- Missing ----
ws = wb.create_sheet("Documents missing")
title(ws, "What we still need, and what cannot be produced without it",
      "These are the gaps no software change can close.")
header(ws, 4,
       ["Client", "What is missing", "Why it matters",
        "What cannot be produced without it", "Who can supply it"],
       [9, 52, 60, 52, 26])
r = 5
for m in MISSING:
    put(ws, r, list(m), fills={4: BADF})
    ws.row_dimensions[r].height = 46
    r += 1

# ------------------------------------------------- Gold comparison (Chile) --
ws = wb.create_sheet("Gold comparison")
title(ws, "Tool vs your manually prepared work paper — Chile (local currency, CLP)",
      "The only clients for which a prepared work paper was supplied.")
header(ws, 4,
       ["Company", "Line", "Your work paper", "The tool", "Difference", "Match?", "Note"],
       [26, 32, 18, 18, 16, 10, 58])
r = 5
first = r
for g in GOLD:
    ent, line, gold, tool, tie, note = g
    put(ws, r, [ent, line, gold, tool, None, tie, note],
        fills={6: OKF if tie == "Yes" else BADF},
        bold_cols=(2,) if line.startswith("NET") else ())
    ws.cell(row=r, column=5, value=f"=D{r}-C{r}").font = BODY
    for col in (3, 4, 5):
        ws.cell(row=r, column=col).number_format = "#,##0;(#,##0);-"
    if line.startswith("NET"):
        for col in range(1, 8):
            ws.cell(row=r, column=col).font = BOLD
    r += 1
last = r - 1
r += 1
ws.cell(row=r, column=2, value="Lines that match exactly").font = BOLD
ws.cell(row=r, column=3, value=f'=COUNTIF(F{first}:F{last},"Yes")').font = BOLD
ws.cell(row=r, column=3).fill = OKF
ws.cell(row=r + 1, column=2, value="Lines compared").font = BOLD
ws.cell(row=r + 1, column=3, value=f"=COUNTA(F{first}:F{last})").font = BOLD
ws.cell(row=r + 2, column=2, value="Match rate").font = BOLD
ws.cell(row=r + 2, column=3, value=f"=IF(C{r+1}=0,0,C{r}/C{r+1})").font = BOLD
ws.cell(row=r + 2, column=3).number_format = "0.0%"
ws.cell(row=r + 4, column=2,
        value="Read the CHARLIE BRAWN net result carefully: it matches your work paper TO THE PESO. Every difference above it is the preparer moving amounts between lines using the financial statements — which the Chilean tax form does not contain.").font = NOTE
ws.cell(row=r + 5, column=2,
        value="CECILIA differs at the bottom because the preparer used the financial statements throughout, and their own note says the result 'won't match with the Financials'.").font = NOTE

# ------------------------------------------------ Switzerland verification --
ws = wb.create_sheet("Switzerland check")
title(ws, "Tool vs the signed French original — Athletic Prime Sàrl (CHF)",
      "No prepared work paper exists for this client, so the tool was checked against the signed accounts themselves.")
header(ws, 4,
       ["Line", "Signed original", "The tool", "Difference", "Match?", "Note"],
       [40, 20, 20, 16, 10, 66])
r = 5
first = r
for s in SWISS:
    line, orig, tool, tie, note = s
    put(ws, r, [line, orig, tool, None, tie, note],
        fills={5: OKF if tie == "Yes" else BADF},
        bold_cols=(1,) if line.startswith("RESULT") else ())
    ws.cell(row=r, column=4, value=f"=C{r}-B{r}").font = BODY
    for col in (2, 3, 4):
        ws.cell(row=r, column=col).number_format = "#,##0.00;(#,##0.00);-"
    if line.startswith("RESULT"):
        for col in range(1, 7):
            ws.cell(row=r, column=col).font = BOLD
    r += 1
last = r - 1
r += 1
ws.cell(row=r, column=1, value="Lines that match exactly").font = BOLD
ws.cell(row=r, column=2, value=f'=COUNTIF(E{first}:E{last},"Yes")').font = BOLD
ws.cell(row=r, column=2).fill = OKF
ws.cell(row=r + 1, column=1, value="Lines checked").font = BOLD
ws.cell(row=r + 1, column=2, value=f"=COUNTA(E{first}:E{last})").font = BOLD
ws.cell(row=r + 2, column=1, value="Match rate").font = BOLD
ws.cell(row=r + 2, column=2, value=f"=IF(B{r+1}=0,0,B{r}/B{r+1})").font = BOLD
ws.cell(row=r + 2, column=2).number_format = "0.0%"
ws.cell(row=r + 4, column=1,
        value="THE IMPORTANT ROW is 'RESULT FOR THE YEAR'. The English translation the client supplied says this is a PROFIT of 9,303.78. It is a LOSS of 9,303.78. The tool gets it right because it now adds up the individual lines itself instead of trusting the total printed on the page.").font = NOTE

# ---------------------------------------------------- Cuadras case study ----
ws = wb.create_sheet("C-01 Cuadras detail")
title(ws, "C-01  Cuadras, Romy — ATHLETIC PRIME SARL (Switzerland, CHF)",
      "Why it read 0 lines, and what each fix bought.")
ws.column_dimensions["A"].width = 32
ws.column_dimensions["B"].width = 110
r = 4
blocks = [
    ("THE SHORT ANSWER", "Four separate faults, each one on its own enough to empty the work paper. Fixing all four took it from 0 lines to 22."),
    ("", ""),
    ("Fault 1 — the tool would not read the title",
     "It only looked at a page's heading if the page ALSO carried a company registration number or a 'Page 1 of 3' footer. This Swiss accountant prints neither. So the tool never read 'BILAN AU 31 DECEMBRE 2024' and called every page 'unknown'. An unknown document has its numbers thrown away on purpose."),
    ("Fault 2 — '2024 CHF' was not a year",
     "The columns are headed '2024 CHF' and '2023 CHF'. The tool removed currency codes from headings using a fixed list of ten. CHF was not on it. With no year on the columns, every row had two unlabelled numbers and was refused."),
    ("Fault 3 — the Swiss franc was called CHE",
     "All three exchange-rate tables labelled it CHE. CHE is the WIR Euro — a private currency used by a Swiss business barter network — not the franc. So an entity reporting in CHF found no rate at all. The stored numbers were the right ones; only the label was wrong."),
    ("Fault 4 — subtotals booked as real lines",
     "'Total revenue' was added on top of the revenue line it totals, so revenue came out at exactly double. 'Operating profit', 'Net financial income' and 'Profit before tax' were each booked as an expense."),
    ("Also fixed", "'EQUITY CAPITAL' was not recognised as a section heading, so share capital and retained earnings were rejected. And a scanned document is now sent to OCR automatically instead of being reported unreadable and left there."),
    ("", ""),
    ("THE DANGEROUS ONE — not a tool fault",
     "The client supplied an English 'translation' produced by a chatbot. IT DROPPED EVERY MINUS SIGN. The company made a LOSS of CHF 9,303.78; the translation states a PROFIT of the same amount — an 18,607 franc swing that turns a loss-making company into a profitable one. Do not use chatbot translations of financial statements."),
    ("Why the tool survived it",
     "Because fixing fault 4 means the tool adds the individual lines up itself rather than believing the total printed on the page. 1,540.00 of income less 11,211.70 of costs is a loss, whatever the page says."),
    ("", ""),
    ("What the prior-year US return gave us",
     "A great deal, and all of it correct: company name, address, date of formation, country, activity, currency, reference ID, the person holding the books, the filer categories, the shareholder, the opening balance sheet and the opening earnings & profits. Opening cash, receivables and payables all tie to the filed US dollars exactly."),
    ("The one thing that does not tie",
     "Opening retained earnings: the US return says $16,621, the Swiss statement works out to $13,161. The gap is exactly the 2023 profit — the US return counts it in, the Swiss 'report à nouveau' counts it out. The tool reports the mismatch; a person decides."),
    ("", ""),
    ("STILL NEEDED FROM THIS CLIENT",
     "1. The tax computation behind the CHF 84.80 charge (for Schedule E).\n2. A related-party ledger for the partner current account of CHF 26,027.29 (for Schedule M).\n3. Ideally, a prepared work paper for 2024 so there is something independent to check against."),
]
for a, b in blocks:
    ws.cell(row=r, column=1, value=a).font = BOLD if a else BODY
    c = ws.cell(row=r, column=2, value=b)
    c.font, c.alignment = BODY, WRAP
    if a.startswith("THE DANGEROUS"):
        ws.cell(row=r, column=1).fill = BADF
        c.fill = BADF
    if a.startswith("STILL NEEDED"):
        ws.cell(row=r, column=1).fill = WARNF
        c.fill = WARNF
    ws.row_dimensions[r].height = 16 if not b else max(30, 13 * (len(b) // 95 + b.count("\n") + 1))
    r += 1

# ------------------------------------------------ Chile case study ----------
ws = wb.create_sheet("C-02 C-03 Chile detail")
title(ws, "C-02 / C-03  Santmyer, Jaimie & Gonzalez, Ricardo — two Chilean companies (CLP)",
      "Why it read 0 lines, what was fixed, and what the document simply does not contain.")
ws.column_dimensions["A"].width = 32
ws.column_dimensions["B"].width = 110
r = 4
blocks = [
    ("THE SHORT ANSWER", "The document supplied is a TAX RETURN (Chilean SII Form 22), not a set of accounts. It contains a usable income statement but no balance sheet at all. Nine faults were fixed; two things remain that only a document can solve."),
    ("", ""),
    ("Fault — the numbers were a billion times too small",
     "Chile writes two and a half billion as 2.555.002.379. The tool treated the first dot as a decimal point and read 2.555."),
    ("Fault — no exchange rate for Chile",
     "The rate tables called the Chilean peso CLF. CLF is the Unidad de Fomento, a different Chilean unit. Same class of mistake as the Swiss CHE/CHF one."),
    ("Fault — nothing could be read from the form",
     "The Chilean form prints the box NUMBER at the far left, the CAPTION on the line above and the AMOUNT inside the box. The tool needed a caption and a number on the same line, so it found nothing on the whole filing. A new reader rebuilds the pairs from the page layout."),
    ("Fault — an expense booked as revenue",
     "The box 'Otros gastos deducibles de los ingresos' means 'other expenses deducted from income'. The only word the tool recognised was 'income'."),
    ("Fault — the company reported in Indian rupees",
     "The tool counted every three-letter code on the page. 'REX/INR/ Remanente' appears twice; the cell that simply says CLP appears once. INR won 2 to 1 — and the currency decides which exchange rate is used, so every converted figure would have been wrong."),
    ("Fault — company name read as '02 Apellido Materno'",
     "On a boxed form, the cell to the right of a caption is the NEXT box's caption. The value is on the line below."),
    ("Fault — Schedule E said no tax was paid",
     "Cecilia paid CLP 95,791,979. The tool had simply not found a tax figure, but said the company had paid none. Those are now different statements."),
    ("", ""),
    ("STILL OPEN — needs a decision from you",
     "The tool does not recognise the Chilean Form 22 as a financial document, because it identifies documents by headings like 'Balance Sheet' and this one says 'IMPUESTOS ANUALES A LA RENTA'. Until that is taught, you must set the document type by hand on the Documents tab. Teaching it is a small, safe change — you deferred it. See defect D-11."),
    ("", ""),
    ("CANNOT BE FIXED IN SOFTWARE",
     "The Form 22 has no balance sheet. It carries five aggregate boxes; a Schedule F needs eleven lines. Your own prepared work paper took the other eight from financial statements (it links to them on Google Drive). Ask the Chilean accountant for those statements — that is the only route to a complete balance sheet."),
    ("Also inconsistent in the prepared work paper",
     "The same Form 22 box ('Activo Inmovilizado') was put on line 10a for one company and line 9a for the other, and 'Capital Efectivo' was used as total assets for one but not the other. There is no rule the tool could copy — which is why auto-mapping those boxes was rejected rather than attempted."),
    ("", ""),
    ("THE GOOD NEWS",
     "For CHARLIE BRAWN the tool's net result for the year matches your prepared work paper TO THE PESO: 203,962,026. Every difference on the lines above it is your preparer moving amounts between categories using the financial statements. The tool read the filing correctly."),
    ("", ""),
    ("STILL NEEDED FROM THIS CLIENT",
     "1. Financial statements (balance sheet and profit & loss) for both companies — without these there is no Schedule F.\n2. The corporate tax return detail behind Cecilia's CLP 95,791,979 tax charge (for Schedule E).\n3. A related-party ledger — the prepared work paper shows USD 130,694.55 paid to a related party (for Schedule M)."),
]
for a, b in blocks:
    ws.cell(row=r, column=1, value=a).font = BOLD if a else BODY
    c = ws.cell(row=r, column=2, value=b)
    c.font, c.alignment = BODY, WRAP
    if a.startswith("CANNOT"):
        ws.cell(row=r, column=1).fill = BADF
        c.fill = BADF
    if a.startswith("STILL OPEN") or a.startswith("STILL NEEDED"):
        ws.cell(row=r, column=1).fill = WARNF
        c.fill = WARNF
    if a.startswith("THE GOOD"):
        ws.cell(row=r, column=1).fill = OKF
        c.fill = OKF
    ws.row_dimensions[r].height = 16 if not b else max(30, 13 * (len(b) // 95 + b.count("\n") + 1))
    r += 1

import os
os.makedirs("docs", exist_ok=True)
out = "docs/Client_Testing_Log.xlsx"
wb.save(out)
print("wrote", out)
