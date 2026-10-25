English · [Português](../pt-BR/guia/seguranca.md)

# Security

Kabul runs coding agents **as your user**: they read and write your repositories, run commands and use your
accounts (GitHub, Linear, AI providers). Whoever controls Kabul controls your computer. So the central question
is always: *who can send a command to Kabul?* This page summarizes the answers. The full threat model, with the
test behind each rule, is in the [security reference](../security.md) (in Portuguese).

**Found a vulnerability?** Please report it privately: GitHub › Security › **Report a vulnerability** on the
repository (see `SECURITY.md`). Never in a public issue.

## Who can do what

| Who | Trust | How they get in |
|---|---|---|
| You in the desktop app | Full | The app window, which can only call the app's own commands |
| Your own paired devices | Owner | Single-use QR code → a key per device |
| Invited **editor** | High, in one workspace | Invite link → a key bound to that workspace |
| Invited **observer** | Read only, in one workspace | Invite link → a key bound to that workspace |
| Websites open in your browser | None | Blocked by Origin, Host and CORS checks |
| Other devices on your tailnet without a key | None | Only the health check and the pairing endpoint (which needs the QR token) |
| The internet | None | `kabuld` never listens outside localhost and your tailnet |
| Text from others (agent replies, issues, PRs, repositories) | None | Treated as data: never becomes a command, HTML or a local link |

## The phone server (`kabuld`)

- Listens only on `127.0.0.1` and your tailnet addresses, never on `0.0.0.0`. HTTPS comes from
  `tailscale serve` with your tailnet's certificate; inside the tailnet traffic is already encrypted.
- Pairing codes are random, single-use and expire in 5 minutes (invites: 30 minutes). Each device gets an id
  and a 256-bit key; only the key's SHA-256 is kept, in the system keychain, and compared in constant time.
- 10 failed attempts from an address block it for 10 minutes.
- Revoking a device deletes its key hash and drops its connections at once; the key is checked on every
  command.
- Guests can only run a closed list of commands, and every target (workspace, chat, terminal) must belong to
  the invited workspace.
- File previews are limited to the worktree (no symlinks out, never `.git/`), guests never see secret files
  (`.env*`, `.npmrc`, keys), and HTML or SVG from the repository is never executed in Kabul's origin.
- The preview of your running app goes through a separate listener (another origin), only to the workspace's
  ports on `127.0.0.1`.

## The desktop app

- A strict Content Security Policy: only the app's own scripts, no inline code or `eval`, no remote images
  except GitHub avatars. Markdown from agents is rendered without HTML, so a reply can't run code or leak data
  through an image URL.
- Links from agents, Linear or PRs only open `http`, `https` and `mailto`; never files, apps or other schemes.
- Processes are started with argument lists, not shell strings. Branch names, clone URLs, remotes and diff
  paths are validated first.
- Secrets (GitHub token, Linear key) live in the system keychain and never appear on a command line. Agent logs
  record environment variable **names**, never values, and mask secret-looking options.

## What Kabul does not protect you from

- **Other users of the same computer.** A local process is treated as the owner. Don't run `kabuld` on a
  shared machine, or set `KABULD_TRUST_LOCAL_BROWSER=0` to require pairing even for the local browser.
- **An editor is almost an owner.** Typing in the terminal and approving tools runs commands as you. Only invite
  as editor someone you would let use your computer.
- **Adding a repository means trusting it.** Its setup/run/archive scripts and the `env` of its versioned
  `.kabul/settings.toml` run when you create a workspace, and the agent reads the repository's instructions
  (prompt injection). Review `.kabul/settings.toml` of repositories you don't trust before the first workspace.
- **Agents get `GH_TOKEN`** in their environment, because they use the `gh` CLI.

## Privacy

- No Kabul account, no Kabul server, no telemetry. Usage numbers stay in local files and contain only metadata
  (provider, model, account, workspace), never prompts, code or paths.
- **Help › Diagnostics** copies a report with personal data removed.
- Dependencies are audited (`cargo audit`, `npm audit`) before each release, and the repository is scanned for
  secrets.
