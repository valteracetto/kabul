// Plain-text and Markdown versions of the landing page for LLMs and AI search (https://llmstxt.org):
//   /llms.txt          index: H1, summary in a blockquote, sections of links to Markdown files
//   /llms-full.txt     everything in one English Markdown file (with a pointer to the Portuguese version)
//   /index.md          the English page as Markdown
//   /pt-BR/index.md    the Portuguese page as Markdown
// Everything comes from content.ts and config.ts, so the text never drifts from the HTML page.
import { config, isSet } from "./config.ts";
import { content, type Content, type Lang, type Mark } from "./content.ts";

const RAW = config.repo.replace("https://github.com/", "https://raw.githubusercontent.com/") + "/main";

/** Inline HTML from content.ts to Markdown. */
function md(s: string): string {
  return s
    .replace(/<code>(.*?)<\/code>/g, "`$1`")
    .replace(/<kbd>(.*?)<\/kbd>/g, "`$1`")
    .replace(/<strong>(.*?)<\/strong>/g, "**$1**")
    .replace(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/g, "[$2]($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

const docsUrl = (path: string) => `${config.docs.en}${path}`;
const MARK_TEXT: Record<Mark, string> = { y: "yes", p: "partial", u: "?", n: "no" };

/** Docs pages, English and Portuguese, with a one-line description (English). */
const DOCS: { en: string; pt: string; title: string; ptTitle: string; desc: string }[] = [
  { en: "quick-start", pt: "inicio-rapido", title: "Quick start", ptTitle: "Início rápido", desc: "install Kabul, sign in to an agent and run the first task" },
  { en: "installation", pt: "instalacao", title: "Installation", ptTitle: "Instalação", desc: "requirements, the .dmg, the agent CLIs and building from source" },
  { en: "windows", pt: "windows", title: "Windows (beta)", ptTitle: "Windows (beta)", desc: "what works on Windows 10 and 11 and what doesn't yet" },
  { en: "concepts", pt: "conceitos", title: "Concepts", ptTitle: "Conceitos", desc: "repositories, workspaces (git worktrees), chats, harnesses and checkpoints" },
  { en: "agents", pt: "agentes", title: "Agents and harnesses", ptTitle: "Agentes e harnesses", desc: "every supported agent CLI, how Kabul talks to it and what it supports" },
  { en: "local-models", pt: "modelos-locais", title: "Local models", ptTitle: "Modelos locais", desc: "LM Studio, Ollama, llama.cpp, vLLM and MLX, and how each model family is routed" },
  { en: "switching", pt: "trocar", title: "Switching model or account", ptTitle: "Trocar de modelo ou conta", desc: "the handoff that keeps the conversation when the model, provider or account changes" },
  { en: "mcp", pt: "mcp", title: "MCP", ptTitle: "MCP", desc: "one registry for the MCP servers of every CLI, on or off per session" },
  { en: "usage", pt: "uso", title: "Usage, costs and limits", ptTitle: "Uso, custos e limites", desc: "tokens and cost per workspace, model and account; limit windows and alerts" },
  { en: "cloud-and-mobile", pt: "nuvem-e-celular", title: "Cloud and mobile", ptTitle: "Nuvem e celular", desc: "the phone app (PWA) over Tailscale, pairing and notifications" },
  { en: "collaboration", pt: "colaboracao", title: "Collaboration", ptTitle: "Colaboração", desc: "inviting someone into a workspace as editor or observer" },
  { en: "git", pt: "git", title: "Git and pull requests", ptTitle: "Git e pull requests", desc: "diff, review comments, commit, push, PR checks and merge" },
  { en: "scripts", pt: "scripts", title: "Scripts and settings", ptTitle: "Scripts e configurações", desc: "setup, run and archive scripts, ports and per-repository settings" },
  { en: "environment", pt: "ambiente", title: "KABUL_* variables", ptTitle: "Variáveis KABUL_*", desc: "environment variables available to scripts and terminals" },
  { en: "integrations", pt: "integracoes", title: "Integrations", ptTitle: "Integrações", desc: "Linear, GitHub accounts and routines" },
  { en: "shortcuts", pt: "atalhos", title: "Keyboard shortcuts", ptTitle: "Atalhos de teclado", desc: "every shortcut in the desktop app" },
  { en: "dictation", pt: "ditado", title: "Dictation", ptTitle: "Ditado", desc: "talking to the agent instead of typing" },
  { en: "themes", pt: "temas", title: "Themes", ptTitle: "Temas", desc: "dark and light themes" },
  { en: "performance", pt: "desempenho", title: "Performance and scale", ptTitle: "Desempenho e escala", desc: "how Kabul handles 100 workspaces and 30 agents, with the measured budgets" },
  { en: "security", pt: "seguranca", title: "Security", ptTitle: "Segurança", desc: "threat model: local-first, the phone server, guests and secrets" },
  { en: "faq", pt: "faq", title: "FAQ", ptTitle: "Perguntas frequentes", desc: "common questions" },
  { en: "contributing", pt: "contribuir", title: "Contributing", ptTitle: "Como contribuir", desc: "how to build, test and send a pull request" },
];

/** The landing page as Markdown (same sections and order as the HTML). */
export function pageMarkdown(lang: Lang, siteUrl: string, version: string): string {
  const c: Content = content[lang];
  const pt = lang === "pt-BR";
  const docsHome = config.docs[lang];
  const docLink = (href: string) => docsUrl(href);
  const out: string[] = [];
  const p = (...lines: string[]) => out.push(...lines, "");

  p(`# Kabul`, `> ${c.meta.description}`);
  p(
    pt
      ? `Página: ${siteUrl}${c.path} · English: ${siteUrl}/index.md · Documentação: ${docsHome} · Código: ${config.repo}`
      : `Page: ${siteUrl}${c.path} · Português: ${siteUrl}/pt-BR/index.md · Docs: ${docsHome} · Source: ${config.repo}`,
  );
  p(`## ${c.hero.title}`, c.hero.lede);
  p(
    `- ${pt ? "Baixar para macOS" : "Download for macOS"}: ${config.download.mac}`,
    `- ${c.hero.windows}: ${config.download.windows}`,
    `- GitHub: ${config.repo}`,
    `- ${c.hero.fine}`,
    `- ${c.hero.lanesLabel}: Claude Code, Codex, Antigravity, Gemini CLI, Qwen Code, OpenCode, Goose.`,
  );

  p(`## ${c.diff.title}`);
  for (const d of c.diff.items) p(`### ${d.title}`, ...d.body.map(md));

  p(`## ${c.why.title}`, ...c.why.body.map(md));

  p(`## ${c.features.title}`);
  p(...c.features.shots.map((s) => `- **${s.title}**: ${s.caption}`));
  p(...c.features.list.map((f) => `- **${f.title}**: ${md(f.body)}`));

  p(`## ${c.agents.title}`, c.agents.intro);
  const note = (n?: string) => (n ? c.agents.notes[n] ?? n : "");
  const cell = ([m, n]: [Mark, string?]) => {
    const t = pt ? c.agents.marks[m].toLowerCase() : MARK_TEXT[m] === "?" ? "not confirmed yet" : MARK_TEXT[m];
    const extra = note(n);
    return extra && extra !== "¹" ? `${t} (${extra})` : extra === "¹" ? `${t} ¹` : t;
  };
  p(
    `| ${c.agents.cols.join(" | ")} |`,
    `| ${c.agents.cols.map(() => "---").join(" | ")} |`,
    ...c.agents.rows.map((r) => `| ${r.name} | ${r.via} | ${r.cells.map(cell).join(" | ")} |`),
  );
  p(`${c.agents.legend} ${c.agents.footnote}`, `${c.agents.more}: ${docLink(c.agents.moreHref)}`);

  p(`## ${c.phone.title}`, ...c.phone.body, c.phone.note);

  p(`## ${c.start.title}`, ...c.start.steps.map((s, i) => `${i + 1}. ${md(s)}`));
  p(`${c.start.more}: ${docLink(c.start.moreHref)}`);

  p(`## ${c.perf.title}`, c.perf.intro);
  p(`| ${c.perf.cols.join(" | ")} |`, `| --- | ---: | ---: |`, ...c.perf.rows.map((r) => `| ${r.join(" | ")} |`));
  p(`${c.perf.caption}. ${c.perf.note}`, c.perf.server, `${c.perf.more}: ${docLink(c.perf.moreHref)}`);

  p(`## ${c.security.title}`, ...c.security.items.map((i) => `- ${i}`));
  p(`${c.security.threat}: ${docLink(c.security.threatHref)} · ${c.security.report}: ${config.repo}/blob/main/SECURITY.md`);

  p(`## ${c.cloud.title} (${c.cloud.badge.toLowerCase()})`, c.cloud.body, ...c.cloud.points.map((x) => `- ${x}`));
  p(`${c.cloud.formTitle}: ${siteUrl}${c.path}#cloud`);

  p(`## ${c.contribute.title}`, c.contribute.intro);
  p(...c.contribute.items.map((w) => `- **${w.title}**: ${w.body} ${w.href.replace("{repo}", config.repo)}`));
  const sponsors = config.donations.filter((d) => isSet(d.url));
  if (sponsors.length) p(`### ${c.support.title}`, c.support.body, ...sponsors.map((d) => `- ${c.support.labels[d.id]}: ${d.url}`));

  p(`## ${c.faq.title}`);
  for (const i of c.faq.items) p(`### ${i.q}`, md(i.a));
  p(`${c.faq.more}: ${docLink(c.faq.moreHref)}`);

  p(`## ${c.footer.credits}`, `${c.footer.createdBy} · ${c.footer.builtWith}: ${config.repo}/blob/main/ACKNOWLEDGMENTS.md`);
  p(`${c.footer.version} ${version} · MIT · ${config.repo}/blob/main/LICENSE`);
  return tidy(out);
}

/** Blank line between blocks; list items and table rows stay together. */
function tidy(lines: string[]): string {
  const kind = (l: string) => (/^(- |\d+\. )/.test(l) ? "li" : l.startsWith("|") ? "tr" : "p");
  const res: string[] = [];
  for (const l of lines) {
    const prev = res[res.length - 1];
    if (l === "") {
      if (prev !== "" && res.length) res.push("");
      continue;
    }
    if (prev && prev !== "" && !(kind(prev) === kind(l) && kind(l) !== "p")) res.push("");
    res.push(l);
  }
  return res.join("\n").trimEnd() + "\n";
}

/** /llms.txt: the index (https://llmstxt.org). */
export function llmsTxt(siteUrl: string, version: string): string {
  const c = content.en;
  const docs = DOCS.map((d) => `- [${d.title}](${RAW}/docs/guide/${d.en}.md): ${d.desc}. Web: ${docsUrl(`guide/${d.en}`)}`);
  return `# Kabul

> ${c.meta.description} Kabul drives the real agent CLIs (Claude Code, Codex, Antigravity, Gemini CLI, Qwen Code, OpenCode, Goose), keeps one conversation across models and accounts, lets a friend join the session and puts every session on your phone. Local-first, no telemetry, MIT licensed. Current version: ${version}.

Kabul is a desktop app (macOS 14+, Apple Silicon and Intel; Windows 10/11 in beta) built with Rust, Tauri and React. Each task gets its own workspace: a git worktree on its own branch with its own ports, terminal and chats. You bring your own agent subscriptions or API keys; Kabul has no server of its own and never reads your tokens.

- Website: ${siteUrl}/ (English) and ${siteUrl}/pt-BR/ (Português)
- Documentation: ${config.docs.en} (English) and ${config.docs["pt-BR"]} (Português)
- Source code and releases: ${config.repo}

## Site

- [Kabul, the full page in English](${siteUrl}/index.md): what Kabul is, what it does differently, features, supported agents, phone app, quick start, performance, security, Kabul Cloud and FAQ
- [Kabul, a página completa em português](${siteUrl}/pt-BR/index.md): the same page in Portuguese (Brazil)
- [Everything in one file](${siteUrl}/llms-full.txt): the English page plus install steps, the agent support table and links to every docs page

## Docs

${docs.join("\n")}

## Project

- [README](${RAW}/README.md): overview, screenshots and install
- [README em português](${RAW}/README.pt-BR.md): the README in Portuguese
- [Changelog](${RAW}/CHANGELOG.md): what changed in each version
- [Security policy](${RAW}/SECURITY.md): how to report a vulnerability privately
- [Contributing](${RAW}/CONTRIBUTING.md): layout, commands, commits and CI
- [Acknowledgments](${RAW}/ACKNOWLEDGMENTS.md): created by Valter Acetto, built with Claude

## Optional

- [Documentação em português](${RAW}/docs/pt-BR/guia/inicio-rapido.md): start of the Portuguese guide; every English page has a Portuguese twin under docs/pt-BR/guia/
- [License (MIT)](${RAW}/LICENSE)
- [Sitemap](${siteUrl}/sitemap.xml)
`;
}

/** /llms-full.txt: the English page in full, plus the docs index in both languages. */
export function llmsFull(siteUrl: string, version: string): string {
  const page = pageMarkdown("en", siteUrl, version).replace(/^# Kabul\n/, "");
  const docs = DOCS.map((d) => `- ${d.title} (${d.desc}): ${docsUrl(`guide/${d.en}`)} · Markdown: ${RAW}/docs/guide/${d.en}.md · Português: ${config.docs["pt-BR"]}guia/${d.pt} (${d.ptTitle})`);
  return `# Kabul (full text for LLMs)
${page}
## Documentation index

English docs: ${config.docs.en} · Português: ${config.docs["pt-BR"]}

${docs.join("\n")}

## Other languages

This file is in English. The same page in Portuguese (Brazil) is at ${siteUrl}/pt-BR/index.md (HTML: ${siteUrl}/pt-BR/).
`;
}
