// Kabul Cloud waitlist: POST /api/waitlist (Cloudflare Pages Function).
//
// Accepts the landing page form (application/x-www-form-urlencoded or multipart, without JavaScript)
// and JSON (the small script in the page). Stores one entry per e-mail in the WAITLIST KV namespace:
//
//   key   email:<lower-case e-mail>
//   value {"email","use","lang","createdAt","country"}
//
// Protection: same-origin check, body size limit, honeypot field ("company"), e-mail validation and a
// simple per-IP rate limit kept in the same KV (the IP is stored only as a salted SHA-256 hash, with a TTL).
//
// Without JavaScript the browser gets a 303 back to the page, to an anchor that shows the right message
// with CSS (:target). With `Accept: application/json` the answer is JSON: { ok, code }.

interface Env {
  WAITLIST?: KVNamespace;
  /** Max sign-ups per IP per window (default 5). */
  WAITLIST_RATE_LIMIT?: string;
  /** Window in seconds (default 3600, minimum 60, which is KV's minimum TTL). */
  WAITLIST_RATE_WINDOW?: string;
  /** Salt for the IP hash. Set it as a secret in production (wrangler pages secret put WAITLIST_SALT). */
  WAITLIST_SALT?: string;
}

type Code = "ok" | "invalid" | "limited" | "failed";
type Lang = "en" | "pt-BR";
type Use = "solo" | "team" | "unknown";

const MAX_BODY = 4096;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

const handlePost: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const wantsJson = (request.headers.get("accept") || "").includes("application/json");
  let lang: Lang = "en";

  const reply = (code: Code, status: number) => {
    if (wantsJson) {
      return new Response(JSON.stringify({ ok: code === "ok", code }), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    const page = lang === "pt-BR" ? "/pt-BR/" : "/";
    return new Response(null, {
      status: 303,
      headers: { location: `${page}#waitlist-${code}`, "cache-control": "no-store" },
    });
  };

  // Same origin only: browsers always send Origin on a cross-site POST.
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      /* invalid Origin header */
    }
    if (host !== url.host) return reply("invalid", 403);
  }

  const length = Number(request.headers.get("content-length") || "0");
  if (length > MAX_BODY) return reply("invalid", 413);

  let fields: Record<string, string>;
  try {
    fields = await readFields(request);
  } catch {
    return reply("invalid", 400);
  }

  lang = fields.lang === "pt-BR" ? "pt-BR" : "en";

  // Honeypot: people never see this field; bots fill it. Pretend it worked and store nothing.
  if ((fields.company || "").trim() !== "") return reply("ok", 200);

  const email = (fields.email || "").trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !EMAIL.test(email)) return reply("invalid", 400);
  const use: Use = fields.use === "solo" || fields.use === "team" ? fields.use : "unknown";

  const kv = env.WAITLIST;
  if (!kv) return reply("failed", 503);

  try {
    const limit = clampInt(env.WAITLIST_RATE_LIMIT, 5, 1, 1000);
    const windowSecs = clampInt(env.WAITLIST_RATE_WINDOW, 3600, 60, 86400);
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const rlKey = `rl:${await sha256(`${env.WAITLIST_SALT || "kabul-waitlist"}:${ip}`)}`;
    const used = Number((await kv.get(rlKey)) || "0");
    if (used >= limit) return reply("limited", 429);
    await kv.put(rlKey, String(used + 1), { expirationTtl: windowSecs });

    const key = `email:${email}`;
    // Signing up twice is fine and says nothing about whether an address is already on the list.
    if ((await kv.get(key)) === null) {
      const country = (request as Request & { cf?: { country?: string } }).cf?.country || null;
      await kv.put(key, JSON.stringify({ email, use, lang, createdAt: new Date().toISOString(), country }));
    }
    return reply("ok", 200);
  } catch {
    return reply("failed", 500);
  }
};

// One handler for every method, so the 405 never shadows the POST route.
export const onRequest: PagesFunction<Env> = async (context) =>
  context.request.method === "POST"
    ? handlePost(context)
    : new Response("Method not allowed", { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });

async function readFields(request: Request): Promise<Record<string, string>> {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Error("body too large");
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") throw new Error("not an object");
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v.slice(0, 300);
    }
  } else if (type.includes("application/x-www-form-urlencoded")) {
    for (const [k, v] of new URLSearchParams(raw)) out[k] = v.slice(0, 300);
  } else if (type.includes("multipart/form-data")) {
    const form = await new Response(raw, { headers: { "content-type": type } }).formData();
    for (const [k, v] of form) if (typeof v === "string") out[k] = v.slice(0, 300);
  } else {
    throw new Error("unsupported content type");
  }
  return out;
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value || "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
