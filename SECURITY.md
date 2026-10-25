# Security policy

English · [Português](#política-de-segurança)

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub: **Security › Report a vulnerability** on this repository (private
vulnerability reporting). Include:

- the affected component (desktop app, `kabuld`, `kabul` CLI, mobile PWA) and version or commit;
- steps to reproduce, or a proof of concept;
- the impact you expect (for example: "a website can run commands", "a guest can read another workspace").

What to expect:

- acknowledgement within 3 business days;
- an assessment and a fix plan within 10 business days;
- credit in the release notes, if you want it, once a fix is released.

Please give us a reasonable time to ship a fix before disclosing. Test only against your own machines and
accounts; do not access data that is not yours.

## Supported versions

Only the latest release (and `main`) receives security fixes while the project is pre-1.0.

## Scope

The threat model, the decisions behind it and the accepted risks are in [docs/security.md](docs/security.md).
In short, these are in scope: anything that lets a website, a network peer, a revoked device or a guest do
more than intended; command or argument injection; reading files outside a workspace; leaking tokens.
Out of scope: attacks that need another local user account on the same computer, and code that you
deliberately run (repository setup scripts, agent tool calls you approve).

---

# Política de segurança

## Como reportar uma vulnerabilidade

**Não abra issue pública** para problemas de segurança.

Reporte em particular pelo GitHub: **Security › Report a vulnerability** neste repositório. Inclua:

- o componente (app desktop, `kabuld`, CLI `kabul`, PWA do celular) e a versão ou o commit;
- os passos para reproduzir, ou uma prova de conceito;
- o impacto esperado (ex.: "um site consegue rodar comandos", "um convidado lê outro workspace").

O que esperar:

- confirmação em até 3 dias úteis;
- avaliação e plano de correção em até 10 dias úteis;
- crédito nas notas da versão, se quiser, quando a correção sair.

Dê um prazo razoável para a correção antes de divulgar. Teste só nas suas máquinas e contas.

## Versões com correção

Antes da 1.0, só a última versão (e a `main`) recebem correções de segurança.

## Escopo

O modelo de ameaças, as decisões e os riscos aceitos estão em [docs/security.md](docs/security.md).
