[English](CONTRIBUTING.md) · Português

# Como contribuir com o Kabul

Estrutura, comandos locais e regras gerais estão no [guia de contribuição](docs/pt-BR/guia/contribuir.md).
Este arquivo trata de commits, versões, changelog, CI e releases.

## Commits: Conventional Commits

Todo assunto de commit segue o [Conventional Commits](https://www.conventionalcommits.org/pt-br/):

```
<tipo>(<escopo opcional>): <descrição>

<corpo opcional>

<rodapés opcionais>
```

| Tipo | Quando | Versão |
|---|---|---|
| `feat` | recurso novo para quem usa | minor |
| `fix` | correção de bug | patch |
| `perf` | mais rápido ou mais leve, mesmo comportamento | patch |
| `refactor` | mudança de código sem mudar comportamento | nenhuma |
| `docs` | só documentação | nenhuma |
| `test` | só testes | nenhuma |
| `build`, `ci` | build, dependências, workflows | nenhuma |
| `chore`, `style` | manutenção, formatação | nenhuma |
| `revert` | desfaz um commit | depende |

- O escopo é a área mexida: `core`, `cli`, `kabuld`, `desktop`, `web`, `mobile`, `docs`, `ci`.
- Mudança incompatível: `feat(core)!: ...` ou um rodapé `BREAKING CHANGE: ...`. Antes da 1.0 ela sobe a versão minor.
- Tipo e escopo sempre em inglês; a descrição pode ser em português ou inglês (o changelog mantém o idioma do commit).
- Exemplos: `feat(desktop): atualização automática com canais estável e beta`, `fix(web): composer mantém o rascunho ao trocar de aba`.

## Versões

O Kabul usa [SemVer](https://semver.org/lang/pt-BR/) com **uma versão para o repo inteiro**. A fonte é
`[workspace.package] version` no `Cargo.toml` da raiz (todos os crates herdam com
`version.workspace = true`). O `scripts/version.mjs` mantém iguais `apps/web/package.json`,
`apps/desktop/package.json`, os lockfiles deles, `apps/desktop/src-tauri/tauri.conf.json` e o `Cargo.lock`:

```sh
node scripts/version.mjs get           # versão atual
node scripts/version.mjs set 0.10.0    # grava em todos os arquivos
node scripts/version.mjs check         # falha se algum divergir (roda no CI)
```

0.x até o Kabul cobrir o uso diário de ponta a ponta; 1.0 quando paridade, Windows e celular estiverem estáveis.

### Formatos em disco e protocolo do kabuld

Os arquivos gravados pelo Kabul levam `schema_version` (`state.json`, `app-settings.json`,
`settings.toml`, `accounts.json` e o transcript canônico). Para mudar um formato, suba a constante dele em
`crates/kabul-core/src/schema.rs`, acrescente a migração `vN -> vN+1` na lista do arquivo e um teste com
um exemplo da versão anterior. Antes de migrar, o original fica em `<arquivo>.v<N>.bak`.

O WebSocket entre o kabuld e os clientes tem versão de protocolo (`schema::PROTOCOL`, espelhada em
`apps/web/src/version.ts`). Suba só quando um lado deixar de entender o outro; campo opcional ou comando
novo não sobem. Cliente antigo demais recebe um aviso amigável para atualizar em vez de erros.

## Changelog

O `CHANGELOG.md` é gerado pelo [git-cliff](https://git-cliff.org) a partir dos commits (`cliff.toml`).
Commits fora do padrão não aparecem. Para ver a próxima versão:

```sh
npx git-cliff --unreleased
```

## CI

`.github/workflows/ci.yml` roda em todo push na `main` e em todo pull request:

- versões iguais (`scripts/version.mjs check`);
- `cargo fmt --check` (estilo no `rustfmt.toml`), `cargo clippy -D warnings` e `cargo test` no macOS e no Windows (o Windows informa mas não bloqueia até o porte chegar, ver `docs/windows.md`);
- `npm ci`, `npm run build` e o E2E do Playwright com o backend mock no Linux e no macOS (`KABUL_E2E_MOCK_ONLY=1` pula os specs `*-real`, que precisam do core de verdade, do `gh` e dos agentes).

A `main` é protegida: mudanças entram por pull request com o CI verde.

## Releases

1. Versão: `node scripts/version.mjs set 0.10.0` (pré-release: `0.10.0-beta.1`).
2. Changelog: `npx git-cliff --unreleased --tag v0.10.0 --prepend CHANGELOG.md` e revise o texto.
3. Commit `chore(release): 0.10.0`, abra o PR e faça o merge.
4. Crie a tag no commit do merge e envie: `git tag v0.10.0 && git push origin v0.10.0`.

O `.github/workflows/release.yml` confere a tag com os manifestos, cria um rascunho de GitHub Release com
a seção do changelog daquela versão e gera o app com o
[tauri-action](https://github.com/tauri-apps/tauri-action): macOS Apple Silicon e Intel (`.app`, `.dmg`)
e Windows (`.msi`, `.exe` do NSIS). Revise o rascunho e publique. Tags com `-` (por exemplo `-beta.1`)
viram pré-release.

### Assinatura (secrets opcionais)

Cada assinatura só roda quando os secrets dela existem; sem eles o build continua.

| Secret | Para quê |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | assina os pacotes de atualização e publica o `latest.json` (atualização automática) |
| `APPLE_CERTIFICATE` (`.p12` em base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | assinatura no macOS (sem ela: assinatura ad-hoc, o Gatekeeper avisa) |
| `APPLE_ID`, `APPLE_PASSWORD` (senha de app), `APPLE_TEAM_ID` | notarização |
| `WINDOWS_CERTIFICATE` (`.pfx` em base64), `WINDOWS_CERTIFICATE_PASSWORD` | assinatura Authenticode dos instaladores |

### Atualização automática

O app usa o `tauri-plugin-updater`. Cada atualização é conferida com a chave pública do
`apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). A chave privada **nunca** entra no
repositório: o mantenedor guarda em `~/.config/kabul/updater.key` (permissão 600, criada com
`npx tauri signer generate -w ~/.config/kabul/updater.key`) e grava o conteúdo como o secret
`TAURI_SIGNING_PRIVATE_KEY` do repositório (`gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.config/kabul/updater.key`).
Se a chave se perder, gere outro par, troque o `pubkey` e distribua uma versão à mão: o app instalado só
aceita atualizações assinadas com a chave que ele conhece.

Canais (Configurações › Avançado › "Atualizações automáticas" e "Canal de atualização"):

- **estável** lê `releases/latest/download/latest.json` (a última release publicada; pré-releases ficam de fora);
- **beta** lê `releases/download/beta/latest.json`: quando qualquer release é publicada, o workflow copia o `latest.json` dela para a pré-release fixa `beta`, então quem está no beta recebe as betas e as estáveis.

O repositório dessas URLs entra no app pela variável `KABUL_UPDATE_REPO` (o CI passa
`github.repository`). A checagem roda alguns segundos depois de abrir, só no app empacotado; sem rede ela só
avisa "sem conexão" e tenta de novo na próxima abertura. A instalação sempre espera o clique de quem usa.
