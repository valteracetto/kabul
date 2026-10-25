[English](../../guide/integrations.md) · Português

# Integrações

## GitHub

O Kabul usa o GitHub CLI (`gh`). **Configurações › Contas › GitHub** entra com código de dispositivo, troca de conta e guarda um token pessoal opcional no chaveiro do sistema. Quando a conta ativa não acessa um repositório, o workspace mostra um aviso com o link para resolver. Clonar repositórios privados usa a mesma conta.

## Linear

Conecte com uma chave de API pessoal em **Configurações › Integrações**. Crie workspaces a partir de issues (`⌘⇧N` › Issues), mencione issues com `@` e feche-as pela descrição do pull request.

**Por que chave pessoal e não "Entrar com o Linear" (OAuth)?** O OAuth do Linear exige um app OAuth registrado no Linear (client id e, no fluxo comum, client secret) e uma URL de retorno. O Kabul é local e de código aberto: um client secret embutido no app deixaria de ser secreto, e cada pessoa teria que registrar o próprio app. A chave pessoal dá o mesmo acesso, fica no cofre do sistema (Keychain / Credential Manager) e pode ser revogada no Linear a qualquer momento. Quando houver um app OAuth público do Kabul com PKCE, a volta do login usa o link `kabul://` que o app já trata.


## Links `kabul://`

Os links copiados no app (menus do workspace e da conversa) abrem o lugar certo: `kabul://workspace?id=…&session=…`. Outros programas também podem abrir `kabul://create?repo=<nome>&prompt=<texto>` (opcionais `branch`, `linear_id`) para começar um workspace, e `kabul://settings?tab=git`. Clicar numa notificação do sistema traz o Kabul para a frente na conversa que avisou.

## Rotinas

As **Rotinas** (barra lateral) rodam um prompt num workspace por horário (cron de 5 campos, no mínimo a cada 15 minutos) ou por evento do pull request (checks falharam, merge, comentário novo). Rodam neste computador enquanto o Kabul está aberto; cada execução abre uma conversa nova no workspace. O **Quadro** mostra os workspaces por status; arraste um cartão para mudar.
