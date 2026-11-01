English · [Português](../pt-BR/guia/ssh.md)

# SSH hosts

**Settings › More › SSH hosts** lists the hosts in your SSH config, tests the connection, opens `ssh <alias>`
in a Kabul terminal tab and edits the file with a preview. It works with the OpenSSH client that already
comes with macOS, Linux and Windows 10/11.

| System | Config read | Client |
|---|---|---|
| macOS, Linux | `~/.ssh/config` | `ssh` and `ssh-keygen` from the `PATH` |
| Windows | `%USERPROFILE%\.ssh\config` | the system OpenSSH (`C:\Windows\System32\OpenSSH`, optional feature "OpenSSH Client") or one in the `PATH` |

Without the client, the list still shows; testing, the terminal and key generation explain what to install.

## The list

- One group per file: **From ~/.ssh/config** first, then each file pulled in by `Include` (globs and relative
  paths, in the same order `ssh` reads them). The checkbox on the group header selects every host in it.
- Each row: the alias, `user@hostname:port` and the key (`IdentityFile`) by name. Whatever the block doesn't
  set (port 22, user) comes from `ssh -G <alias>`, the value `ssh` will really use after `Host *`, `Match` and
  `Include`.
- `Host` lines with several names list every concrete name. Patterns with `*` or `?`, negations (`!host`) and
  `Match` blocks are **rules**: **… › Show rules** lists them as they are. Kabul doesn't edit them and doesn't
  try to evaluate `Match`.
- A host from an `Include` inside a `Host`/`Match` block is marked **conditional**: it only applies when that
  block matches.
- Click a row for the details: the file and line, every directive of the block (forwards, `ForwardAgent`,
  `ProxyCommand`, the rest), the key type and fingerprint and the effective value when it differs.
- Search filters by alias, address, user, key, `ProxyJump` and comment.

## Actions

On each row (**…**) and in the details:

| Action | What happens |
|---|---|
| **Test connection** | Runs `ssh -o BatchMode=yes -o ConnectTimeout=5 <alias> true`. It never asks for a password or accepts a new host key; on failure it shows the real `ssh` error and a hint: unknown host key, changed host key, permission denied, timed out, address not found, connection refused, no route, key with a passphrase |
| **Open terminal** | A Kabul terminal tab with `ssh <alias>` in the workspace you opened last (the session is `kabul-ssh-<alias>`; when the connection drops it stays in a shell so you can read the error) |
| **Copy command** | `ssh <alias>`, quoted when needed |
| **Open in** | Terminal, iTerm, Warp, Ghostty, Windows Terminal, PowerShell, Git Bash, or VS Code / Cursor / Windsurf with Remote-SSH (`--remote ssh-remote+<alias>`), whichever is installed. Warp, Ghostty, Cursor, Windsurf and the Windows apps are still to be confirmed |
| **Edit** / **Remove** | See below |

With several hosts selected: **Test connection** for all of them and **Copy commands** (one per line).

The phone (Settings › SSH hosts, owner only) shows the same list read-only and can test the connection: the
test runs on the computer.

## Adding, editing and removing

**Add host** asks for alias, address (`HostName`), user, port, key and `ProxyJump`. The key comes from the list
of keys in `~/.ssh` (type and fingerprint), from **Choose file…** or typed in; only the path goes into the
config. **Review changes** shows the diff before anything is written:

- only the block you touched changes; comments, blank lines, indentation, `Key=value`, quotes, line endings
  (CRLF on Windows) and every other block stay byte for byte the same;
- editing changes only the value of the lines that changed; an empty field removes that line; a new field goes
  at the end of the block with the block's own indentation;
- a new host goes right after the last concrete host of the file (before `Host *` and `Match` blocks at the
  end), so the values you typed win over the generic rules;
- removing a name from a `Host a b` line keeps the block for the other name; removing a whole block takes its
  comment lines along and keeps section separators;
- a host from an included file is edited in that file.

**Save** first copies the file to `config.bak-kabul-<date>-<time>` next to it, writes to a temporary file with
mode 0600 and swaps it in at once (`~/.ssh` is created with 0700 if missing). A symlinked config (dotfiles) is
written through the link. If the file changed after the preview, saving is refused and you review again.

## Keys

Kabul never opens private keys. It lists `~/.ssh/*.pub` (type, bits, fingerprint, the same as
`ssh-keygen -lf`) and `id_*` files without a `.pub`, by name only.

**… › Generate ed25519 key…** runs `ssh-keygen -t ed25519` into `~/.ssh/<name>` after you confirm, without a
passphrase and never over an existing file. For a key with a passphrase, run `ssh-keygen` in a terminal: the
passphrase never goes through Kabul.

## Safety

- Commands only accept aliases that exist as concrete hosts in your config; nothing that starts with `-`
  reaches the `ssh` command line.
- The test and `ssh -G` have a time limit and never prompt. `ssh -G` may run a `Match exec` from your own
  config, as `ssh` itself would.
- `ForwardAgent yes` shows a warning in the details: whoever is root on that server can use your agent while
  you're connected.
- Over kabuld (another machine or the phone), listing and testing are owner-only; guests never see them.

Using an SSH host as a Kabul machine (files, terminals, git, worktrees and agents running there) is a separate
step, not available yet.
