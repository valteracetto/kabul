// Renders one language of the landing page to a full HTML document (no client framework).
import { config, isSet } from "./config.ts";
import { content, type Content, type Img, type Lang, type Mark } from "./content.ts";

export type Variant = { w: number; url: string };
export type Picture = { width: number; height: number; avif: Variant[]; webp: Variant[] };

export type Ctx = {
  siteUrl: string;
  version: string;
  css: string;
  js: string;
  font: string;
  pictures: Record<Img, Picture>;
  icons: { svg: string; ico: string; apple: string; manifest: string };
  og: { url: string; width: number; height: number };
  video: { src: string; poster: string; width: number; height: number };
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = esc;
/** Strip inline HTML for meta tags and JSON-LD. */
const plain = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
const repo = (href: string) => href.replace("{repo}", config.repo);
const docs = (c: Content, path: string) => `${config.docs.en}${path}`;
const ext = `rel="noopener"`;

const otherLang = (lang: Lang): Lang => (lang === "en" ? "pt-BR" : "en");

function picture(
  ctx: Ctx,
  key: Img,
  alt: string,
  sizes: string,
  opts: { eager?: boolean; className?: string } = {},
): string {
  const p = ctx.pictures[key];
  const set = (vs: Variant[]) => vs.map((v) => `${v.url} ${v.w}w`).join(", ");
  const fallback = p.webp[Math.min(1, p.webp.length - 1)];
  const loading = opts.eager ? `fetchpriority="high" decoding="async"` : `loading="lazy" decoding="async"`;
  return `<picture${opts.className ? ` class="${opts.className}"` : ""}><source type="image/avif" srcset="${set(p.avif)}" sizes="${sizes}"><source type="image/webp" srcset="${set(p.webp)}" sizes="${sizes}"><img src="${fallback.url}" width="${p.width}" height="${p.height}" alt="${attr(alt)}" ${loading}></picture>`;
}

const ICON_DOWNLOAD = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14"/></svg>`;
const ICON_GITHUB = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>`;
const ICON_STAR = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/></svg>`;
const MARK_GLYPH: Record<Mark, string> = { y: "✓", p: "◐", u: "?", n: "–" };

function mark(c: Content, m: Mark, note?: string): string {
  const label = c.agents.marks[m];
  const noteText = note ? c.agents.notes[note] ?? note : "";
  const small = noteText && noteText !== "¹" ? `<small>${esc(noteText)}</small>` : "";
  const sup = noteText === "¹" ? `<sup>¹</sup>` : "";
  return `<span class="mark m-${m}"><i aria-hidden="true">${MARK_GLYPH[m]}</i><span class="sr-only">${esc(label)}</span>${sup}${small}</span>`;
}

function jsonLd(c: Content, ctx: Ctx): string {
  const url = `${ctx.siteUrl}${c.path}`;
  const org = {
    "@type": "Organization",
    "@id": `${ctx.siteUrl}/#org`,
    name: "Kabul",
    url: `${ctx.siteUrl}/`,
    logo: `${ctx.siteUrl}/icon-512.png`,
    sameAs: [config.repo],
  };
  const app = {
    "@type": "SoftwareApplication",
    "@id": `${ctx.siteUrl}/#app`,
    name: "Kabul",
    description: c.meta.description,
    url,
    image: `${ctx.siteUrl}${ctx.og.url}`,
    screenshot: `${ctx.siteUrl}${ctx.og.url}`,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS, Windows",
    softwareVersion: ctx.version,
    downloadUrl: config.download.mac,
    installUrl: config.download.mac,
    license: "https://opensource.org/licenses/MIT",
    isAccessibleForFree: true,
    inLanguage: ["en", "pt-BR"],
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@id": `${ctx.siteUrl}/#org` },
    codeRepository: config.repo,
  };
  const faq = {
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    inLanguage: c.lang,
    mainEntity: c.faq.items.map((i) => ({
      "@type": "Question",
      name: i.q,
      acceptedAnswer: { "@type": "Answer", text: plain(i.a) },
    })),
  };
  const data = { "@context": "https://schema.org", "@graph": [org, app, faq] };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function renderPage(lang: Lang, ctx: Ctx): string {
  const c = content[lang];
  const o = content[otherLang(lang)];
  const url = `${ctx.siteUrl}${c.path}`;
  const hero = ctx.pictures.hero;
  const heroSizes = "(max-width: 1260px) 100vw, 1180px";
  const set = (vs: Variant[]) => vs.map((v) => `${v.url} ${v.w}w`).join(", ");

  const donations = config.donations.filter((d) => isSet(d.url));
  const pix = isSet(config.pix.key) ? config.pix : null;
  const hasSupport = donations.length > 0 || !!pix;

  const shotOrder: Img[] = ["agents", "menubar", "usage", "mcp"];
  const shots = shotOrder.map((k) => c.features.shots.find((s) => s.img === k)!);

  return `<!doctype html>
<html lang="${c.lang}" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(c.meta.title)}</title>
<meta name="description" content="${attr(c.meta.description)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="en" href="${ctx.siteUrl}/">
<link rel="alternate" hreflang="pt-BR" href="${ctx.siteUrl}/pt-BR/">
<link rel="alternate" hreflang="x-default" href="${ctx.siteUrl}/">
<meta name="theme-color" content="#141110">
<meta name="color-scheme" content="dark">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Kabul">
<meta property="og:title" content="${attr(c.meta.title)}">
<meta property="og:description" content="${attr(c.meta.description)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="${c.ogLocale}">
<meta property="og:locale:alternate" content="${o.ogLocale}">
<meta property="og:image" content="${ctx.siteUrl}${ctx.og.url}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${ctx.og.width}">
<meta property="og:image:height" content="${ctx.og.height}">
<meta property="og:image:alt" content="${attr(c.meta.ogAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(c.meta.title)}">
<meta name="twitter:description" content="${attr(c.meta.description)}">
<meta name="twitter:image" content="${ctx.siteUrl}${ctx.og.url}">
<meta name="twitter:image:alt" content="${attr(c.meta.ogAlt)}">
<link rel="icon" href="${ctx.icons.ico}" sizes="32x32">
<link rel="icon" href="${ctx.icons.svg}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${ctx.icons.apple}">
<link rel="manifest" href="${ctx.icons.manifest}">
<link rel="preload" href="${ctx.font}" as="font" type="font/woff2" crossorigin>
<link rel="preload" as="image" type="image/avif" imagesrcset="${set(hero.avif)}" imagesizes="${heroSizes}" fetchpriority="high">
<style>${ctx.css}</style>
<script type="application/ld+json">${jsonLd(c, ctx)}</script>
<script src="${ctx.js}" defer></script>
</head>
<body>
<a class="skip" href="#main">${esc(c.nav.skip)}</a>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="${c.path}" aria-label="Kabul"><img src="${ctx.icons.svg}" width="28" height="28" alt=""><span>Kabul</span></a>
    <nav class="nav" aria-label="${attr(c.nav.label)}">
      <a href="#features">${esc(c.nav.features)}</a>
      <a href="#agents">${esc(c.nav.agents)}</a>
      <a href="#phone">${esc(c.nav.phone)}</a>
      <a href="#cloud">${esc(c.nav.cloud)}</a>
      <a href="${config.docs[lang]}" ${ext}>${esc(c.nav.docs)}</a>
    </nav>
    <div class="top-actions">
      <a class="lang" href="${o.path}" hreflang="${o.lang}" lang="${o.lang}"><span class="long">${esc(c.nav.langOther)}</span><span class="short" aria-hidden="true">${esc(c.nav.langOtherShort)}</span></a>
      <a class="btn btn-sm" href="${config.repo}" ${ext} aria-label="${attr(c.nav.github)}">${ICON_GITHUB}<span class="label">${esc(c.nav.github)}</span></a>
    </div>
  </div>
</header>

<main id="main">
<section class="hero" aria-labelledby="hero-title">
  <div class="wrap">
    <div class="hero-text">
      <h1 id="hero-title">${esc(c.hero.title)}</h1>
      <p class="lede">${esc(c.hero.lede)}</p>
      <div class="cta">
        <a class="btn btn-primary" href="${config.download.mac}" ${ext}>${ICON_DOWNLOAD}${esc(c.hero.download)}</a>
        <a class="btn" href="${config.repo}" ${ext}>${ICON_STAR}${esc(c.hero.star)}</a>
        <a class="btn btn-quiet" href="${config.download.windows}" ${ext}>${esc(c.hero.windows)}</a>
      </div>
      <p class="fine">${esc(c.hero.fine)}</p>
    </div>
    <div class="lanes">
      <p class="lanes-label" id="lanes-label">${esc(c.hero.lanesLabel)}</p>
      <ul aria-labelledby="lanes-label">
        <li class="l-claude">Claude Code</li><li class="l-codex">Codex</li><li class="l-agy">Antigravity</li><li class="l-gemini">Gemini CLI</li><li class="l-qwen">Qwen Code</li><li class="l-opencode">OpenCode</li><li class="l-goose">Goose</li>
      </ul>
    </div>
    <div class="shot-hero">
      <div class="window">${picture(ctx, "hero", c.hero.alt, heroSizes, { eager: true })}</div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="diff-title">
  <div class="wrap">
    <div class="section-head"><h2 id="diff-title">${esc(c.diff.title)}</h2></div>
    <div class="diffs">
${c.diff.items
  .map((d) => {
    const bare = d.img === "collab-mobile";
    return `      <article class="diff">
        <div class="diff-text"><h3>${esc(d.title)}</h3>${d.body.map((p) => `<p>${p}</p>`).join("")}</div>
        <div class="diff-art${bare ? " bare" : ""}">${bare ? picture(ctx, d.img, d.alt, "(max-width: 980px) 100vw, 680px") : `<div class="window">${picture(ctx, d.img, d.alt, "(max-width: 980px) 100vw, 680px")}</div>`}</div>
      </article>`;
  })
  .join("\n")}
    </div>
  </div>
</section>

<section class="section" aria-labelledby="why-title">
  <div class="wrap why">
    <div class="why-text"><h2 id="why-title">${esc(c.why.title)}</h2>${c.why.body.map((p) => `<p>${p}</p>`).join("")}</div>
    <figure>
      <div class="window"><video controls muted playsinline preload="none" width="${ctx.video.width}" height="${ctx.video.height}" poster="${ctx.video.poster}" aria-describedby="video-caption"><source src="${ctx.video.src}" type="video/mp4"></video></div>
      <figcaption id="video-caption">${esc(c.why.video)}</figcaption>
    </figure>
  </div>
</section>

<section class="section" id="features" aria-labelledby="features-title">
  <div class="wrap">
    <div class="section-head"><h2 id="features-title">${esc(c.features.title)}</h2></div>
    <div class="shots">
${shots
  .map((s) => {
    const tall = s.img === "mcp" || s.img === "menubar";
    return `      <figure class="shot${tall ? " tall" : ""}"><div class="window frame">${picture(ctx, s.img, s.alt, tall ? "(max-width: 640px) 100vw, 400px" : "(max-width: 640px) 100vw, 780px")}</div><figcaption><strong>${esc(s.title)}</strong>${esc(s.caption)}</figcaption></figure>`;
  })
  .join("\n")}
    </div>
    <dl class="feature-list">
${c.features.list.map((f) => `      <div><dt>${esc(f.title)}</dt><dd>${f.body}</dd></div>`).join("\n")}
    </dl>
  </div>
</section>

<section class="section" id="agents" aria-labelledby="agents-title">
  <div class="wrap">
    <div class="section-head"><h2 id="agents-title">${esc(c.agents.title)}</h2><p>${esc(c.agents.intro)}</p></div>
    <div class="table-scroll" role="region" aria-labelledby="agents-caption" tabindex="0">
      <table class="agents-table">
        <caption id="agents-caption" class="sr-only">${esc(c.agents.tableLabel)}</caption>
        <thead><tr>${c.agents.cols.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>
${c.agents.rows
  .map(
    (r) =>
      `          <tr><th scope="row">${esc(r.name)}</th><td><span class="via">${esc(r.via)}</span></td>${r.cells.map(([m, n]) => `<td>${mark(c, m, n)}</td>`).join("")}</tr>`,
  )
  .join("\n")}
        </tbody>
      </table>
    </div>
    <p class="legend">${(["y", "p", "u", "n"] as Mark[]).map((m) => `<span class="mark m-${m}"><i aria-hidden="true">${MARK_GLYPH[m]}</i>${esc(c.agents.marks[m])}</span>`).join("")}</p>
    <p class="footnote">${esc(c.agents.legend)} ${esc(c.agents.footnote)}</p>
    <a class="more" href="${docs(c, c.agents.moreHref)}" ${ext}>${esc(c.agents.more)}</a>
  </div>
</section>

<section class="section" id="phone" aria-labelledby="phone-title">
  <div class="wrap phone">
    <div class="phone-text">
      <h2 id="phone-title">${esc(c.phone.title)}</h2>
      ${c.phone.body.map((p) => `<p>${esc(p)}</p>`).join("")}
      <p class="note">${esc(c.phone.note)}</p>
    </div>
    <div class="phone-art">
      ${picture(ctx, "mobile", c.phone.ios, "(max-width: 640px) 100vw, (max-width: 1260px) 50vw, 570px")}
      ${picture(ctx, "mobile-android", c.phone.android, "(max-width: 640px) 100vw, (max-width: 1260px) 50vw, 570px")}
    </div>
  </div>
</section>

<section class="section" id="start" aria-labelledby="start-title">
  <div class="wrap">
    <div class="section-head"><h2 id="start-title">${esc(c.start.title)}</h2></div>
    <ol class="steps">
${c.start.steps.map((s) => `      <li>${s}</li>`).join("\n")}
    </ol>
    <a class="more" href="${docs(c, c.start.moreHref)}" ${ext}>${esc(c.start.more)}</a>
  </div>
</section>

<section class="section" id="performance" aria-labelledby="perf-title">
  <div class="wrap perf">
    <div class="perf-text">
      <h2 id="perf-title">${esc(c.perf.title)}</h2>
      <p>${esc(c.perf.intro)}</p>
      <p class="server">${esc(c.perf.server)}</p>
      <a class="more" href="${docs(c, c.perf.moreHref)}" ${ext}>${esc(c.perf.more)}</a>
    </div>
    <div>
      <div class="table-scroll" role="region" aria-labelledby="perf-caption" tabindex="0">
        <table>
          <caption id="perf-caption">${esc(c.perf.caption)}</caption>
          <thead><tr>${c.perf.cols.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
          <tbody>
${c.perf.rows.map(([m, b, n]) => `            <tr><th scope="row">${esc(m)}</th><td class="before">${esc(b)}</td><td class="now">${esc(n)}</td></tr>`).join("\n")}
          </tbody>
        </table>
      </div>
      <p class="footnote note">${esc(c.perf.note)}</p>
    </div>
  </div>
</section>

<section class="section" id="security" aria-labelledby="sec-title">
  <div class="wrap sec">
    <div>
      <h2 id="sec-title">${esc(c.security.title)}</h2>
      <div class="sec-links">
        <a class="btn btn-sm" href="${docs(c, c.security.threatHref)}" ${ext}>${esc(c.security.threat)}</a>
        <a class="btn btn-sm" href="${config.repo}/blob/main/SECURITY.md" ${ext}>${esc(c.security.report)}</a>
        <a class="btn btn-sm" href="${config.repo}/blob/main/LICENSE" ${ext}>${esc(c.security.license)}</a>
      </div>
    </div>
    <ul>
${c.security.items.map((i) => `      <li>${esc(i)}</li>`).join("\n")}
    </ul>
  </div>
</section>

<section class="section" id="cloud" aria-labelledby="cloud-title">
  <div class="wrap">
    <div class="cloud">
      <div class="cloud-text">
        <span class="badge">${esc(c.cloud.badge)}</span>
        <h2 id="cloud-title">${esc(c.cloud.title)}</h2>
        <p>${esc(c.cloud.body)}</p>
        <ul>${c.cloud.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      </div>
      <form class="wl" method="post" action="/api/waitlist" data-sending="${attr(c.cloud.sending)}" aria-labelledby="wl-title">
        <h3 id="wl-title">${esc(c.cloud.formTitle)}</h3>
        <p class="wl-msg ok" id="waitlist-ok" tabindex="-1" role="status">${esc(c.cloud.ok)}</p>
        <p class="wl-msg err" id="waitlist-invalid" tabindex="-1" role="alert">${esc(c.cloud.invalid)}</p>
        <p class="wl-msg err" id="waitlist-limited" tabindex="-1" role="alert">${esc(c.cloud.limited)}</p>
        <p class="wl-msg err" id="waitlist-failed" tabindex="-1" role="alert">${esc(c.cloud.failed)}</p>
        <div class="field">
          <label for="wl-email">${esc(c.cloud.email)}</label>
          <input id="wl-email" name="email" type="email" required maxlength="254" autocomplete="email" inputmode="email" placeholder="${attr(c.cloud.emailPh)}">
        </div>
        <fieldset>
          <legend>${esc(c.cloud.use)}</legend>
          <div class="choice">
            <label><input type="radio" name="use" value="solo" checked>${esc(c.cloud.solo)}</label>
            <label><input type="radio" name="use" value="team">${esc(c.cloud.team)}</label>
          </div>
        </fieldset>
        <div class="hp" aria-hidden="true"><label for="wl-company">${esc(c.cloud.honeypot)}</label><input id="wl-company" name="company" type="text" tabindex="-1" autocomplete="off"></div>
        <input type="hidden" name="lang" value="${c.lang}">
        <button class="btn btn-primary" type="submit">${esc(c.cloud.submit)}</button>
        <small>${esc(c.cloud.privacy)}</small>
      </form>
    </div>
  </div>
</section>

<section class="section" id="contribute" aria-labelledby="contrib-title">
  <div class="wrap contrib">
    <div>
      <h2 id="contrib-title">${esc(c.contribute.title)}</h2>
      <p class="muted">${esc(c.contribute.intro)}</p>
    </div>
    <div>
      <ul class="ways">
${c.contribute.items.map((w) => `        <li><h3>${esc(w.title)}</h3><p>${esc(w.body)}</p><a href="${repo(w.href)}" ${ext}>${esc(w.cta)}</a></li>`).join("\n")}
      </ul>
${
  hasSupport
    ? `      <div class="support" id="support">
        <h3>${esc(c.support.title)}</h3>
        <p>${esc(c.support.body)}</p>
${donations.length ? `        <div class="donate">${donations.map((d) => `<a class="btn btn-sm" data-donation="${d.id}" href="${attr(d.url)}" ${ext}>${esc(c.support.labels[d.id])}</a>`).join("")}</div>` : ""}
${
  pix
    ? `        <div class="pix">${pix.qrImage ? `<img src="${attr(pix.qrImage)}" width="120" height="120" alt="${attr(c.support.pixQr)}" loading="lazy">` : ""}<div><h4>${esc(c.support.pixTitle)}</h4><dl><dt>${esc(c.support.pixKey)}</dt><dd>${esc(pix.key)}</dd>${isSet(pix.receiver) ? `<dt>${esc(c.support.pixTo)}</dt><dd>${esc(pix.receiver)}</dd>` : ""}</dl><button class="btn btn-sm" type="button" data-copy="${attr(pix.key)}" data-copied="${attr(c.support.pixCopied)}" hidden>${esc(c.support.pixCopy)}</button></div></div>`
    : ""
}
        <p class="star-note">${esc(c.support.star)} <a href="${config.repo}" ${ext}>${esc(c.hero.star)}</a></p>
      </div>`
    : ""
}
    </div>
  </div>
</section>

<section class="section" id="faq" aria-labelledby="faq-title">
  <div class="wrap faq">
    <div><h2 id="faq-title">${esc(c.faq.title)}</h2><a class="more" href="${docs(c, c.faq.moreHref)}" ${ext}>${esc(c.faq.more)}</a></div>
    <div>
${c.faq.items.map((i) => `      <details><summary>${esc(i.q)}</summary><p>${i.a}</p></details>`).join("\n")}
    </div>
  </div>
</section>
</main>

<footer class="foot">
  <div class="wrap foot-in">
    <div>
      <a class="brand" href="${c.path}"><img src="${ctx.icons.svg}" width="24" height="24" alt=""><span>Kabul</span></a>
      <p>${esc(c.footer.tagline)}</p>
    </div>
    <nav aria-label="${lang === "en" ? "Footer" : "Rodapé"}">
      <ul>
        <li><a href="${config.docs[lang]}" ${ext}>${esc(c.footer.docs)}</a></li>
        <li><a href="${config.repo}" ${ext}>${esc(c.footer.github)}</a></li>
        <li><a href="${config.repo}/blob/main/CHANGELOG.md" ${ext}>${esc(c.footer.changelog)}</a></li>
        <li><a href="${config.repo}/blob/main/SECURITY.md" ${ext}>${esc(c.footer.security)}</a></li>
        <li><a href="${config.repo}/blob/main/LICENSE" ${ext}>${esc(c.footer.license)}</a></li>
        <li><a href="${config.repo}/blob/main/ACKNOWLEDGMENTS.md" ${ext}>${esc(c.footer.credits)}</a></li>
      </ul>
    </nav>
    <p class="meta"><span>${esc(c.footer.version)} ${esc(ctx.version)}</span><span>MIT</span><a href="${o.path}" hreflang="${o.lang}" lang="${o.lang}">${esc(c.nav.langOther)}</a></p>
  </div>
</footer>
</body>
</html>
`;
}
