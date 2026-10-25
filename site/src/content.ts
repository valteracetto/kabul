// Page copy in English and Portuguese (Brazil). Source of truth: README.md, README.pt-BR.md, CHANGELOG.md
// and docs/ (performance numbers come from docs/guide/performance.md). Do not add features or numbers that
// are not in those files.
//
// Strings may contain inline HTML (<code>, <strong>, <a>); they are written by us, never by users.

export type Lang = "en" | "pt-BR";
/** y = confirmed, p = partial, u = not confirmed yet, n = not available */
export type Mark = "y" | "p" | "u" | "n";
export type Cell = [Mark, string?];
/** Short clips from the app's demo environment (site/media, recorded by apps/web `npm run demo:site-clips`). */
export type Clip = "switch" | "agents" | "phone";
export type RelayAgent = "claude" | "codex" | "gemini";
export type RelayLine =
  | { kind: "user"; text: string }
  | { kind: "agent"; agent: RelayAgent; who: string; text: string }
  | { kind: "switch"; agent: RelayAgent; text: string };
export type Img =
  | "hero"
  | "model-picker"
  | "switch-llm"
  | "collab-mobile"
  | "agents"
  | "usage"
  | "mcp"
  | "menubar"
  | "mobile"
  | "mobile-android";

const AGENT_ROWS: { name: string; via: string; cells: Cell[] }[] = [
  { name: "Claude Code", via: "stream-json", cells: [["y"], ["y"], ["y", "native"], ["y"], ["y"], ["y"], ["y", "Anthropic API"], ["y", "remote"]] },
  { name: "Codex", via: "app-server", cells: [["y"], ["y"], ["y", "native"], ["y"], ["y"], ["y"], ["y", "Responses API"], ["p"]] },
  { name: "Antigravity", via: "stream-json", cells: [["y"], ["y", "rules"], ["p", "restart"], ["p"], ["y"], ["y"], ["n"], ["y", "remote"]] },
  { name: "Gemini CLI", via: "ACP", cells: [["y"], ["y"], ["y", "native"], ["y"], ["y"], ["y", "¹"], ["p", "gemini"], ["p"]] },
  { name: "Qwen Code", via: "ACP", cells: [["y"], ["y"], ["y", "native"], ["y"], ["y"], ["y"], ["y", "OpenAI API"], ["p"]] },
  { name: "OpenCode", via: "ACP", cells: [["y"], ["y"], ["p", "emulated"], ["y"], ["y"], ["u"], ["y", "OpenAI / Anthropic"], ["p"]] },
  { name: "Goose", via: "ACP", cells: [["y"], ["y"], ["p", "emulated"], ["y"], ["y"], ["y"], ["y", "OpenAI API"], ["p"]] },
  { name: "Cursor", via: "ACP", cells: [["u"], ["u"], ["u"], ["u"], ["u"], ["u"], ["n"], ["u"]] },
];

