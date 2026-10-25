import { defineConfig, type DefaultTheme } from "vitepress";

// Documentação pública do Kabul: inglês na raiz, português do Brasil em /pt-BR/ (seletor de idioma no topo).
// As páginas técnicas da raiz de docs/ (acp, handoff, celular, colaboracao, escala, security, windows) são
// referência de engenharia em português e aparecem nos dois idiomas, no fim da barra lateral.
//
// `DOCS_BASE` define o caminho base do site: "/" no domínio próprio ou "/<repo>/" no GitHub Pages
// (o workflow .github/workflows/docs.yml passa o nome do repositório).
const REPO = "https://github.com/valteracetto/kabul";
const base = process.env.DOCS_BASE || "/";

const reference = (title: string): DefaultTheme.SidebarItem => ({
  text: title,
  collapsed: true,
  items: [
    { text: "ACP (Agent Client Protocol)", link: "/acp" },
    { text: "Handoff / transcript", link: "/handoff" },
    { text: "Celular e kabuld", link: "/celular" },
    { text: "Colaboração", link: "/colaboracao" },
    { text: "Escala", link: "/escala" },
    { text: "Segurança (modelo de ameaças)", link: "/security" },
    { text: "Windows (porte)", link: "/windows" },
  ],
});

const en: DefaultTheme.SidebarItem[] = [
  {
    text: "Getting started",
    items: [
      { text: "Quick start", link: "/guide/quick-start" },
      { text: "Installation", link: "/guide/installation" },
      { text: "Windows (beta)", link: "/guide/windows" },
      { text: "Concepts", link: "/guide/concepts" },
    ],
  },
  {
    text: "Agents and models",
    items: [
      { text: "Agents and harnesses", link: "/guide/agents" },
      { text: "Local models", link: "/guide/local-models" },
      { text: "Switching model or account", link: "/guide/switching" },
      { text: "MCP", link: "/guide/mcp" },
      { text: "Usage, costs and limits", link: "/guide/usage" },
    ],
  },
  {
    text: "Anywhere, together",
    items: [
      { text: "Cloud and mobile", link: "/guide/cloud-and-mobile" },
      { text: "Collaboration", link: "/guide/collaboration" },
    ],
  },
  {
    text: "Daily work",
    items: [
      { text: "Git and pull requests", link: "/guide/git" },
      { text: "Scripts and settings", link: "/guide/scripts" },
      { text: "KABUL_* variables", link: "/guide/environment" },
      { text: "Integrations", link: "/guide/integrations" },
      { text: "Keyboard shortcuts", link: "/guide/shortcuts" },
      { text: "Dictation", link: "/guide/dictation" },
      { text: "Themes", link: "/guide/themes" },
    ],
  },
  {
    text: "Under the hood",
    items: [
      { text: "Performance and scale", link: "/guide/performance" },
      { text: "Security", link: "/guide/security" },
    ],
  },
  {
    text: "Help",
    items: [
      { text: "FAQ", link: "/guide/faq" },
      { text: "Contributing", link: "/guide/contributing" },
    ],
  },
  reference("Technical reference (Portuguese)"),
];

