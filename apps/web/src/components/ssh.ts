import type { SshEffective, SshHost, SshTest } from "../api";
import { t, type Key } from "../i18n";

/** Alias com aspas de sh só quando precisa (igual ao `shell_quote` do core). */
const quote = (alias: string) => (/^[A-Za-z0-9_\-./=:@%+,]+$/.test(alias) ? alias : `'${alias.replace(/'/g, "'\\''")}'`);

/** `ssh <alias>` para copiar e colar. */
export const sshCommand = (alias: string) => `ssh ${quote(alias)}`;

/** `user@host:porta` com o que estiver no bloco; o que faltar vem do `ssh -G` (valor efetivo). */
export function sshAddress(h: SshHost, e?: SshEffective) {
  const host = h.hostname ?? e?.hostname ?? h.alias;
  const user = h.user ?? e?.user;
  const port = h.port ?? e?.port;
  return `${user ? `${user}@` : ""}${host}${port ? `:${port}` : ""}`;
}

/** Rótulo do resultado do teste (o erro real do ssh vai no detalhe). */
export const testLabel = (r: SshTest) => (r.ok ? t("ssh.test.okMs", { ms: r.ms }) : t(`ssh.test.${r.kind}` as Key));
