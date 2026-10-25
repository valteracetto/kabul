#!/usr/bin/env node
// npm run i18n:check [-- arquivos…]
//
// Falha (código 1) se encontrar:
//  1. chave faltando num idioma, chave fora do prefixo da área, plural sem "other" ou variáveis `{x}`
//     diferentes entre en e pt-BR (src/i18n/locales/<idioma>/<área>.json);
//  2. `t("chave")` / `tNode("chave")` / `<T k="chave">` com chave que não existe;
//  3. texto visível fixo no código: texto entre tags JSX, atributos visíveis (title, placeholder,
//     aria-label…), strings que viram filho de JSX (`{x ? "Sim" : "Não"}`), argumentos de onError/toast/
//     confirmDialog e propriedades visíveis (label, title, hint…) em objetos — mais qualquer string com cara
//     de português (acentos, "não", "para", "de"…) fora de comentário.
//
// Escape: `// i18n-ignore` na linha (ou na anterior) e `/* i18n-ignore-file */` no arquivo (dados de mentira,
// nomes técnicos). Marcas, produtos e termos técnicos que não se traduzem estão em ALLOW.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const LOCALES = join(SRC, "i18n", "locales");
const LANGS = ["en", "pt-BR"];

const problems = [];
const warn = [];
const report = (file, line, msg) => problems.push(`${file}:${line}: ${msg}`);