const pt: DefaultTheme.SidebarItem[] = [
  {
    text: "Primeiros passos",
    items: [
      { text: "Início rápido", link: "/pt-BR/guia/inicio-rapido" },
      { text: "Instalação", link: "/pt-BR/guia/instalacao" },
      { text: "Windows (beta)", link: "/pt-BR/guia/windows" },
      { text: "Conceitos", link: "/pt-BR/guia/conceitos" },
    ],
  },
  {
    text: "Agentes e modelos",
    items: [
      { text: "Agentes e harnesses", link: "/pt-BR/guia/agentes" },
      { text: "Modelos locais", link: "/pt-BR/guia/modelos-locais" },
      { text: "Trocar de modelo ou conta", link: "/pt-BR/guia/trocar" },
      { text: "MCP", link: "/pt-BR/guia/mcp" },
      { text: "Uso, custos e limites", link: "/pt-BR/guia/uso" },
    ],
  },
  {
    text: "De qualquer lugar, junto",
    items: [
      { text: "Nuvem e celular", link: "/pt-BR/guia/nuvem-e-celular" },
      { text: "Colaboração", link: "/pt-BR/guia/colaboracao" },
    ],
  },
  {
    text: "Dia a dia",
    items: [
      { text: "Git e pull requests", link: "/pt-BR/guia/git" },
      { text: "Scripts e configurações", link: "/pt-BR/guia/scripts" },
      { text: "Variáveis KABUL_*", link: "/pt-BR/guia/ambiente" },
      { text: "Integrações", link: "/pt-BR/guia/integracoes" },
      { text: "Atalhos de teclado", link: "/pt-BR/guia/atalhos" },
      { text: "Ditado", link: "/pt-BR/guia/ditado" },
      { text: "Temas", link: "/pt-BR/guia/temas" },
    ],
  },
  {
    text: "Por dentro",
    items: [
      { text: "Desempenho e escala", link: "/pt-BR/guia/desempenho" },
      { text: "Segurança", link: "/pt-BR/guia/seguranca" },
    ],
  },
  {
    text: "Ajuda",
    items: [
      { text: "Perguntas frequentes", link: "/pt-BR/guia/faq" },
      { text: "Como contribuir", link: "/pt-BR/guia/contribuir" },
    ],
  },
  reference("Referência técnica"),
];

export default defineConfig({
  base,
  title: "Kabul",
  description: "Every coding agent at its best, side by side: parallel workspaces on git worktrees, the right harness for every LLM, model switching mid-conversation, collaboration and your phone.",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["internal/**", "assets/**", "perf/**"],
  head: [["meta", { name: "theme-color", content: "#16161a" }]],
  locales: {
    root: {
      label: "English",
      lang: "en",
      themeConfig: {
        nav: [
          { text: "Guide", link: "/guide/quick-start" },
          { text: "Agents", link: "/guide/agents" },
          { text: "Releases", link: `${REPO}/releases` },
        ],
        sidebar: en,
        editLink: { pattern: `${REPO}/edit/main/docs/:path`, text: "Edit this page on GitHub" },
        footer: { message: "Released under the MIT License.", copyright: "Kabul contributors" },
      },
    },
    "pt-BR": {
      label: "Português (Brasil)",
      lang: "pt-BR",
      link: "/pt-BR/",
      description: "Cada agente de código no seu melhor, lado a lado: workspaces em paralelo com git worktree, o harness certo para cada LLM, troca de modelo na mesma conversa, colaboração e celular.",
      themeConfig: {
        nav: [
          { text: "Guia", link: "/pt-BR/guia/inicio-rapido" },
          { text: "Agentes", link: "/pt-BR/guia/agentes" },
          { text: "Versões", link: `${REPO}/releases` },
        ],
        sidebar: pt,
        editLink: { pattern: `${REPO}/edit/main/docs/:path`, text: "Editar esta página no GitHub" },
        footer: { message: "Publicado sob a licença MIT.", copyright: "Contribuidores do Kabul" },
        outline: { label: "Nesta página" },
        docFooter: { prev: "Anterior", next: "Próxima" },
        lastUpdated: { text: "Atualizado em" },
        returnToTopLabel: "Voltar ao topo",
        sidebarMenuLabel: "Menu",
        darkModeSwitchLabel: "Tema",
        langMenuLabel: "Idioma",
      },
    },
  },
  themeConfig: {
    socialLinks: [{ icon: "github", link: REPO }],
    search: {
      provider: "local",
      options: {
        locales: {
          "pt-BR": {
            translations: {
              button: { buttonText: "Buscar", buttonAriaLabel: "Buscar" },
              modal: {
                noResultsText: "Nada encontrado para",
                resetButtonTitle: "Limpar a busca",
                footer: { selectText: "abrir", navigateText: "navegar", closeText: "fechar" },
              },
            },
          },
        },
      },
    },
  },
});
