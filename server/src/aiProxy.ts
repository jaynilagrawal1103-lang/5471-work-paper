/* Server-side Groq proxy.

   Three requirements were given and they cannot all hold with a browser-held
   key: don't hard-code it, don't expose it in the frontend, and let a shared
   deployment use a configured key. Anything the browser holds is readable by
   whoever opens the page — including a key injected at build time, which is why
   there is no build step here. The only arrangement that satisfies all three is
   this one: the key lives in the server's environment, the browser never sees
   it, and the browser asks the server to make the call.

   That moves the exposure rather than removing it: anyone who can reach this
   route can spend the key's quota. So the route is defended three ways —
   an origin allow-list, an optional shared token, and per-IP rate limits — and
   Settings states plainly which mode is active and what it costs.

   Environment:
     GROQ_API_KEY      the key. Absent => the route reports unconfigured and the
                       browser falls back to its own per-browser key.
     AI_PROXY_TOKEN    optional shared secret; when set, callers must send it as
                       X-AI-Proxy-Token. Not a user identity — see the note in
                       Settings.
     AI_RATE_PER_MIN   per-IP requests per minute (default 20)
     AI_RATE_PER_DAY   per-IP requests per day (default 2000)
     AI_MAX_TOKENS     ceiling applied to max_tokens (default 4000)
     AI_MODELS         comma-separated model allow-list (default: the three the
                       app offers)
     CORS_ORIGINS      reused: when set, the proxy refuses cross-site callers
*/
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const DEFAULT_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile",
];

export type ProxyConfig = {
  key: string;
  token: string;
  perMin: number;
  perDay: number;
  maxTokens: number;
  models: string[];
  origins: string[];
};

export function readProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const list = (v: string | undefined, fallback: string[] = []) =>
    (v || "").split(",").map((s) => s.trim()).filter(Boolean).length
      ? (v || "").split(",").map((s) => s.trim()).filter(Boolean)
      : fallback;
  return {
    key: (env.GROQ_API_KEY || "").trim(),
    token: (env.AI_PROXY_TOKEN || "").trim(),
    perMin: Number(env.AI_RATE_PER_MIN || 20),
    perDay: Number(env.AI_RATE_PER_DAY || 2000),
    maxTokens: Number(env.AI_MAX_TOKENS || 4000),
    models: list(env.AI_MODELS, DEFAULT_MODELS),
    origins: list(env.CORS_ORIGINS, []),
  };
}

/* ---------------- rate limiting: per-IP sliding minute + rolling day ------ */

type Bucket = { minute: number[]; day: number[] };
const buckets = new Map<string, Bucket>();

export function rateCheck(
  ip: string,
  cfg: Pick<ProxyConfig, "perMin" | "perDay">,
  now = Date.now(),
  store: Map<string, Bucket> = buckets,
): { ok: true } | { ok: false; retryAfter: number; scope: "minute" | "day" } {
  const b = store.get(ip) || { minute: [], day: [] };
  b.minute = b.minute.filter((t) => t > now - 60_000);
  b.day = b.day.filter((t) => t > now - 86_400_000);
  if (b.minute.length >= cfg.perMin) {
    store.set(ip, b);
    return { ok: false, scope: "minute", retryAfter: Math.ceil((b.minute[0] + 60_000 - now) / 1000) };
  }
  if (b.day.length >= cfg.perDay) {
    store.set(ip, b);
    return { ok: false, scope: "day", retryAfter: Math.ceil((b.day[0] + 86_400_000 - now) / 1000) };
  }
  b.minute.push(now);
  b.day.push(now);
  store.set(ip, b);
  return { ok: true };
}

/** Housekeeping so a long-lived process doesn't accumulate dead IPs. */
export function sweepBuckets(now = Date.now(), store: Map<string, Bucket> = buckets) {
  for (const [ip, b] of store) {
    if (!b.day.some((t) => t > now - 86_400_000)) store.delete(ip);
  }
}

/* ---------------- request validation ------------------------------------- */

export type Validated =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string };