// ---------------------------------------------------------------- 1. dicionários
const dict = {};
for (const l of LANGS) dict[l] = {};
const nsFiles = readdirSync(join(LOCALES, "pt-BR")).filter((f) => f.endsWith(".json"));
const placeholders = (v) => new Set([...(typeof v === "string" ? [v] : Object.values(v)).join("\n").matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
for (const f of nsFiles) {
  const ns = f.replace(/\.json$/, "");
  const data = {};
  for (const l of LANGS) {
    const p = join(LOCALES, l, f);
    try {
      data[l] = JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      report(`src/i18n/locales/${l}/${f}`, 1, `JSON inválido ou ausente: ${e.message}`);
      data[l] = {};
    }
  }
  const all = new Set(LANGS.flatMap((l) => Object.keys(data[l])));
  for (const k of all) {
    if (!k.startsWith(ns + ".")) report(`src/i18n/locales/pt-BR/${f}`, 1, `chave "${k}" deveria começar com "${ns}."`);
    for (const l of LANGS) {
      const v = data[l][k];
      if (v === undefined) report(`src/i18n/locales/${l}/${f}`, 1, `chave faltando em ${l}: "${k}"`);
      else if (typeof v === "object") {
        if (typeof v.other !== "string") report(`src/i18n/locales/${l}/${f}`, 1, `plural sem "other": "${k}"`);
        if (typeof v.one !== "string") report(`src/i18n/locales/${l}/${f}`, 1, `plural sem "one": "${k}"`);
      } else if (typeof v !== "string") report(`src/i18n/locales/${l}/${f}`, 1, `valor deve ser texto ou plural: "${k}"`);
      else if (!v.trim()) report(`src/i18n/locales/${l}/${f}`, 1, `texto vazio: "${k}"`);
      if (v !== undefined) dict[l][k] = v;
    }
    if (data.en[k] !== undefined && data["pt-BR"][k] !== undefined) {
      const a = [...placeholders(data.en[k])].sort().join(","), b = [...placeholders(data["pt-BR"][k])].sort().join(",");
      if (a !== b) report(`src/i18n/locales/en/${f}`, 1, `variáveis diferentes em "${k}": en {${a}} × pt-BR {${b}}`);
    }
  }
  for (const l of readdirSync(LOCALES)) if (!LANGS.includes(l)) warn.push(`idioma desconhecido em locales/: ${l}`);
}
for (const l of LANGS) {
  for (const f of readdirSync(join(LOCALES, l))) if (f.endsWith(".json") && !nsFiles.includes(f)) report(`src/i18n/locales/${l}/${f}`, 1, "área sem o arquivo pt-BR correspondente");
  // locales/<idioma>/index.ts junta as áreas num dicionário só (o pedaço de JS de cada idioma).
  const idx = readFileSync(join(LOCALES, l, "index.ts"), "utf8");
  for (const f of nsFiles) if (!idx.includes(`"./${f}"`)) report(`src/i18n/locales/${l}/index.ts`, 1, `área ${f} não está no dicionário de ${l}`);
}
const KEYS = new Set(Object.keys(dict["pt-BR"]));

// Atalhos (registro único): pt e en preenchidos.
for (const s of JSON.parse(readFileSync(join(SRC, "i18n", "shortcuts.json"), "utf8"))) {
  if (!s.pt?.trim() || !s.en?.trim()) report("src/i18n/shortcuts.json", 1, `atalho ${s.id} sem texto em pt ou en`);
}

// ---------------------------------------------------------------- 2/3. código
// Palavras que não se traduzem (marcas, produtos, siglas, teclas). Texto feito só delas passa.
const ALLOW = new Set(
  `Kabul kabul kabuld Claude Code Codex Gemini Antigravity agy GitHub Git git gh MCP MCPs PR PRs URL URLs CLI API APIs OK
   Opus Sonnet Haiku GPT Linear Tailscale tmux iTerm Warp Ghostty Zed Cursor VS Finder Xcode Ollama LM Studio llama cpp MLX
   HTTPS HTTP SSH JSON CSV YAML TOML Markdown Mermaid KaTeX macOS Windows Linux iPhone iPad Android PWA QR ID CPU RAM GPU GB MB KB
   TB ms Esc Tab Shift Cmd Ctrl Alt Option Enter Return Space Backspace Delete Home End PgUp PgDn CodexBar OpenAI Anthropic Google
   Kimi Grok DeepSeek Qwen OpenRouter Copilot Vercel Docker npm pnpm yarn bun cargo node Node Rust TypeScript Python Bun Deno
   README CLAUDE AGENTS env PATH HEAD main origin diff stdio sse ws wss localhost Wi Fi WebSocket UTF LF CRLF Tauri WebKit
   Chromium Safari Chrome Slack Discord Gmail Notion Figma Sentry Jira AWS Fly Render Railway Netlify Supabase Postgres SQLite
   Redis tokens token caffeinate OpenCode Terminal Hermes Pi Amp Crush Goose Aider Cline Roo Continue Warp Glass Ping Pop Hero Submarine Tink Basso Blow Bottle Frog Funk Morse Purr Sosumi`.split(/\s+/),
);
const PT_ACCENT = /[áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÇ]/;
const PT_WORD = /(^|[^\p{L}.\-])(não|você|vocês|para|pela|pelo|pelos|nenhum|nenhuma|está|estão|também|então|sem|com|uma|ou|ao|aos|seu|sua|seus|suas|isso|este|esta|esse|essa|aqui|agora|depois|antes|abrir|fechar|salvar|apagar|excluir|cancelar|voltar|enviar|copiar|erro|falha|arquivo|arquivos|pasta|conversa|conversas|configurações|dele|dela|nada|tudo|ainda|já)([^\p{L}.\-]|$)/iu; // hífen e ponto: "hl-com", "login.tailscale.com" não são português
const PT_STOP = /\s(de|do|da|dos|das|em|no|na|nos|nas|um|que|se|por|mais)\s/i;
const looksPt = (s) => PT_ACCENT.test(s) || PT_WORD.test(s) || (/\s/.test(s.trim()) && PT_STOP.test(` ${s} `));

/** Tem palavra que um usuário leria e que não está na lista de exceções? */
function visibleWords(s) {
  const words = s.match(/\p{L}[\p{L}'’]*/gu) ?? [];
  return words.some((w) => w.length >= 2 && !ALLOW.has(w) && !ALLOW.has(w.replace(/['’]s$/, "")));
}
const codeLike = (s) =>
  /^[\w.-]*[/\\][\w./\\*-]*$/.test(s) || // caminhos
  /^(--?[\w-]+|[\w-]+\.[a-z]{1,5}|https?:\/\/\S*|[a-z]+:\/\/\S*|#[0-9a-f]{3,8}|[a-z]+(-[a-z0-9]+)+|[a-z][a-zA-Z0-9]*\(.*\))$/.test(s.trim()) ||
  /^[A-Z_][A-Z0-9_]+$/.test(s.trim());

const VISIBLE_ATTRS = new Set(["title", "placeholder", "aria-label", "aria-description", "alt", "label", "hint", "tooltip", "heading", "desc", "description", "text", "ok", "cancel", "confirm", "message", "emptyText", "empty", "caption", "subtitle", "prompt", "legend", "sub", "detail", "note", "lead", "what", "action", "children"]);
const VISIBLE_PROPS = new Set(["title", "label", "hint", "text", "placeholder", "ok", "cancel", "message", "body", "desc", "description", "heading", "tooltip", "empty", "caption", "subtitle", "detail", "note", "confirmLabel", "okLabel", "cancelLabel", "group", "summary", "help", "lead", "what"]);
const UI_CALLS = new Set(["onError", "setError", "setErr", "toast", "showToast", "flash", "notify", "confirmDialog", "alert", "confirm", "prompt", "setMsg", "setStatus", "setNote", "setHint", "setInfo", "setNotice", "setToast", "say", "fail", "setFail", "setProblem", "setWarn", "setWarning", "setLabel", "setTitle", "promptDialog", "ask", "report"]);
const NO_TEXT_TAGS = new Set(["code", "kbd", "pre", "samp", "svg", "path", "style", "script"]);

function walkDir(d, out = []) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) {
      if (p !== join(SRC, "i18n")) walkDir(p, out);
    } else if (/\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-")).map((a) => resolve(process.cwd(), a));
const files = only.length ? only.filter((p) => !p.startsWith(join(SRC, "i18n"))) : walkDir(SRC);
const usedKeys = new Set();
const usedPrefixes = [];
let scanned = 0;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);
  if (/i18n-ignore-file/.test(text)) continue;
  scanned++;
  const lines = text.split("\n");
  const ignored = (line) => /i18n-ignore(?!-file)/.test(lines[line - 1] ?? "") || /i18n-ignore(?!-file)/.test(lines[line - 2] ?? "");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const flag = (n, why, s) => {
    const line = lineOf(n);
    if (!ignored(line)) report(rel, line, `${why}: ${JSON.stringify(s.length > 70 ? s.slice(0, 67) + "…" : s)}`);
  };
  const strOf = (n) =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : ts.isTemplateExpression(n) ? [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" ") : null;

  /** Literais que aparecem na tela quando a expressão é renderizada (ramos de ?:, &&, ||, ??, +, template). */
  function visibleLiterals(e, out = []) {
    if (!e) return out;
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression?.(e)) return visibleLiterals(e.expression, out);
    if (ts.isConditionalExpression(e)) return visibleLiterals(e.whenTrue, out), visibleLiterals(e.whenFalse, out);
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return visibleLiterals(e.right, out);
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.PlusToken) return visibleLiterals(e.left, out), visibleLiterals(e.right, out);
      return out;
    }
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e)) out.push(e);
    if (ts.isTemplateExpression(e)) for (const s of e.templateSpans) visibleLiterals(s.expression, out);
    if (ts.isArrayLiteralExpression(e)) for (const x of e.elements) visibleLiterals(x, out);
    return out;
  }
  const checkVisible = (expr, why) => {
    for (const lit of visibleLiterals(expr)) {
      const s = strOf(lit);
      if (s && visibleWords(s) && !codeLike(s)) flag(lit, why, s);
    }
  };
  const tagName = (el) => (ts.isJsxElement(el) ? el.openingElement.tagName.getText(sf) : ts.isJsxSelfClosingElement(el) ? el.tagName.getText(sf) : "");
  const insideNoText = (n) => {
    for (let p = n.parent; p; p = p.parent) if ((ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p)) && NO_TEXT_TAGS.has(tagName(p))) return true;
    return false;
  };
  const flagged = new Set();
  const insideFunction = (n) => {
    for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p) || ts.isPropertyDeclaration(p) || ts.isClassStaticBlockDeclaration?.(p)) return true;
    return false;
  };

  function visit(n) {
    // --- chaves usadas
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      const name = callee.split(".").pop();
      // O dicionário chega depois da carga dos módulos (loadMessages em main.tsx): t() só dentro de funções.
      if ((callee === "t" || callee === "tNode") && !insideFunction(n)) flag(n, "t() na carga do módulo (use dentro de função ou getter)", n.getText(sf));
      if ((name === "t" || name === "tNode" || name === "has" || name === "msg") && n.arguments[0]) {
        const a = n.arguments[0];
        if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) {
          usedKeys.add(a.text);
          if ((name === "t" || name === "tNode") && !KEYS.has(a.text)) flag(a, "chave inexistente", a.text);
        } else if (ts.isTemplateExpression(a)) {
          usedPrefixes.push(a.head.text);
          if (![...KEYS].some((k) => k.startsWith(a.head.text))) flag(a, "nenhuma chave com o prefixo", a.head.text);
        }
      }
      if (UI_CALLS.has(name)) for (const a of n.arguments) {
        checkVisible(a, `texto fixo em ${name}()`);
        if (ts.isObjectLiteralExpression(a)) for (const p of a.properties) if (ts.isPropertyAssignment(p)) checkVisible(p.initializer, `texto fixo em ${name}()`);
      }
    }
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === "T") {
      for (const a of n.attributes.properties) if (ts.isJsxAttribute(a) && a.name.getText(sf) === "k" && a.initializer && ts.isStringLiteral(a.initializer)) {
        usedKeys.add(a.initializer.text);
        if (!KEYS.has(a.initializer.text)) flag(a.initializer, "chave inexistente", a.initializer.text);
      }
    }
    // --- texto entre tags
    if (ts.isJsxText(n)) {
      const s = n.getText(sf).replace(/\s+/g, " ").trim();
      if (s && visibleWords(s) && !insideNoText(n)) flag(n, "texto fixo em JSX", s);
    }
    // --- {expr} como filho de JSX
    if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent)) && !insideNoText(n)) checkVisible(n.expression, "texto fixo em JSX");
    // --- atributos visíveis
    if (ts.isJsxAttribute(n) && VISIBLE_ATTRS.has(n.name.getText(sf)) && n.initializer) {
      const init = n.initializer;
      if (ts.isStringLiteral(init)) {
        if (visibleWords(init.text) && !codeLike(init.text)) flag(init, `atributo ${n.name.getText(sf)} fixo`, init.text);
      } else if (ts.isJsxExpression(init) && init.expression) checkVisible(init.expression, `atributo ${n.name.getText(sf)} fixo`);
    }
    // --- propriedades visíveis em objetos
    if (ts.isPropertyAssignment(n) && VISIBLE_PROPS.has(n.name.getText(sf).replace(/["']/g, ""))) checkVisible(n.initializer, `propriedade ${n.name.getText(sf)} fixa`);
    // --- qualquer string com cara de português
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) && !ts.isImportDeclaration(n.parent) && !ts.isExportDeclaration(n.parent)) {
      const s = strOf(n);
      const isKey = ts.isPropertyAssignment(n.parent) && n.parent.name === n;
      if (s && !isKey && looksPt(s) && visibleWords(s)) flag(n, "texto em português fora do i18n", s);
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
  void flagged;
}

// Duplicatas por linha (mesmo literal visto por duas regras): uma vez basta.
const uniq = [...new Map(problems.map((p) => [p.replace(/: [^:]*$/, "") + p.slice(p.lastIndexOf(": ")), p])).values()];
const seen = new Set();
const out = uniq.filter((p) => {
  const [loc] = p.split(": ");
  const lit = p.slice(p.lastIndexOf(": ") + 2);
  const id = loc + lit;
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
});

if (!only.length) {
  const unused = [...KEYS].filter((k) => !usedKeys.has(k) && !usedPrefixes.some((p) => k.startsWith(p)));
  if (unused.length && process.argv.includes("--unused")) for (const k of unused) console.log(`aviso: chave sem uso: ${k}`);
}
for (const w of warn) console.log(`aviso: ${w}`);
for (const p of out) console.log(p);
console.log(`\ni18n:check: ${KEYS.size} chaves × ${LANGS.length} idiomas, ${scanned} arquivos: ${out.length ? `${out.length} problema(s)` : "ok"}`);
process.exit(out.length ? 1 : 0);
