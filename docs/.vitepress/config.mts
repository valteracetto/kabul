import { defineConfig } from "vitepress";

// Documentação pública do Kabul: inglês na raiz, português do Brasil em /pt-BR/ (seletor de idioma no topo).
const en = [
  { text: "Quick start", link: "/guide/quick-start" },
  { text: "Installation", link: "/guide/installation" },
  { text: "Concepts", link: "/guide/concepts" },
  { text: "Agents and harnesses", link: "/guide/agents" },
  { text: "Switching model or account", link: "/guide/switching" },
  { text: "Cloud and mobile", link: "/guide/cloud-and-mobile" },
  { text: "Scripts and .kabul/settings.toml", link: "/guide/scripts" },
  { text: "KABUL_* variables", link: "/guide/environment" },
  { text: "Git and pull requests", link: "/guide/git" },
  { text: "Keyboard shortcuts", link: "/guide/shortcuts" },
  { text: "MCP", link: "/guide/mcp" },
  { text: "Integrations", link: "/guide/integrations" },
  { text: "Dictation", link: "/guide/dictation" },
  { text: "Themes", link: "/guide/themes" },
  { text: "FAQ", link: "/guide/faq" },
  { text: "Contributing", link: "/guide/contributing" },
];
const pt = [
  { text: "Início rápido", link: "/pt-BR/guia/inicio-rapido" },
  { text: "Instalação", link: "/pt-BR/guia/instalacao" },
  { text: "Conceitos", link: "/pt-BR/guia/conceitos" },
  { text: "Agentes e harnesses", link: "/pt-BR/guia/agentes" },
  { text: "Trocar de modelo ou conta", link: "/pt-BR/guia/trocar" },
  { text: "Nuvem e celular", link: "/pt-BR/guia/nuvem-e-celular" },
  { text: "Scripts e .kabul/settings.toml", link: "/pt-BR/guia/scripts" },
  { text: "Variáveis KABUL_*", link: "/pt-BR/guia/ambiente" },
  { text: "Git e pull requests", link: "/pt-BR/guia/git" },
  { text: "Atalhos de teclado", link: "/pt-BR/guia/atalhos" },
  { text: "MCP", link: "/pt-BR/guia/mcp" },
  { text: "Integrações", link: "/pt-BR/guia/integracoes" },
  { text: "Ditado", link: "/pt-BR/guia/ditado" },
  { text: "Temas", link: "/pt-BR/guia/temas" },
  { text: "Perguntas frequentes", link: "/pt-BR/guia/faq" },
  { text: "Como contribuir", link: "/pt-BR/guia/contribuir" },
];

export default defineConfig({
  title: "Kabul",
  description: "Parallel coding agents, each in its own git worktree.",
  srcExclude: ["internal/**", "handoff.md", "windows.md"],
  locales: {
    root: { label: "English", lang: "en", themeConfig: { nav: [{ text: "Guide", link: "/guide/quick-start" }], sidebar: [{ text: "Guide", items: en }] } },
    "pt-BR": { label: "Português (Brasil)", lang: "pt-BR", link: "/pt-BR/", themeConfig: { nav: [{ text: "Guia", link: "/pt-BR/guia/inicio-rapido" }], sidebar: [{ text: "Guia", items: pt }] } },
  },
  themeConfig: { search: { provider: "local" } },
});