export function validateChatBody(raw: unknown, cfg: ProxyConfig): Validated {
  const b = (raw || {}) as Record<string, unknown>;
  const messages = b.messages;
  if (!Array.isArray(messages) || !messages.length)
    return { ok: false, status: 400, error: "messages must be a non-empty array" };
  if (messages.length > 40) return { ok: false, status: 400, error: "too many messages" };
  let chars = 0;
  for (const m of messages) {
    const mm = (m || {}) as Record<string, unknown>;
    if (typeof mm.content !== "string" || !["system", "user", "assistant"].includes(String(mm.role)))
      return { ok: false, status: 400, error: "each message needs a role and string content" };
    chars += mm.content.length;
  }
  if (chars > 200_000) return { ok: false, status: 413, error: "prompt too large for the proxy" };

  const model = typeof b.model === "string" && b.model ? b.model : cfg.models[0];
  if (!cfg.models.includes(model))
    return { ok: false, status: 400, error: `model not permitted: ${model}` };

  const asked = Number(b.max_tokens || 1500);
  const out: Record<string, unknown> = {
    model,
    messages,
    temperature: typeof b.temperature === "number" ? Math.max(0, Math.min(2, b.temperature)) : 0,
    max_tokens: Math.max(16, Math.min(cfg.maxTokens, isFinite(asked) ? asked : 1500)),
  };
  if (b.response_format && typeof b.response_format === "object") out.response_format = b.response_format;
  if (typeof b.reasoning_effort === "string") out.reasoning_effort = b.reasoning_effort;
  return { ok: true, body: out };
}

/** Same-site or an allow-listed origin. When CORS_ORIGINS is unset, only
    same-origin/no-origin callers are accepted — a browser on another site
    always sends an Origin header, so this blocks cross-site relaying. */
export function originAllowed(origin: string | undefined, host: string | undefined, origins: string[]): boolean {
  if (!origin) return true; // same-origin navigations and server-side callers
  if (origins.includes(origin)) return true;
  try {
    if (host && new URL(origin).host === host) return true;
  } catch { /* malformed Origin */ }
  return false;
}

/* ---------------- route --------------------------------------------------- */

export function registerAiProxy(app: FastifyInstance, cfg: ProxyConfig = readProxyConfig()) {
  const sweeper = setInterval(() => sweepBuckets(), 10 * 60_000);
  if (typeof sweeper.unref === "function") sweeper.unref();

  // Lets the browser decide, at boot, whether to use the proxy or its own key.
  // Reports only whether a key exists — never any part of the key itself.
  app.get("/api/ai/status", async () => ({
    proxy: !!cfg.key,
    tokenRequired: !!cfg.token,
    models: cfg.models,
    perMin: cfg.perMin,
    perDay: cfg.perDay,
  }));

  app.post("/api/ai/chat", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!cfg.key)
      return reply.code(503).send({ error: "no server-side AI key configured (set GROQ_API_KEY)" });

    if (!originAllowed(req.headers.origin as string | undefined, req.headers.host, cfg.origins))
      return reply.code(403).send({ error: "origin not permitted" });

    if (cfg.token && req.headers["x-ai-proxy-token"] !== cfg.token)
      return reply.code(401).send({ error: "missing or invalid X-AI-Proxy-Token" });

    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() || req.ip || "unknown";
    const rl = rateCheck(ip, cfg);
    if (!rl.ok) {
      reply.header("Retry-After", String(rl.retryAfter));
      return reply.code(429).send({
        error: { code: "rate_limit_exceeded", message: `proxy ${rl.scope} limit reached, try again in ${rl.retryAfter}s` },
      });
    }

    const v = validateChatBody(req.body, cfg);
    if (!v.ok) return reply.code(v.status).send({ error: { code: "invalid_request", message: v.error } });

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 90_000);
    try {
      const upstream = await fetch(GROQ_URL, {
        method: "POST",
        // The one place the key is ever read. It is not returned to the client
        // in any response, error or header.
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify(v.body),
        signal: ctl.signal,
      });
      const text = await upstream.text();
      reply.code(upstream.status);
      reply.header("content-type", upstream.headers.get("content-type") || "application/json");
      const ra = upstream.headers.get("retry-after");
      if (ra) reply.header("Retry-After", ra);
      // Pass the provider's own body through so the client's 413/429 handling
      // keeps working unchanged; scrub anything that could echo the key back.
      return reply.send(text.split(cfg.key).join("[redacted]"));
    } catch (err) {
      const msg = (err as Error)?.name === "AbortError" ? "upstream timed out" : "upstream unreachable";
      return reply.code(502).send({ error: { code: "server_error", message: msg } });
    } finally {
      clearTimeout(timer);
    }
  });
}
