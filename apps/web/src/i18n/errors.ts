/**
 * Erros que vêm do backend (kabul-core, kabuld, app desktop) em português. Cada padrão conhecido vira uma
 * chave de `locales/<idioma>/errors.json`; os grupos nomeados do padrão viram variáveis do texto.
 * Em pt-BR a mensagem passa direto. O que não casar com nenhum padrão aparece como veio (pt-BR), com o
 * prefixo técnico preservado; a lista dos que ficaram de fora está em docs/i18n.md.
 */
import { t, type Key } from "./index";
import { lang } from "./lang";

/** [padrão (casado no texto inteiro ou num trecho), chave]. Ordem importa: o primeiro que casar vence. */
export const BACKEND_ERRORS: [RegExp, Key][] = [
  [/Missing GitHub access: a conta ativa não acessa (?<slug>[^\s(]+?)\.?(?= \(|$)/, "errors.ghNoAccess"],
  [/\.mcp\.json inválido/, "errors.mcpJsonInvalid"],
  [/Codex não instalado/, "errors.codexMissing"],
  [/CodexBar não instalado/, "errors.codexbarMissing"],
  [/CodexBar não respondeu/, "errors.codexbarNoReply"],
  [/Host não local/, "errors.hostNotLocal"],
  [/Linear não conectado/, "errors.linearNotConnected"],
  [/Linear respondeu (?<code>\d+)/, "errors.linearReplied"],
  [/resposta inválida do Linear/, "errors.linearBadReply"],
  [/PR criado, mas o auto-merge falhou:/, "errors.prAutoMergeFailed"],
  [/Tailscale não instalado \(procurei no PATH, em \/usr\/local\/bin e em \/Applications\/Tailscale\.app\)/, "errors.tailscaleMissing"],
  [/não consegui ler o `tailscale status`: o Tailscale está aberto e conectado\?/, "errors.tailscaleStatus"],
  [/a pasta não é um repositório git/, "errors.notGitRepo"],
  [/a porta (?<port>\d+) é do próprio kabuld/, "errors.portIsKabuld"],
  [/a sessão (?<name>\S+) já existe/, "errors.sessionExists"],
  [/agente desconhecido: (?<agent>\S+) \(use claude, codex, agy ou shell\)/, "errors.unknownAgent"],
  [/agente desconhecido/, "errors.unknownAgentShort"],
  [/app-server do Codex não respondeu/, "errors.codexAppServer"],
  [/argumento (?<arg>\w+) ausente/, "errors.missingArg"],
  [/arquive os workspaces do repo antes de removê-lo/, "errors.archiveFirst"],
  [/arquivo de segredo: só o dono vê/, "errors.secretFile"],
  [/arquivo grande demais: peça por partes \(Range\)/, "errors.fileTooBig"],
  [/arquivos do \.git não são servidos/, "errors.gitFilesNotServed"],
  [/branch apagada e sem checkpoint para recriar/, "errors.branchGone"],
  [/caminho fora do workspace \(link simbólico\?\)/, "errors.pathOutside"],
  [/caminho precisa ser absoluto/, "errors.pathAbsolute"],
  [/chat não encontrado \(encerrado\?\)/, "errors.chatNotFoundEnded"],
  [/chat não encontrado/, "errors.chatNotFound"],
  [/conta não encontrada/, "errors.accountNotFound"],
  [/credencial inválida ou revogada: pareie de novo/, "errors.credInvalid"],
  [/credencial revogada/, "errors.credRevoked"],
  [/código de pareamento inválido ou expirado/, "errors.pairCodeInvalid"],
  [/dispositivo não encontrado/, "errors.deviceNotFound"],
  [/docker não encontrado/, "errors.dockerMissing"],
  [/este harness não recebe aprovações pelo app/, "errors.noApprovals"],
  [/este transporte não oferece HTTPS/, "errors.noHttps"],
  [/falha ao executar (?<bin>\S+)/, "errors.execFailed"],
  [/fonte do modelo local não encontrada/, "errors.localModelSource"],
  [/fora do workspace compartilhado com você/, "errors.outsideShared"],
  [/gh não encontrado/, "errors.ghMissing"],
  [/git não encontrado/, "errors.gitMissing"],
  [/git ocupado \((?<why>[^)]*)\); checkpoint adiado/, "errors.gitBusy"],
  [/harness desconhecido no registro: (?<h>\S+)/, "errors.harnessUnknown"],
  [/já decidido/, "errors.alreadyDecided"],
  [/comando (?<cmd>\S+) não disponível/, "errors.cmdUnavailable"],
  [/kabuld não iniciou/, "errors.kabuldNotStarted"],
  [/link expirado: abra o arquivo de novo/, "errors.linkExpired"],
  [/mensagem vazia/, "errors.emptyMessage"],
  [/modelo do chat desconhecido/, "errors.chatModelUnknown"],
  [/modelo local (?<id>\S+) não encontrado/, "errors.localModelNotFound"],
  [/modelo não está mais disponível/, "errors.modelGone"],
  [/muitas tentativas; espere alguns minutos/, "errors.tooManyTries"],
  [/muitos links de proxy abertos; espere um pouco/, "errors.tooManyProxy"],
  [/nenhum banco de sessões para importar foi encontrado/, "errors.noSessionDb"],
  [/nenhum modelo whisper \(ggml-\*\.bin\) encontrado; baixe um em ~\/\.cache\/whisper ou defina KABUL_WHISPER_MODEL/, "errors.noWhisper"],
  [/o check não é do GitHub Actions; abra o link/, "errors.checkNotActions"],
  [/o servidor ainda não subiu/, "errors.serverNotUp"],
  [/o servidor está desligado/, "errors.serverOff"],
  [/o terminal já fechou/, "errors.terminalClosed"],
  [/o terminal só abre pastas/, "errors.terminalFoldersOnly"],
  [/observadores só acompanham: peça ao dono para te convidar como editor/, "errors.viewerOnly"],
  [/origem não local/, "errors.originNotLocal"],
  [/pane não encontrado/, "errors.paneNotFound"],
  [/pareamento necessário/, "errors.pairingRequired"],
  [/porta (?<port>\d+) não é deste workspace/, "errors.portNotWorkspace"],
  [/porta (?<port>\S+) ocupada\?/, "errors.portBusy"],
  [/provedor sem isolamento de conta/, "errors.noAccountIsolation"],
  [/repo não encontrado/, "errors.repoNotFound"],
  [/restauração recusada:/, "errors.restoreRefused"],
  [/retomada indisponível neste servidor/, "errors.resumeUnavailableHere"],
  [/retomada indisponível/, "errors.resumeUnavailable"],
  [/runtime parado e sem comando para iniciar/, "errors.runtimeNoStart"],
  [/sem permissão para (?<cmd>\S+)/, "errors.noPermission"],
  [/sem resposta em (?<s>\d+)s/, "errors.noReplyIn"],
  [/servidor encerrado/, "errors.serverClosed"],
  [/sessão encerrada/, "errors.sessionEnded"],
  [/sessão (?<s>\S+) não existe mais/, "errors.sessionGone"],
  [/sessão (?<s>\S+) não encontrada/, "errors.sessionNotFound"],
  [/só stdio é medido \(http precisa de login\/sessão\)/, "errors.stdioOnly"],
  [/tecla desconhecida: (?<k>\S+)/, "errors.unknownKey"],
  [/workspace não encontrado/, "errors.workspaceNotFound"],
  [/workspace sem pasta/, "errors.workspaceNoFolder"],
  [/(?<p>\S+) não é um arquivo/, "errors.notAFile"],
  [/(?<p>\S+) não existe/, "errors.notExists"],
  [/(?<what>.+?) com caracteres inválidos \(cole só o token, sem espaços ou aspas\)/, "errors.badChars"],
  [/(?<p>\S+) já existe\. Escolha outro local\./, "errors.alreadyExists"],
  [/nenhum run script configurado/, "errors.noRunScript"],
  [/nenhum script de (?<which>\S+) configurado/, "errors.noScript"],
  [/nenhum login em andamento/, "errors.noLogin"],
  [/MCP (?<name>\S+) não encontrado/, "errors.mcpNotFound"],
  [/app não instalado/, "errors.appNotInstalled"],
  [/Sem conexão com o servidor de atualizações; tente mais tarde\./, "errors.updateNoConn"],
  [/Não deu para procurar atualizações:/, "errors.updateFailed"],
  [/Nenhuma atualização pendente; procure de novo\./, "errors.updateNone"],
  [/Não foi possível verificar agora\./, "errors.updateNotNow"],
  [/endpoint de push precisa ser https/, "errors.pushHttps"],
  [/serviço de push desconhecido/, "errors.pushUnknown"],
  [/método não aceito/, "errors.methodNotAllowed"],
  [/content-type precisa ser application\/json/, "errors.contentType"],
  [/cabeçalho grande demais/, "errors.headerTooBig"],
  [/conectando ao kabuld/, "errors.connectingKabuld"],
  [/arquivo sem nome/, "errors.unnamedFile"],
  [/harness sem modo por turno/, "errors.noTurnMode"],
  [/tailscale serve terminou, mas não aponta para (?<target>\S+)\. Estado do serve:/, "errors.tsServeMismatch"],
  // Prefixos de contexto (anyhow .context): o detalhe depois de ":" continua como veio.
  [/gravando no cofre do sistema/, "errors.ctxKeychainWrite"],
  [/lendo do cofre do sistema/, "errors.ctxKeychainRead"],
  [/cofre do sistema/, "errors.ctxKeychain"],
  [/carregando o modelo/, "errors.ctxLoadingModel"],
  [/^lendo (?<p>[^:]+)(?=:|$)/, "errors.ctxReading"],
  [/^gravando (?<p>[^:]+)(?=:|$)/, "errors.ctxWriting"],
  [/^criando (?<p>[^:]+)(?=:|$)/, "errors.ctxCreating"],
  [/^iniciando (?<p>[^:]+)(?=:|$)/, "errors.ctxStarting"],
  [/^salvando (?<p>[^:]+)(?=:|$)/, "errors.ctxSaving"],
  [/^apagando (?<p>[^:]+)(?=:|$)/, "errors.ctxDeleting"],
  [/saída inesperada de claude auth status/, "errors.noResponseCodexbar"],
];

/** Mensagem de erro do backend no idioma da interface. Aceita Error, string ou qualquer coisa. */
export function trError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
  if (lang() !== "en") return raw;
  for (const [re, key] of BACKEND_ERRORS) {
    const m = re.exec(raw);
    if (m) {
      const vars = { ...(m.groups ?? {}) };
      // O resto da mensagem (detalhe técnico depois do padrão) continua visível.
      const rest = raw.slice(m.index + m[0].length).trim();
      const before = raw.slice(0, m.index).trim();
      const head = t(key, vars);
      return [before, head, rest].filter(Boolean).join(" ");
    }
  }
  return raw;
}
