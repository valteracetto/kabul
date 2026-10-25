// One address for the site: any other host that reaches the production deployment (www.kabul.dev,
// kabul.pages.dev) gets a 301 to https://kabul.dev with the same path and query string.
//
// Left alone:
// - kabul.dev itself;
// - branch and commit previews (<branch>.kabul.pages.dev, <hash>.kabul.pages.dev), so they stay testable;
// - local development (localhost, 127.0.0.1, [::1]);
// - /api/*, so a POST to the waitlist never turns into a GET through a redirect.
//
// Static files under /assets/, /media/ and the icons skip Functions entirely (dist/_routes.json, written by
// scripts/build.ts): they are only ever requested from a page that was already redirected.
interface Env {
  /** Canonical host, without scheme (default kabul.dev). Set as a var in wrangler.toml. */
  CANONICAL_HOST?: string;
}

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function redirectTarget(requestUrl: string, canonical = "kabul.dev"): string | null {
  const url = new URL(requestUrl);
  const host = url.hostname.toLowerCase();
  if (host === canonical || LOCAL.has(host)) return null;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;
  // Production is <project>.pages.dev; anything below it is a preview deployment.
  if (host.endsWith(".pages.dev") && host.split(".").length > 3) return null;
  return `https://${canonical}${url.pathname}${url.search}`;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const target = redirectTarget(request.url, env.CANONICAL_HOST || "kabul.dev");
  if (!target) return next();
  return new Response(null, {
    status: 301,
    headers: { Location: target, "Cache-Control": "public, max-age=86400" },
  });
};