const en = {
  lang: "en" as Lang,
  path: "/",
  ogLocale: "en_US",
  meta: {
    title: "Kabul: every coding agent at its best, side by side",
    description:
      "Free, open-source app for macOS. Run Claude Code, Codex, Gemini, Qwen and local models in parallel, each on its own git worktree, and switch models without losing the conversation.",
    ogAlt: "Kabul: parallel workspaces, chat with approvals and the diff side by side",
  },
  nav: {
    skip: "Skip to content",
    label: "Main",
    features: "Features",
    agents: "Agents",
    phone: "Phone",
    cloud: "Cloud",
    docs: "Docs",
    github: "GitHub",
    langLabel: "Language",
    langOther: "Português",
    langOtherShort: "PT",
  },
  hero: {
    title: "Every coding agent at its best, side by side.",
    lede:
      "Run Claude, GPT, Gemini, Qwen and local models in parallel, each in the harness made for it, each on its own git worktree. Switch models without losing the conversation. Bring a friend into the session. Keep going from your phone.",
    download: "Download for macOS",
    star: "Star on GitHub",
    windows: "Windows (beta)",
    fine: "Free and open source, MIT license. macOS 14 or later, Apple Silicon and Intel.",
    lanesLabel: "Drives the real agent CLIs",
    alt: "Kabul: parallel workspaces in the sidebar, a diff with a review comment and the agent chat asking to apply an edit",
    videoLabel: "Kabul demo: create a workspace from a prompt, let Claude work, switch to Codex in the same chat, approve a command and open the pull request",
    play: "Play the demo",
    pause: "Pause the demo",
  },
  diff: {
    title: "Three things Kabul does differently",
    items: [
      {
        title: "The right harness for every LLM",
        body: [
          "A model is only as good as the agent loop around it. Kabul runs each model in the harness built for it: Claude in <strong>Claude Code</strong>, GPT in <strong>Codex</strong>, Gemini in <strong>Antigravity</strong> or <strong>Gemini CLI</strong>, Qwen in <strong>Qwen Code</strong>, and anything else through <strong>OpenCode</strong> or <strong>Goose</strong>, over the Agent Client Protocol.",
          "Local models are routed by family: a Qwen on LM Studio goes to Qwen Code, a gpt-oss goes to Codex. You pick the model; Kabul picks the harness, and tells you when it had to fall back.",
        ],
        img: "model-picker" as Img,
        alt: "Model picker with Claude, GPT and Gemini side by side in the same chat",
      },
      {
        title: "Switch LLM or account in the same conversation, on the same branch",
        body: [
          "Hit a rate limit, want a second opinion, or want a cheaper model for the boring part? Pick another model in the same chat, even one from a different provider or a different account.",
          "Kabul keeps one canonical transcript and hands off to the new agent: the latest messages and who wrote them, the tools used, the diff of the branch and your <code>.context/</code> notes. Same worktree, same branch, checkpoints keep going.",
        ],
        img: "switch-llm" as Img,
        alt: "One conversation that went from Claude Code to Codex to Antigravity, with a divider at each switch and the pull request checks green",
      },
      {
        title: "Work with a friend at the same time, and from your phone",
        body: [
          "Invite someone into a workspace as <strong>editor</strong> or <strong>observer</strong>. You both see the agent stream live, send messages into one shared queue, approve tools (the first decision wins) and type in the same terminal, with presence and authorship on every message.",
          "The same server puts every session of your computer on your phone, and pings you when an agent needs a decision.",
        ],
        img: "collab-mobile" as Img,
        alt: "Two people in the same chat on iPhone and Android, with presence avatars and an approval made by the other person",
      },
    ],
  },
  relay: {
    label: "One conversation that goes from Claude to Codex to Gemini, on the same branch",
    branch: "fix/flaky-cart-totals",
    you: "You",
    composer: "Ask for changes…",
    models: { claude: "Claude · Claude Code", codex: "GPT · Codex", gemini: "Gemini · Gemini CLI" } as Record<RelayAgent, string>,
    lines: [
      { kind: "user", text: "The cart totals test fails about one run in ten. Find out why." },
      { kind: "agent", agent: "claude", who: "Claude · Claude Code", text: "The discount is rounded before the tax, so some totals drift by a cent. Fixed in <code>cart/totals.ts</code>." },
      { kind: "switch", agent: "codex", text: "Switched to GPT · Codex. Same branch, same conversation." },
      { kind: "user", text: "Write regression tests for the rounding." },
      { kind: "agent", agent: "codex", who: "GPT · Codex", text: "Added 3 tests at the rounding edges. 14 passing." },
      { kind: "switch", agent: "gemini", text: "Switched to Gemini · Gemini CLI." },
      { kind: "agent", agent: "gemini", who: "Gemini · Gemini CLI", text: "Reviewed the diff: zero-quantity items skipped the discount. Covered that too." },
    ] as RelayLine[],
  },
  clips: {
    play: "Play video",
    pause: "Pause video",
    switch: {
      title: "Switch models",
      caption: "From Claude to Codex in the same chat, on the same branch.",
      alt: "Video: in a chat with Claude, the model picker switches to Codex, which picks up the conversation on the same branch",
    },
    agents: {
      caption: "The Agents panel: every chat in every workspace, live, with subagents, tokens and cost.",
      alt: "Video: the Agents panel with several agents working at once across workspaces, tokens and cost going up",
    },
    phone: {
      alt: "Video: on iPhone, open the session that waits for you and approve the command; the agent keeps going",
    },
  } as { play: string; pause: string } & Record<Clip, { title?: string; caption?: string; alt: string }>,
  why: {
    title: "The workbench around your agents",
    body: [
      "Coding agents are good enough to work on several things at once. The tools around them are not: each agent lives in its own CLI, one task per terminal, tied to the desk, and locked into one vendor's models.",
      "In Kabul each task gets its own <strong>workspace</strong>: a git worktree on its own branch, with its own ports, terminal and chats, so ten agents can work on ten things without stepping on each other. You review the diff, leave comments for the agent, watch the checks and ship the pull request in the same window.",
    ],
    video: "Create a workspace from a prompt, let Claude work, switch to Codex in the same chat, approve a command and open the pull request.",
  },
  features: {
    title: "Everything a task needs, in one window",
    shots: [
      { img: "agents" as Img, title: "Agents", caption: "Every chat in every workspace, with its subagents, tokens and cost.", alt: "Agents panel: every running chat across workspaces, with subagent trees, tokens and cost" },
      { img: "usage" as Img, title: "Usage", caption: "Cost per day, limits per account, and a nudge before you hit one.", alt: "Usage tab: spend today and this month, limit bars per account and a cost-per-day chart" },
      { img: "mcp" as Img, title: "MCP", caption: "One registry for every AI, and the tokens you save per turn.", alt: "Session MCP panel: servers from Claude Code and Codex, tools and tokens per turn, and the tokens saved" },
      { img: "menubar" as Img, title: "Menu bar", caption: "Limits and running agents at a glance.", alt: "Menu bar popover with spend, limits per account and the agents running now" },
    ],
    list: [
      { title: "Parallel workspaces on git worktrees", body: "One task, one worktree, one branch. Ten reserved ports per workspace, setup, run and archive scripts, <code>.env*</code> files copied in, statuses, pins and a board view." },
      { title: "Chat with approvals and plan mode", body: "Every tool call is a card: approve once, always or deny. Plan mode in every harness, native where the CLI has it and emulated where it doesn't." },
      { title: "Diff, pull requests and checks", body: "Unified or split diff with line comments you send to the agent. Commit, push, open the PR, fix failing checks with their logs, merge and archive." },
      { title: "Checkpoints", body: "A checkpoint before every message you send, in private git refs that never touch your branch. Restore the files to any point, or reset the chat to it." },
      { title: "A real terminal", body: "One per workspace, plus full-tab terminals that start Claude Code, Codex, Gemini or OpenCode for you. Sessions survive the app on macOS." },
      { title: "MCP, shared and per session", body: "Kabul reads the MCP servers you already configured in each CLI and offers them to every agent, without editing your configs. Turn them on or off per session." },
      { title: "Linear and GitHub", body: "Start workspaces from Linear issues and close them from the PR. GitHub through the <code>gh</code> CLI, with multiple accounts. Routines run a prompt on a schedule or a PR event." },
      { title: "Usage, costs and limits", body: "Tokens and cost per workspace, model, account and provider; 5-hour, weekly and monthly windows; alerts and a one-click switch to an account with room left." },
      { title: "Local models", body: "Finds LM Studio, Ollama, llama.cpp, vLLM and MLX servers, shows what fits in memory and routes each family to the harness that runs it best." },
    ],
  },
  agents: {
    title: "Supported agents",
    intro: "Kabul drives the real CLIs, so you keep their behavior, their updates and your existing logins, settings and MCP servers.",
    tableLabel: "What each agent supports in Kabul",
    cols: ["Agent", "Talks over", "Chat and tools", "Approvals", "Plan mode", "Stop", "Resume", "Several accounts", "Local models", "Phone"],
    marks: { y: "Confirmed", p: "Partial", u: "Not confirmed yet", n: "Not available" } as Record<Mark, string>,
    notes: {
      native: "native",
      emulated: "emulated",
      rules: "project rules",
      restart: "restarts to exit",
      remote: "native remote control",
      gemini: "Gemini-API gateways",
      "¹": "¹",
    } as Record<string, string>,
    rows: AGENT_ROWS,
    legend: "Confirmed means the installed CLI was run through Kabul.",
    footnote:
      "¹ Isolated profiles work; signing in with a Google account through Kabul is not tested end to end yet. Any agent, and any shell, can also be followed and typed into from the phone through the live terminal mirror.",
    more: "Agents and harnesses",
    moreHref: "guide/agents",
  },
  phone: {
    title: "Your sessions, in your pocket",
    body: [
      "An installable app for iOS and Android, served by your own computer over Tailscale. See what is running and what is waiting for you, approve tools, read the diff and the files, follow the live terminal, start a workspace or switch the model.",
      "Push notifications tell you when an agent waits for a decision. iOS look on iPhone, Material 3 on Android, one codebase.",
    ],
    note: "The phone app is a PWA you install from the browser. Store builds are on the roadmap.",
    ios: "Kabul on iPhone: sessions waiting for you and an approval sheet for a command",
    android: "Kabul on Android with Material 3: the session list and a chat that switched models",
  },
  start: {
    title: "Up and running in a few minutes",
    steps: [
      "Download the <code>.dmg</code> and drag Kabul to Applications. You need <code>git</code>, <code>tmux</code> and the GitHub CLI: <code>brew install git tmux gh</code>.",
      "Install at least one agent, such as Claude Code or Codex. Kabul can also install a missing CLI for you.",
      "Sign in to your agents and GitHub in <strong>Settings › Accounts</strong>. Kabul runs each CLI's own login and never reads your tokens.",
      "Describe a task and press <kbd>↵</kbd>. Kabul creates the worktree and branch and sends the message to the agent.",
    ],
    more: "Read the quick start",
    moreHref: "guide/quick-start",
  },
  perf: {
    title: "Built for 100 workspaces and 30 agents at once",
    intro:
      "Only the visible workspace is mounted, events are batched per frame, long lists are windowed, and a concurrency limit queues agents with the focused workspace first. Measured budgets run in CI, so a regression fails the build.",
    caption: "Interface, production build, 100 workspaces and 30 synthetic agents",
    cols: ["Metric", "Before", "Now"],
    rows: [
      ["Switching workspace (p95)", "1,098 ms", "48 ms"],
      ["CPU with 30 agents emitting", "100%", "8%"],
      ["Frames per second with 30 agents", "9.7", "60"],
      ["Key press to frame (p95)", "178 ms", "19 ms"],
      ["Opening a 2,000-message conversation", "1,530 ms", "68 ms"],
      ["JS heap", "174 MB", "20 MB"],
    ],
    server: "Server load test (100 workspaces, 30 fake agents, 3 clients): 6.5% CPU on average, about 24 MB of memory, 0.17 ms from event to client at p95.",
    note: "Synthetic loads on one Mac; real agents emit far fewer events.",
    more: "Methodology and full reports",
    moreHref: "guide/performance",
  },
  security: {
    title: "Local-first and open source",
    items: [
      "Your code stays on your machine. Agents talk to the providers you already pay for, with the logins you already have. Kabul never reads your tokens.",
      "No server of its own and no telemetry.",
      "The phone server listens only on localhost and your tailnet, never on the open internet. Devices pair with single-use QR codes and per-device keys stored in the system keychain.",
      "Guests are scoped to one workspace, previews run in a sandbox and secrets never go on a command line.",
      "MIT licensed. Read the code, build it yourself, fork it.",
    ],
    threat: "Threat model",
    threatHref: "guide/security",
    report: "Report a vulnerability",
    license: "MIT license",
  },
  cloud: {
    badge: "Coming soon",
    title: "Kabul Cloud",
    body: "Workspaces that run in the cloud, so your agents keep working with your Mac closed. Invite your team and reach every session from anywhere, without setting up Tailscale.",
    points: [
      "Agents keep going when your computer sleeps",
      "Invite people without Tailscale",
      "Built for teams",
    ],
    formTitle: "Join the waitlist",
    email: "Work e-mail",
    emailPh: "you@company.com",
    use: "How would you use it?",
    solo: "Just me",
    team: "With a team",
    submit: "Join the waitlist",
    sending: "Sending…",
    privacy: "We only use your e-mail to tell you when Kabul Cloud is ready.",
    ok: "You're on the list. We'll e-mail you when Kabul Cloud opens.",
    invalid: "That e-mail address doesn't look right. Check it and try again.",
    limited: "Too many sign-ups from this network. Try again in an hour.",
    failed: "The waitlist couldn't save your e-mail. Try again in a few minutes.",
    honeypot: "Leave this field empty",
  },
  contribute: {
    title: "Contribute",
    intro: "Kabul is built in the open. Issues and pull requests are welcome.",
    items: [
      { title: "Pick a first issue", body: "Small, well-scoped tasks to learn the codebase.", href: "{repo}/labels/good%20first%20issue", cta: "Good first issues" },
      { title: "Read the contributing guide", body: "Layout, commands, commits, versions and how CI works.", href: "{repo}/blob/main/CONTRIBUTING.md", cta: "CONTRIBUTING.md" },
      { title: "Translate", body: "The app is in English and Portuguese. Every string lives in one JSON file per area, so a new language is a pull request.", href: "{repo}/tree/main/apps/web/src/i18n/locales", cta: "Translation files" },
      { title: "Report a bug", body: "Tell us what happened, the version and how to reproduce it.", href: "{repo}/issues/new", cta: "Open an issue" },
      { title: "Report a vulnerability", body: "Please report security problems privately, never in a public issue.", href: "{repo}/blob/main/SECURITY.md", cta: "SECURITY.md" },
    ],
  },
  support: {
    title: "Support Kabul",
    body: "Kabul is free and open source. Sponsorships pay for the time that goes into it.",
    labels: {
      "github-sponsors": "GitHub Sponsors",
      "buy-me-a-coffee": "Buy Me a Coffee",
      "ko-fi": "Ko-fi",
      "open-collective": "Open Collective",
    } as Record<string, string>,
    pixTitle: "Pix (Brazil)",
    pixKey: "Pix key",
    pixTo: "Receiver",
    pixCopy: "Copy key",
    pixCopied: "Copied",
    pixQr: "Pix QR code",
    star: "Not sponsoring? A star on GitHub helps too.",
  },
  faq: {
    title: "Questions",
    items: [
      { q: "Is Kabul free?", a: "Yes, MIT licensed. You bring your own agent subscriptions or API keys (Claude, ChatGPT, Google, local models). Kabul doesn't resell or proxy model access." },
      { q: "Does my code leave my computer?", a: "Only what the agents send to their providers and what <code>gh</code> sends to GitHub, exactly as if you ran those CLIs yourself. Kabul has no server of its own and no telemetry." },
      { q: "Does Kabul replace the agent CLIs?", a: "No. It drives the real CLIs (Claude Code, Codex, Antigravity and others), so you keep their behavior, their updates and your existing logins, settings and MCP servers." },
      { q: "Which platforms?", a: "macOS 14 or later (Apple Silicon and Intel) is the main platform. Windows 10 1809+ and 11 are in beta: terminal sessions don't survive closing the app yet. Linux is not packaged. The phone app runs on iOS and Android." },
      { q: "Do I need Tailscale?", a: "Only for the phone, other machines and collaboration. The phone server listens on localhost and your tailnet, never on the open internet." },
      { q: "Can a friend see my other repositories?", a: "No. An invite is scoped to one workspace. But an editor can run commands as your user (terminal and approvals), so only invite as editor someone you would let use your computer." },
      { q: "Is there a phone app in the stores?", a: "Not yet. The phone app is a PWA you install from the browser; store builds are on the roadmap." },
      { q: "Is the interface in English?", a: "Yes. The desktop app, the phone app, the menus and the notifications are in English and Portuguese (Brazil). Kabul follows the system language, and you can pick one in Settings › General › Language." },
    ],
    more: "More answers in the FAQ",
    moreHref: "guide/faq",
  },
  footer: {
    tagline: "Every coding agent at its best, side by side.",
    docs: "Docs",
    github: "GitHub",
    changelog: "Changelog",
    security: "Security",
    license: "License",
    credits: "Credits",
    version: "Version",
    createdBy: "Created by Valter Acetto",
    builtWith: "Built with Claude",
    sponsor: "Sponsor on GitHub",
  },
};

