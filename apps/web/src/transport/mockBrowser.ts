/* i18n-ignore-file: backend de mentira; os textos imitam dados e erros do backend (pt-BR). */
/** Navegador do Kabul falso para o mock (aba Browser, aprovações, screencast). Ver mock.ts. */
type H = (p: any) => unknown;
export interface BrowserMock { handlers: Record<string, H>; agent: (w: string, agent: string, tool?: string, detail?: string) => void; approval: (w: string, p: { kind?: "navigate" | "evaluate"; detail?: string; agent?: string }) => string }

export function makeBrowserMock({ emit, db, now, nextId }: { emit: (ch: string, p: unknown) => void; db: any; now: () => number; nextId: () => number }): BrowserMock {
  type MockBrowser = { running: boolean; hist: string[]; idx: number; tabs: { id: string; url: string }[]; active: string; paused: boolean; cast: boolean; viewport: { width: number; height: number; mobile: boolean; scale: number }; actions: any[]; approvals: any[]; agent: any };
  const browsers: Record<string, MockBrowser> = {};
  const br = (w: string): MockBrowser => (browsers[w] ??= { running: false, hist: ["about:blank"], idx: 0, tabs: [{ id: "T1", url: "about:blank" }], active: "T1", paused: false, cast: false, viewport: { width: 1280, height: 800, mobile: false, scale: 1 }, actions: [], approvals: [], agent: null });
  const browserTitle = (u: string) => (u === "about:blank" ? "" : `Página ${u.replace(/^https?:\/\//, "")}`);
  function browserGo(b: MockBrowser, url: string) {
    const u = /^([a-z]+:\/\/|about:|data:)/.test(url) ? url : /^(localhost|127\.)/.test(url) ? `http://${url}` : `https://${url}`;
    b.hist = [...b.hist.slice(0, b.idx + 1), u];
    b.idx = b.hist.length - 1;
    const t = b.tabs.find((x) => x.id === b.active);
    if (t) t.url = u;
  }
  function browserStatus(w: string) {
    const b = br(w);
    const url = b.hist[b.idx];
    return { running: b.running, binary: { path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", kind: "chrome", shell: false }, profile: `/mock/state/browser/${w}/profile`, tabs: b.running ? b.tabs.map((x) => ({ id: x.id, url: x.id === b.active ? url : x.url, title: browserTitle(x.id === b.active ? url : x.url), active: x.id === b.active })) : [], url: b.running ? url : null, title: b.running ? browserTitle(url) : null, viewport: b.viewport, paused: b.paused, agent: b.agent, actions: b.actions, approvals: b.approvals, policy: db.settings.browser_policy ?? "localhost" };
  }
  /** Quadro: canvas com a URL atual (JPEG em base64), do tamanho da página em pixels CSS / 2. */
  function frameOf(w: string) {
    const b = br(w);
    const c = document.createElement("canvas");
    c.width = b.viewport.width / 2;
    c.height = b.viewport.height / 2;
    const g = c.getContext("2d")!;
    g.fillStyle = "#f4f4f4";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#222";
    g.font = "16px sans-serif";
    g.fillText(b.hist[b.idx], 12, 28);
    return { data: c.toDataURL("image/jpeg", 0.7).split(",")[1], width: b.viewport.width, height: b.viewport.height, url: b.hist[b.idx] };
  }
  function browserFrame(w: string) {
    const b = br(w);
    if (b.cast && b.running) emit("browser-frame", { workspace: w, ...frameOf(w) });
  }

  const handlers: Record<string, H> = {
    // Navegador do Kabul (aba Browser): estado falso por workspace; o quadro é um canvas com a URL.
    browser_status: ({ workspaceId }) => browserStatus(workspaceId),
    browser_open: ({ workspaceId, url }) => {
      if ((window as any).__mock?.noBrowser) throw new Error("Nenhum Chrome, Edge ou Chromium encontrado. Instale um deles ou baixe o navegador do Kabul em Configurações › Navegador (kabul browser install).");
      const b = br(workspaceId);
      b.running = true;
      if (url) browserGo(b, String(url));
      browserFrame(workspaceId);
      return browserStatus(workspaceId);
    },
    browser_nav: ({ workspaceId, action, url }) => {
      const b = br(workspaceId);
      if (action === "back") { if (b.idx <= 0) throw new Error("não há página anterior"); b.idx--; }
      else if (action === "forward") { if (b.idx >= b.hist.length - 1) throw new Error("não há próxima página"); b.idx++; }
      else if (action === "goto") browserGo(b, String(url ?? "about:blank"));
      browserFrame(workspaceId);
      return `${b.hist[b.idx]} — ${browserTitle(b.hist[b.idx])}`;
    },
    browser_input: () => undefined,
    browser_tab: ({ workspaceId, action, id: tid, url }) => {
      const b = br(workspaceId);
      if (action === "new") (b.tabs.push({ id: `T${b.tabs.length + 1}`, url: url ?? "about:blank" }), (b.active = b.tabs[b.tabs.length - 1].id));
      else if (action === "close") (b.tabs = b.tabs.filter((x) => x.id !== tid), b.active === tid && (b.active = b.tabs[0]?.id ?? ""));
      else b.active = tid;
      return browserStatus(workspaceId);
    },
    browser_resize: ({ workspaceId, preset }) => (br(workspaceId).viewport = preset === "mobile" ? { width: 390, height: 844, mobile: true, scale: 3 } : { width: 1280, height: 800, mobile: false, scale: 1 }),
    browser_screenshot: ({ workspaceId }) => (br(workspaceId).running ? { workspace: workspaceId, ...frameOf(workspaceId) } : null),
    browser_screencast: ({ workspaceId, on }) => {
      if ((window as any).__mock?.noScreencast) throw new Error("comando browser_screencast não disponível");
      br(workspaceId).cast = !!on;
      if (on) browserFrame(workspaceId);
    },
    browser_control: ({ workspaceId, paused }) => ((br(workspaceId).paused = !!paused), { paused: !!paused, at: now() }),
    browser_approve: ({ workspaceId, id: rid, allow, always }) => {
      const b = br(workspaceId);
      const a = b.approvals.find((x) => x.id === rid);
      if (!a) throw new Error("pedido de aprovação não encontrado (expirou?)");
      b.approvals = b.approvals.filter((x) => x.id !== rid);
      ((window as any).__mock.browserDecisions ??= []).push({ id: rid, allow, always: !!always });
      if (allow && a.kind === "navigate") browserGo(b, a.detail);
    },
    browser_pending: () => Object.entries(browsers).flatMap(([w, b]) => b.approvals.map((a) => ({ ...a, workspaceId: w }))),
    browser_stop: ({ workspaceId }) => { const b = br(workspaceId); const was = b.running; b.running = false; return was; },
    browser_clear: ({ workspaceId }) => void (delete browsers[workspaceId]),
    browser_install: () => (((window as any).__mock.noBrowser = false), "/mock/state/browser/bin/chrome-headless-shell"),
    browser_info: () => ({ claudeChrome: !!(window as any).__mock?.claudeChrome, binary: (window as any).__mock?.noBrowser ? null : { path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", kind: "chrome", shell: false } }),
  };
  return {
    handlers,
    agent: (w, agent, tool = "click", detail = "e42") => { const b = br(w); const a = { at: Date.now(), agent, tool, detail, ok: true }; b.agent = a; b.actions.push(a); },
    approval: (w, p) => { const b = br(w); const a = { id: `ap${nextId()}`, kind: p.kind ?? "navigate", detail: p.detail ?? "https://example.org/", agent: p.agent ?? "codex", at: Date.now() }; b.approvals.push(a); return a.id; },
  };
}
