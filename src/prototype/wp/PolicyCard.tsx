"use client";

/* The mapping policy profile (policy.ts): the firm's switches in Settings,
   one entity's exceptions on Mapping & adjustments. The shipped file renders
   the same card from the enhancement layer (enhancePolicyCards). */
import { useSyncExternalStore } from "react";
import { actions, getSnapshot, subscribe } from "./store";
import { POLICY_SWITCHES, type MappingPolicy } from "./policy";

export function PolicyCard({ scope }: { scope: "firm" | "entity" }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const ent = state.entities.find((e) => e.id === state.activeEntityId) || state.entities[0];
  const cur: MappingPolicy = (scope === "firm" ? state.mappingPolicy : ent?.mappingPolicy) || {};
  const change = (key: keyof MappingPolicy, raw: string) => {
    const value = raw === "" ? undefined : raw === "true" ? true : raw === "false" ? false : raw;
    const patch = { [key]: value } as Partial<MappingPolicy>;
    if (scope === "firm") actions.setMappingPolicy(patch);
    else if (ent) actions.setEntityMappingPolicy(ent.id, patch);
  };
  return (
    <section className="panel en9-policy">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">{scope === "firm" ? "Firm mapping policy" : "This entity's mapping policy"}</span>
          <h2>{scope === "firm" ? "Where your firm puts figures the rules could place either way" : `Exceptions to the firm policy for ${ent?.name ?? "this entity"}`}</h2>
        </div>
      </div>
      <p className="hint">
        {scope === "firm"
          ? "Every switch left on its first choice follows the mapping rules. A switch moves figures only on the next processing run, and each moved figure says so on the Provenance sheet. A preparer's own assignment is never moved."
          : "Unset switches follow the firm policy. Re-process the entity after a change."}
      </p>
      <div className="en9-policy-grid">
        {POLICY_SWITCHES.map((sw) => {
          const v = cur[sw.key];
          return (
            <label key={sw.key} className="en9-policy-row">
              <span>{sw.label}</span>
              <select aria-label={sw.label} value={v === undefined ? "" : String(v)} onChange={(e) => change(sw.key, e.target.value)}>
                <option value="">{scope === "firm" ? `Rules (default): ${sw.choices[0][1]}` : "Follow the firm policy"}</option>
                {sw.choices.filter((_, i) => scope !== "firm" || i > 0).map(([val, text]) => <option key={val} value={val}>{text}</option>)}
              </select>
            </label>
          );
        })}
      </div>
    </section>
  );
}