export type Content = typeof en;

const pt: Content = {
  lang: "pt-BR",
  path: "/pt-BR/",
  ogLocale: "pt_BR",
  meta: {
    title: "Kabul: cada agente de código no seu melhor, lado a lado",
    description:
      "App gratuito e de código aberto para macOS. Rode Claude Code, Codex, Gemini, Qwen e modelos locais em paralelo, cada um no seu git worktree, e troque de modelo sem perder a conversa.",
    ogAlt: "Kabul: workspaces em paralelo, chat com aprovações e o diff lado a lado",
  },
  nav: {
    skip: "Pular para o conteúdo",
    label: "Principal",
    features: "Recursos",
    agents: "Agentes",
    phone: "Celular",
    cloud: "Nuvem",
    docs: "Documentação",
    github: "GitHub",
    langLabel: "Idioma",
    langOther: "English",
    langOtherShort: "EN",
  },
  hero: {
    title: "Cada agente de código no seu melhor, lado a lado.",
    lede:
      "Rode Claude, GPT, Gemini, Qwen e modelos locais em paralelo, cada um no harness feito para ele, cada um no seu git worktree. Troque de modelo sem perder a conversa. Chame um amigo para a sessão. Continue pelo celular.",
    download: "Baixar para macOS",
    star: "Estrela no GitHub",
    windows: "Windows (beta)",
    fine: "Gratuito e de código aberto, licença MIT. macOS 14 ou mais novo, Apple Silicon e Intel.",
    lanesLabel: "Conduz os CLIs de verdade",
    alt: "Kabul: workspaces em paralelo na barra lateral, um diff com comentário de revisão e o chat do agente pedindo para aplicar uma edição",
    videoLabel: "Demonstração do Kabul: criar um workspace a partir de um pedido, o Claude trabalha, trocar para o Codex na mesma conversa, aprovar um comando e abrir o pull request",
    play: "Tocar a demonstração",
    pause: "Pausar a demonstração",
  },
  diff: {
    title: "Três coisas que o Kabul faz diferente",
    items: [
      {
        title: "O harness certo para cada LLM",
        body: [
          "Um modelo rende o que o laço de agente em volta dele deixa render. O Kabul roda cada modelo no harness feito para ele: Claude no <strong>Claude Code</strong>, GPT no <strong>Codex</strong>, Gemini no <strong>Antigravity</strong> ou no <strong>Gemini CLI</strong>, Qwen no <strong>Qwen Code</strong>, e o resto pelo <strong>OpenCode</strong> ou pelo <strong>Goose</strong>, pelo Agent Client Protocol.",
          "Modelos locais são encaminhados pela família: um Qwen no LM Studio vai para o Qwen Code, um gpt-oss vai para o Codex. Você escolhe o modelo; o Kabul escolhe o harness e avisa quando precisou usar outro.",
        ],
        img: "model-picker",
        alt: "Seletor de modelo com Claude, GPT e Gemini lado a lado na mesma conversa",
      },
      {
        title: "Trocar de LLM ou de conta na mesma conversa, na mesma branch",
        body: [
          "Bateu no limite, quer uma segunda opinião ou um modelo mais barato para a parte chata? Escolha outro modelo na mesma conversa, mesmo de outro provedor ou de outra conta.",
          "O Kabul guarda um transcript canônico e passa o bastão para o agente novo: as últimas mensagens e quem escreveu cada uma, as ferramentas usadas, o diff da branch e as suas notas em <code>.context/</code>. Mesmo worktree, mesma branch, os checkpoints continuam.",
        ],
        img: "switch-llm",
        alt: "Uma conversa que passou do Claude Code para o Codex e depois para o Antigravity, com um divisor em cada troca e os checks do PR verdes",
      },
      {
        title: "Trabalhar com um amigo ao mesmo tempo, e pelo celular",
        body: [
          "Convide alguém para um workspace como <strong>editor</strong> ou <strong>observador</strong>. Os dois veem o agente ao vivo, mandam mensagens numa fila única, aprovam ferramentas (vale a primeira decisão) e digitam no mesmo terminal, com presença e autoria em cada mensagem.",
          "O mesmo servidor leva todas as sessões do seu computador para o celular e avisa quando um agente precisa de uma decisão.",
        ],
        img: "collab-mobile",
        alt: "Duas pessoas na mesma conversa no iPhone e no Android, com avatares de presença e uma aprovação feita pela outra pessoa",
      },
    ],
  },
  relay: {
    label: "Uma conversa que passa do Claude para o Codex e para o Gemini, na mesma branch",
    branch: "fix/flaky-cart-totals",
    you: "Você",
    composer: "Peça mudanças…",
    models: { claude: "Claude · Claude Code", codex: "GPT · Codex", gemini: "Gemini · Gemini CLI" },
    lines: [
      { kind: "user", text: "O teste dos totais do carrinho falha uma vez a cada dez. Descubra por quê." },
      { kind: "agent", agent: "claude", who: "Claude · Claude Code", text: "O desconto é arredondado antes do imposto, então alguns totais escorregam um centavo. Corrigido em <code>cart/totals.ts</code>." },
      { kind: "switch", agent: "codex", text: "Trocou para GPT · Codex. Mesma branch, mesma conversa." },
      { kind: "user", text: "Escreva testes de regressão para o arredondamento." },
      { kind: "agent", agent: "codex", who: "GPT · Codex", text: "Adicionei 3 testes nas bordas do arredondamento. 14 passando." },
      { kind: "switch", agent: "gemini", text: "Trocou para Gemini · Gemini CLI." },
      { kind: "agent", agent: "gemini", who: "Gemini · Gemini CLI", text: "Revisei o diff: itens com quantidade zero pulavam o desconto. Cobri isso também." },
    ],
  },
  clips: {
    play: "Tocar o vídeo",
    pause: "Pausar o vídeo",
    switch: {
      title: "Trocar de modelo",
      caption: "Do Claude para o Codex na mesma conversa, na mesma branch.",
      alt: "Vídeo: numa conversa com o Claude, o seletor de modelo troca para o Codex, que continua a conversa na mesma branch",
    },
    agents: {
      caption: "O painel Agentes: todas as conversas de todos os workspaces, ao vivo, com subagentes, tokens e custo.",
      alt: "Vídeo: o painel Agentes com vários agentes trabalhando ao mesmo tempo em workspaces diferentes, tokens e custo subindo",
    },
    phone: {
      alt: "Vídeo: no iPhone, abrir a sessão que espera por você e aprovar o comando; o agente continua",
    },
  },
  why: {
    title: "A bancada em volta dos seus agentes",
    body: [
      "Os agentes de código já dão conta de várias coisas ao mesmo tempo. As ferramentas em volta deles, não: cada agente vive no seu CLI, uma tarefa por terminal, preso à mesa e aos modelos de um fornecedor só.",
      "No Kabul cada tarefa ganha um <strong>workspace</strong>: um git worktree na sua própria branch, com portas, terminal e conversas próprios, para dez agentes trabalharem em dez coisas sem pisar um no outro. Você revisa o diff, deixa comentários para o agente, acompanha os checks e entrega o pull request na mesma janela.",
    ],
    video: "Criar um workspace a partir de um pedido, o Claude trabalha, trocar para o Codex na mesma conversa, aprovar um comando e abrir o pull request.",
  },
  features: {
    title: "Tudo o que uma tarefa pede, numa janela só",
    shots: [
      { img: "agents", title: "Agentes", caption: "Todas as conversas de todos os workspaces, com os subagentes, tokens e custo.", alt: "Painel Agentes: todas as conversas rodando em todos os workspaces, com a árvore de subagentes, tokens e custo" },
      { img: "usage", title: "Uso", caption: "Custo por dia, limites por conta e um aviso antes de bater em um.", alt: "Aba Uso: gasto de hoje e do mês, barras de limite por conta e gráfico de custo por dia" },
      { img: "mcp", title: "MCP", caption: "Um registro para todas as IAs e os tokens economizados por turno.", alt: "Painel MCP da sessão: servidores do Claude Code e do Codex, ferramentas e tokens por turno, e a economia" },
      { img: "menubar", title: "Barra de menus", caption: "Limites e agentes rodando num relance.", alt: "Popover da barra de menus com gasto, limites por conta e os agentes rodando agora" },
    ],
    list: [
      { title: "Workspaces em paralelo com git worktree", body: "Uma tarefa, um worktree, uma branch. Dez portas reservadas por workspace, scripts de setup, run e archive, arquivos <code>.env*</code> copiados, status, fixados e quadro." },
      { title: "Chat com aprovações e plano", body: "Cada ferramenta vira um cartão: aprovar uma vez, sempre ou negar. Plan mode em todos os harnesses, nativo onde o CLI tem e emulado onde não tem." },
      { title: "Diff, PR e checks", body: "Diff unificado ou lado a lado, com comentários por linha que vão para o agente. Commit, push, abrir o PR, corrigir checks com os logs, merge e arquivar." },
      { title: "Checkpoints", body: "Um checkpoint antes de cada mensagem enviada, em refs privadas do git que não mexem na sua branch. Restaure os arquivos de qualquer ponto ou volte a conversa até ele." },
      { title: "Um terminal de verdade", body: "Um por workspace e terminais em aba inteira que já abrem o Claude Code, o Codex, o Gemini ou o OpenCode. No macOS as sessões sobrevivem ao app." },
      { title: "MCP compartilhado e por sessão", body: "O Kabul lê os servidores MCP que você já configurou em cada CLI e oferece todos a todos os agentes, sem mexer nas suas configs. Ligue e desligue por sessão." },
      { title: "Linear e GitHub", body: "Workspaces a partir de issues do Linear, fechadas pelo PR. GitHub pelo <code>gh</code>, com várias contas. Rotinas rodam um prompt num horário ou num evento do PR." },
      { title: "Uso, custos e limites", body: "Tokens e custo por workspace, modelo, conta e provedor; janelas de 5 horas, semana e mês; alertas e troca com um clique para uma conta com folga." },
      { title: "Modelos locais", body: "Acha servidores do LM Studio, Ollama, llama.cpp, vLLM e MLX, mostra o que cabe na memória e encaminha cada família para o harness que roda melhor." },
    ],
  },
  agents: {
    title: "Agentes suportados",
    intro: "O Kabul conduz os CLIs de verdade, então você mantém o comportamento, as atualizações, os logins, as configurações e os servidores MCP de cada um.",
    tableLabel: "O que cada agente suporta no Kabul",
    cols: ["Agente", "Fala por", "Chat e ferramentas", "Aprovações", "Plan mode", "Parar", "Retomar", "Várias contas", "Modelos locais", "Celular"],
    marks: { y: "Confirmado", p: "Parcial", u: "Ainda não confirmado", n: "Não disponível" },
    notes: {
      native: "nativo",
      emulated: "emulado",
      rules: "regras do projeto",
      restart: "reinicia para sair",
      remote: "controle remoto nativo",
      gemini: "gateways da API do Gemini",
      "¹": "¹",
      "Anthropic API": "API Anthropic",
      "Responses API": "API Responses",
      "OpenAI API": "API OpenAI",
    },
    rows: AGENT_ROWS,
    legend: "Confirmado quer dizer que o CLI instalado rodou pelo Kabul.",
    footnote:
      "¹ Perfis isolados funcionam; entrar com a conta Google pelo Kabul ainda não foi testado de ponta a ponta. Qualquer agente, e qualquer shell, também pode ser acompanhado e operado pelo celular pelo espelho do terminal.",
    more: "Agentes e harnesses",
    moreHref: "pt-BR/guia/agentes",
  },
  phone: {
    title: "As suas sessões no bolso",
    body: [
      "Um app instalável para iOS e Android, servido pelo seu próprio computador pelo Tailscale. Veja o que está rodando e o que espera por você, aprove ferramentas, leia o diff e os arquivos, acompanhe o terminal ao vivo, crie um workspace ou troque o modelo.",
      "Notificações avisam quando um agente espera uma decisão. Visual de iOS no iPhone, Material 3 no Android, um código só.",
    ],
    note: "O app do celular é uma PWA que você instala pelo navegador. As versões para as lojas estão no roadmap.",
    ios: "Kabul no iPhone: sessões esperando você e a folha de aprovação de um comando",
    android: "Kabul no Android com Material 3: a lista de sessões e uma conversa que trocou de modelo",
  },
  start: {
    title: "Funcionando em poucos minutos",
    steps: [
      "Baixe o <code>.dmg</code> e arraste o Kabul para Aplicativos. Você precisa de <code>git</code>, <code>tmux</code> e do GitHub CLI: <code>brew install git tmux gh</code>.",
      "Instale pelo menos um agente, como o Claude Code ou o Codex. O Kabul também instala um CLI que falte.",
      "Entre nos agentes e no GitHub em <strong>Configurações › Contas</strong>. O Kabul roda o login do próprio CLI e nunca lê os seus tokens.",
      "Descreva uma tarefa e tecle <kbd>↵</kbd>. O Kabul cria o worktree e a branch e manda a mensagem para o agente.",
    ],
    more: "Ler o início rápido",
    moreHref: "pt-BR/guia/inicio-rapido",
  },
  perf: {
    title: "Feito para 100 workspaces e 30 agentes ao mesmo tempo",
    intro:
      "Só o workspace visível fica montado, os eventos chegam em lote por quadro, listas longas são desenhadas por blocos e um limite de agentes simultâneos põe os outros numa fila, com o workspace em foco na frente. Os orçamentos medidos rodam no CI, então uma regressão quebra o build.",
    caption: "Interface, build de produção, 100 workspaces e 30 agentes sintéticos",
    cols: ["Métrica", "Antes", "Agora"],
    rows: [
      ["Trocar de workspace (p95)", "1.098 ms", "48 ms"],
      ["CPU com 30 agentes emitindo", "100%", "8%"],
      ["Quadros por segundo com 30 agentes", "9,7", "60"],
      ["Tecla até o quadro (p95)", "178 ms", "19 ms"],
      ["Abrir a conversa de 2.000 mensagens", "1.530 ms", "68 ms"],
      ["Heap JS", "174 MB", "20 MB"],
    ],
    server: "Teste de carga do servidor (100 workspaces, 30 agentes falsos, 3 clientes): 6,5% de CPU em média, uns 24 MB de memória, 0,17 ms do evento ao cliente no p95.",
    note: "Cargas sintéticas num Mac só; agentes de verdade emitem bem menos eventos.",
    more: "Metodologia e relatórios completos",
    moreHref: "pt-BR/guia/desempenho",
  },
  security: {
    title: "Local e de código aberto",
    items: [
      "O seu código fica na sua máquina. Os agentes falam com os provedores que você já paga, com os logins que você já tem. O Kabul nunca lê os seus tokens.",
      "Sem servidor próprio e sem telemetria.",
      "O servidor do celular só escuta no localhost e na sua tailnet, nunca na internet aberta. Os aparelhos pareiam com QR de uso único e chaves por aparelho guardadas no cofre do sistema.",
      "Convidados ficam presos a um workspace, os previews rodam em sandbox e segredos nunca vão para a linha de comando.",
      "Licença MIT. Leia o código, compile você mesmo, faça um fork.",
    ],
    threat: "Modelo de ameaças",
    threatHref: "pt-BR/guia/seguranca",
    report: "Reportar uma vulnerabilidade",
    license: "Licença MIT",
  },
  cloud: {
    badge: "Em breve",
    title: "Kabul Cloud",
    body: "Workspaces rodando na nuvem, para os seus agentes continuarem trabalhando com o Mac desligado. Convide o seu time e acesse cada sessão de qualquer lugar, sem configurar o Tailscale.",
    points: [
      "Os agentes seguem quando o computador dorme",
      "Convites sem Tailscale",
      "Feito para times",
    ],
    formTitle: "Entre na lista de espera",
    email: "E-mail de trabalho",
    emailPh: "voce@empresa.com",
    use: "Como você usaria?",
    solo: "Só eu",
    team: "Com um time",
    submit: "Entrar na lista",
    sending: "Enviando…",
    privacy: "Usamos o seu e-mail só para avisar quando o Kabul Cloud estiver pronto.",
    ok: "Você está na lista. Mandamos um e-mail quando o Kabul Cloud abrir.",
    invalid: "Esse e-mail não parece certo. Confira e tente de novo.",
    limited: "Muitos cadastros saindo desta rede. Tente de novo daqui a uma hora.",
    failed: "A lista de espera não conseguiu gravar o seu e-mail. Tente de novo em alguns minutos.",
    honeypot: "Deixe este campo vazio",
  },
  contribute: {
    title: "Contribua",
    intro: "O Kabul é feito às claras. Issues e pull requests são bem-vindos.",
    items: [
      { title: "Pegue uma primeira issue", body: "Tarefas pequenas e bem recortadas para conhecer o código.", href: "{repo}/labels/good%20first%20issue", cta: "Good first issues" },
      { title: "Leia o guia de contribuição", body: "Estrutura, comandos, commits, versões e como o CI funciona.", href: "{repo}/blob/main/CONTRIBUTING.pt-BR.md", cta: "CONTRIBUTING.pt-BR.md" },
      { title: "Traduza", body: "O app está em inglês e português. Cada texto mora num arquivo JSON por área, então um idioma novo é um pull request.", href: "{repo}/tree/main/apps/web/src/i18n/locales", cta: "Arquivos de tradução" },
      { title: "Reporte um bug", body: "Conte o que aconteceu, a versão e como reproduzir.", href: "{repo}/issues/new", cta: "Abrir uma issue" },
      { title: "Reporte uma vulnerabilidade", body: "Falhas de segurança vão em particular, nunca numa issue pública.", href: "{repo}/blob/main/SECURITY.md", cta: "SECURITY.md" },
    ],
  },
  support: {
    title: "Apoie o Kabul",
    body: "O Kabul é gratuito e de código aberto. Os patrocínios pagam o tempo dedicado a ele.",
    labels: {
      "github-sponsors": "GitHub Sponsors",
      "buy-me-a-coffee": "Buy Me a Coffee",
      "ko-fi": "Ko-fi",
      "open-collective": "Open Collective",
    },
    pixTitle: "Pix",
    pixKey: "Chave Pix",
    pixTo: "Recebedor",
    pixCopy: "Copiar chave",
    pixCopied: "Copiada",
    pixQr: "QR code do Pix",
    star: "Não vai patrocinar? Uma estrela no GitHub também ajuda.",
  },
  faq: {
    title: "Perguntas",
    items: [
      { q: "O Kabul é gratuito?", a: "Sim, licença MIT. Você usa as suas assinaturas ou chaves de API dos agentes (Claude, ChatGPT, Google, modelos locais). O Kabul não revende nem intermedeia acesso a modelos." },
      { q: "O meu código sai do computador?", a: "Só o que os agentes mandam para os provedores deles e o que o <code>gh</code> manda para o GitHub, exatamente como se você rodasse esses CLIs. O Kabul não tem servidor próprio nem telemetria." },
      { q: "O Kabul substitui os CLIs dos agentes?", a: "Não. Ele conduz os CLIs de verdade (Claude Code, Codex, Antigravity e outros), então você mantém o comportamento, as atualizações, os logins, as configurações e os servidores MCP de cada um." },
      { q: "Quais plataformas?", a: "O macOS 14 ou mais novo (Apple Silicon e Intel) é a plataforma principal. O Windows 10 1809+ e 11 está em beta: as sessões de terminal ainda não sobrevivem ao fechar o app. Linux não tem pacote. O app do celular roda no iOS e no Android." },
      { q: "Preciso do Tailscale?", a: "Só para o celular, outras máquinas e colaboração. O servidor do celular escuta no localhost e na sua tailnet, nunca na internet aberta." },
      { q: "Um amigo convidado vê os meus outros repositórios?", a: "Não. O convite fica preso a um workspace. Mas um editor roda comandos com o seu usuário (terminal e aprovações), então só convide como editor quem você deixaria usar o seu computador." },
      { q: "Tem app do celular nas lojas?", a: "Ainda não. O app do celular é uma PWA que você instala pelo navegador; as versões para as lojas estão no roadmap." },
      { q: "A interface está em português?", a: "Sim, e em inglês. O app desktop, o app do celular, os menus e as notificações seguem o idioma do sistema; para escolher, vá em Configurações › Geral › Idioma." },
    ],
    more: "Mais respostas nas perguntas frequentes",
    moreHref: "pt-BR/guia/faq",
  },
  footer: {
    tagline: "Cada agente de código no seu melhor, lado a lado.",
    docs: "Documentação",
    github: "GitHub",
    changelog: "Changelog",
    security: "Segurança",
    license: "Licença",
    credits: "Créditos",
    version: "Versão",
    createdBy: "Criado por Valter Acetto",
    builtWith: "Feito com o Claude",
    sponsor: "Patrocinar no GitHub",
  },
};

export const content: Record<Lang, Content> = { en, "pt-BR": pt };
