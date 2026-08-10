"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Callout, SectionHeader } from "../primitives";
import { BS_LINES, IS_LINES } from "./engine";
import { actions, getSnapshot, subscribe } from "./store";

const SCRIPTS: Array<{ name: string; re: RegExp }> = [
  { name: "Arabic", re: /[\u0600-\u06FF]/ },
  { name: "Chinese", re: /[\u4E00-\u9FFF]/ },
  { name: "Japanese", re: /[\u3040-\u30FF]/ },
  { name: "Korean", re: /[\uAC00-\uD7AF]/ },
  { name: "Cyrillic", re: /[\u0400-\u04FF]/ },
  { name: "Greek", re: /[\u0370-\u03FF]/ },
  { name: "Hebrew", re: /[\u0590-\u05FF]/ },
];

const HINTS: Array<{ name: string; words: string[] }> = [
  { name: "French", words: ["achats", "charges", "produits", "créances", "dettes", "immobilisations", "amortissements", "loyer", "société", "trésorerie", "capital social"] },
  { name: "Spanish", words: ["ingresos", "gastos", "cuenta", "clientes", "proveedores", "inmovilizado", "existencias", "capital", "banco"] },
  { name: "German", words: ["umsatz", "aufwand", "ertrag", "forderungen", "verbindlichkeiten", "anlagevermögen", "kapital"] },
  { name: "Portuguese", words: ["receita", "despesa", "clientes", "fornecedores", "imobilizado", "capital"] },
  { name: "Italian", words: ["ricavi", "costi", "crediti", "debiti", "immobilizzazioni", "capitale"] },
];

/** Script and vocabulary detection over an extracted label. */
function detectLanguage(label: string): string {
  for (const s of SCRIPTS) if (s.re.test(label)) return s.name;
  const l = label.toLowerCase();
  for (const h of HINTS) if (h.words.some((w) => l.includes(w))) return h.name;
  if (/[àâçéèêëîïôûùüÿœ]/.test(l)) return "French";
  if (/[áéíóúñ¿¡]/.test(l)) return "Spanish";
  if (/[äöüß]/.test(l)) return "German";
  return "English";
}

const lineLabel = (target: string) => {
  const [kind, row] = target.split(":");
  const list = kind === "IS" ? IS_LINES : BS_LINES;
  const hit = list.find((l) => String(l.row) === row);
  return hit ? `${kind === "IS" ? "Sch C" : "Sch F"} · ${hit.label}` : target;
};


function EntitySwitch() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (state.entities.length < 2) return null;
  return (
    <div className="entity-switch">
      <span>Entity</span>
      {state.entities.map((e) => (
        <button
          key={e.id}
          type="button"
          className={e.id === state.activeEntityId ? "chip-btn active" : "chip-btn"}
          onClick={() => actions.setActiveEntity(e.id)}
        >
          {e.name}
        </button>
      ))}
    </div>
  );
}

export function EvidenceView() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    const out: Array<{
      entity: string; entityId: string; label: string; language: string;
      target: string | null; values: number[]; translation: string | null;
    }> = [];
    for (const ent of state.entities) {
      for (const [target, src] of Object.entries(ent.sourceLabels || {})) {
        out.push({
          entity: ent.name, entityId: ent.id, label: src.label,
          language: detectLanguage(src.label), target,
          values: src.values, translation: ent.translations?.[src.label] ?? null,
        });
      }
      for (const u of ent.unmatched) {
        out.push({
          entity: ent.name, entityId: ent.id, label: u.label,
          language: detectLanguage(u.label), target: null,
          values: u.values, translation: ent.translations?.[u.label] ?? null,
        });
      }
    }
    return out;
  }, [state.entities]);

  const languages = [...new Set(rows.map((r) => r.language))].sort();
  const shown = filter === "all" ? rows : rows.filter((r) => r.language === filter);
  const nonEnglish = rows.filter((r) => r.language !== "English");
  const untranslated = nonEnglish.filter((r) => !r.translation);

  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Document evidence"
        title="Multilingual evidence"
        description="Every caption read out of your documents, with the script or vocabulary it was written in and the template line it was bound to. Amounts are always taken from the document — translation only ever affects the label."
        action={
          <div className="signoff-actions">
            <button
              type="button"
              className="button primary"
              disabled={state.busy || !untranslated.length}
              onClick={() => void actions.translateFreeLabels()}
            >
              {state.busy ? "Working…" : `Translate free (${untranslated.length})`}
            </button>
            <button
              type="button"
              className="button"
              disabled={state.busy || !untranslated.length}
              onClick={() => void actions.translateLabels()}
            >
              Translate with Groq
            </button>
          </div>
        }
      />

      <EntitySwitch />

      <div className="metric-grid">
        <div className="metric-card"><strong>{rows.length}</strong><span>Captions extracted</span><em>across {state.entities.length} entit{state.entities.length === 1 ? "y" : "ies"}</em></div>
        <div className="metric-card"><strong>{languages.length}</strong><span>Languages detected</span><em>{languages.slice(0, 4).join(", ") || "—"}</em></div>
        <div className="metric-card"><strong>{nonEnglish.length}</strong><span>Non-English captions</span><em>{nonEnglish.length - untranslated.length} translated</em></div>
        <div className="metric-card"><strong>{rows.filter((r) => r.target).length}</strong><span>Bound to a template line</span><em>{rows.filter((r) => !r.target).length} unassigned</em></div>
      </div>

      {rows.length === 0 ? (
        <Callout title="No evidence yet" tone="amber">
          Load documents against an entity and run processing. Every caption the parser reads appears here with its
          detected language, so a reviewer can see exactly what the numbers came from.
        </Callout>
      ) : null}

      {untranslated.length ? (
        <Callout title={`${untranslated.length} caption(s) are not in English`} tone="teal">
          <strong>Translate free</strong> uses keyless public services (MyMemory, then Lingva) — no account needed.
          <strong> Translate with Groq</strong> needs a key but handles accounting terminology better. Either way the
          translation is stored beside the original caption, never instead of it, and amounts are untouched.
        </Callout>
      ) : null}

      {rows.length ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">{shown.length} shown</span>
              <h2>Extracted captions</h2>
            </div>
            <select className="stake-input" style={{ maxWidth: 190 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All languages</option>
              {languages.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="wp-table">
            <table>
              <thead>
                <tr>
                  <th>Caption in the document</th>
                  <th style={{ width: 90 }}>Language</th>
                  <th>English</th>
                  <th className="numeric" style={{ width: 150 }}>Values read</th>
                  <th style={{ width: 210 }}>Bound to</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.entityId + r.label + i}>
                    <td><strong>{r.label}</strong><br /><small style={{ color: "var(--muted)" }}>{r.entity}</small></td>
                    <td><span className={r.language === "English" ? "actor-tag system" : "actor-tag groq"}>{r.language}</span></td>
                    <td style={{ color: "var(--muted)" }}>{r.translation || (r.language === "English" ? "—" : "not translated")}</td>
                    <td className="numeric">{r.values.map((v) => v.toLocaleString()).join(" · ")}</td>
                    <td>{r.target ? lineLabel(r.target) : <span className="actor-tag user">unassigned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
