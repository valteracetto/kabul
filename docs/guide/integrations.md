English · [Português](../pt-BR/guia/integracoes.md)

# Integrations

## GitHub

Kabul uses the GitHub CLI (`gh`). **Settings › Accounts › GitHub** signs in with a device code, switches between accounts and stores an optional personal token in the system keychain. When the active account cannot access a repository, the workspace shows a warning with a link to fix it. Cloning private repositories uses the same account.

## Linear

Connect with a personal API key in **Settings › Integrations**. Create workspaces from issues (`⌘⇧N` › Issues), mention issues with `@` and close them from the pull request description.

**Why a personal key and not "Sign in with Linear" (OAuth)?** Linear OAuth requires an OAuth app registered with Linear (client id and, in the usual flow, a client secret) plus a redirect URL. Kabul is local and open source: a client secret shipped inside the app would not be secret, and everyone would have to register their own app. A personal key gives the same access, is stored in the system vault (Keychain / Credential Manager) and can be revoked in Linear at any time. Once there is a public Kabul OAuth app with PKCE, the sign-in callback will use the `kabul://` link the app already handles.


## `kabul://` links

Links copied in the app (workspace and chat menus) open the right place: `kabul://workspace?id=…&session=…`. Other programs can also open `kabul://create?repo=<name>&prompt=<text>` (optional `branch`, `linear_id`) to start a workspace, and `kabul://settings?tab=git`. Clicking a system notification brings Kabul to the front on the chat that sent it.

## Routines

**Routines** (sidebar) run a prompt in a workspace on a schedule (5-field cron, at least every 15 minutes) or on a pull request event (checks failed, merged, new comment). They run on this computer while Kabul is open; each run opens a new chat in the workspace. The **Board** shows workspaces by status; drag a card to change it.
