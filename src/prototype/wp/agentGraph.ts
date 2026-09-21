/* A state-graph runtime in the shape LangGraph publishes.
 *
 * Why this file exists rather than an `import { StateGraph } from
 * "@langchain/langgraph"`: the shipped application is one offline HTML file
 * that is patched, never rebuilt, and runs from `file://` with no server and
 * no package loader. A bundler step would strip the surgical patches the file
 * carries, and LangGraph's own JS distribution expects a Node runtime. So the
 * PATTERN is adopted verbatim — typed channels with reducers, named nodes that
 * return partial updates, plain and conditional edges, START and END, a
 * recursion limit, a step callback for tracing — while the executor itself is
 * these ~90 lines. The agent in `agent.ts` is written against this API, so it
 * is the same graph whether it runs here or, on a deployment that has a
 * server, against the real library.
 *
 * Pure: no network, no store, no DOM. Everything the agent needs from the
 * outside arrives in the config.
 */

export const START = "__start__";
export const END = "__end__";

/** A channel is a named slot in the graph state plus the rule for merging a
    node's update into it. `value` is the reducer, `default` the empty. */
export type Channel<V> = { value: (current: V, update: V) => V; default: () => V };
export type Channels<S> = { [K in keyof S]: Channel<S[K]> };

/** Keep every update, oldest first — for logs, findings, suggestions. */
export const append = <V>(): Channel<V[]> => ({ value: (a, b) => [...(a || []), ...(b || [])], default: () => [] });
/** The last node to write wins — for scalars. */
export const last = <V>(empty: V): Channel<V> => ({ value: (_a, b) => b, default: () => empty });

export type StepNote = { node: string; ms: number; wrote: string[] };
export type RunConfig = {
  /** Mirrors LangGraph's `recursionLimit`: the ceiling on node executions, so
      a router that never reaches END stops rather than hanging the tab. */
  recursionLimit?: number;
  /** Called after every node — the processing log subscribes to it. */
  onStep?: (note: StepNote) => void;
  /** Anything the nodes need that is not graph state (the model client, a
      note sink). LangGraph calls this `configurable`. */
  configurable?: Record<string, unknown>;
};

export type NodeFn<S> = (state: S, config: RunConfig) => Promise<Partial<S> | void> | Partial<S> | void;
type Branch<S> = { router: (state: S) => string | Promise<string>; map?: Record<string, string> };

export class StateGraph<S extends Record<string, unknown>> {
  private channels: Channels<S>;
  private nodes = new Map<string, NodeFn<S>>();
  private edges = new Map<string, string>();
  private branches = new Map<string, Branch<S>>();

  constructor(def: { channels: Channels<S> }) { this.channels = def.channels; }

  addNode(name: string, fn: NodeFn<S>): this {
    if (name === START || name === END) throw new Error(`"${name}" is reserved`);
    if (this.nodes.has(name)) throw new Error(`node "${name}" is already defined`);
    this.nodes.set(name, fn);
    return this;
  }

  addEdge(from: string, to: string): this { this.edges.set(from, to); return this; }

  /** `router` returns a key; `map` translates it to a node name (or END).
      Without a map the key IS the node name, as LangGraph allows. */
  addConditionalEdges(from: string, router: Branch<S>["router"], map?: Record<string, string>): this {
    this.branches.set(from, { router, map });
    return this;
  }

  /** Node names in declaration order, with their outgoing edges — the Settings
      panel draws the agent from this rather than from a hand-written list
      that could drift away from the graph. */
  describe(): { nodes: string[]; edges: Array<{ from: string; to: string; conditional: boolean }> } {
    const edges: Array<{ from: string; to: string; conditional: boolean }> = [];
    for (const [from, to] of this.edges) edges.push({ from, to, conditional: false });
    for (const [from, b] of this.branches) {
      for (const to of Object.values(b.map || {})) edges.push({ from, to, conditional: true });
    }
    return { nodes: [...this.nodes.keys()], edges };
  }

  compile() {
    if (!this.edges.has(START) && !this.branches.has(START)) throw new Error("graph has no entry point");
    const self = this;
    return {
      describe: () => self.describe(),
      async invoke(input: Partial<S>, config: RunConfig = {}): Promise<S> {
        const state = {} as S;
        for (const key of Object.keys(self.channels) as Array<keyof S>) state[key] = self.channels[key].default();
        for (const key of Object.keys(input) as Array<keyof S>) {
          if (input[key] !== undefined) state[key] = input[key] as S[keyof S];
        }
        const limit = config.recursionLimit || 25;
        let current = await self.next(START, state);
        let steps = 0;
        while (current !== END) {
          if (++steps > limit) throw new Error(`agent graph exceeded ${limit} steps at "${current}"`);
          const fn = self.nodes.get(current);
          if (!fn) throw new Error(`no node named "${current}"`);
          const t0 = Date.now();
          const update = ((await fn(state, config)) || {}) as Partial<S>;
          const wrote: string[] = [];
          for (const key of Object.keys(update) as Array<keyof S>) {
            const channel = self.channels[key];
            if (!channel) throw new Error(`node "${current}" wrote unknown channel "${String(key)}"`);
            state[key] = channel.value(state[key], update[key] as S[keyof S]);
            wrote.push(String(key));
          }
          config.onStep?.({ node: current, ms: Date.now() - t0, wrote });
          current = await self.next(current, state);
        }
        return state;
      },
    };
  }

  private async next(from: string, state: S): Promise<string> {
    const branch = this.branches.get(from);
    if (branch) {
      const key = await branch.router(state);
      const to = branch.map ? branch.map[key] : key;
      if (!to) throw new Error(`conditional edge from "${from}" has no route for "${key}"`);
      return to;
    }
    const to = this.edges.get(from);
    if (!to) throw new Error(`node "${from}" has no outgoing edge`);
    return to;
  }
}
