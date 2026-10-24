// Gera a tabela de atalhos da documentação a partir do registro único (src/i18n/shortcuts.json).
// Uso: npm run docs:shortcuts (dentro de apps/web).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const list = JSON.parse(readFileSync(join(here, "../src/i18n/shortcuts.json"), "utf8"));
const cats = {
  general: ["General", "Geral"], view: ["View", "Ver"], navigation: ["Navigation", "Navegação"], workspace: ["Workspace", "Workspace"],
  tabs: ["Tabs", "Abas"], chat: ["Chat", "Chat"], git: ["Git", "Git"], diff: ["Code review", "Revisão de código"], terminal: ["Terminal", "Terminal"],
};
const table = (lang) => Object.entries(cats).map(([c, names]) => {
  const rows = list.filter((x) => x.cat === c);
  if (!rows.length) return "";
  const head = lang === "en" ? "| Shortcut | Action |\n|---|---|" : "| Atalho | Ação |\n|---|---|";
  return `### ${names[lang === "en" ? 0 : 1]}\n\n${head}\n${rows.map((x) => `| \`${x.keys}\` | ${x[lang]} |`).join("\n")}\n`;
}).filter(Boolean).join("\n");
const root = join(here, "../../../docs");
for (const [file, lang] of [["guide/shortcuts.md", "en"], ["pt-BR/guia/atalhos.md", "pt"]]) {
  const p = join(root, file);
  const s = readFileSync(p, "utf8");
  const out = s.replace(/<!-- shortcuts:start -->[\s\S]*<!-- shortcuts:end -->/, `<!-- shortcuts:start -->\n<!-- Gerado por apps/web/scripts/gen-shortcuts-doc.mjs a partir de apps/web/src/i18n/shortcuts.json. Não edite à mão. -->\n\n${table(lang)}\n<!-- shortcuts:end -->`);
  writeFileSync(p, out);
  console.log(`atualizado: docs/${file} (${list.length} atalhos)`);
}
