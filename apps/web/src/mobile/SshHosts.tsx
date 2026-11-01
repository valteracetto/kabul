import { useEffect, useState } from "react";
import type { SshEffective, SshOverview, SshTest } from "../api";
import { sshAddress, testLabel } from "../components/ssh";
import { kcall } from "./kabuld";
import { Group, Row } from "./ui";
import { t, type Key } from "../i18n";
import { trError } from "../i18n/errors";

/**
 * Configurações › Hosts SSH no celular: a lista do `~/.ssh/config` do computador, só leitura, e "Testar
 * conexão" (o teste roda no computador). Comandos só do dono no kabuld.
 */
export function SshHosts() {
  const [ov, setOv] = useState<SshOverview | null>(null);
  const [eff, setEff] = useState<Record<string, SshEffective>>({});
  const [err, setErr] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, SshTest | "running">>({});
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    kcall<SshOverview>("ssh_hosts").then((o) => {
      setOv(o);
      const aliases = [...new Set(o.hosts.map((h) => h.alias))];
      if (o.ssh_available && aliases.length) kcall<SshEffective[]>("ssh_effective", { aliases }).then((l) => setEff(Object.fromEntries(l.map((x) => [x.alias, x]))), () => {});
    }, (e) => setErr(trError(String(e))));
  }, []);
  const test = (alias: string) => {
    setTests((x) => ({ ...x, [alias]: "running" }));
    kcall<SshTest>("ssh_test", { alias }).then((r) => setTests((x) => ({ ...x, [alias]: r })), (e) => setTests((x) => ({ ...x, [alias]: { ok: false, kind: "other", message: trError(String(e)), ms: 0, command: "" } })));
  };
  if (err) return <Group footer={err}><Row title={t("common.error")} /></Group>;
  if (!ov) return <Group><Row title={t("common.loading")} /></Group>;
  const files = [...new Set(ov.hosts.map((h) => h.file_display))];
  return (
    <>
      {ov.hosts.length === 0 && <Group footer={t("ssh.mobile.footer")}><Row title={t("ssh.mobile.empty")} /></Group>}
      {files.map((f, i) => (
        <Group key={f} header={t("ssh.from", { file: f })} footer={i === files.length - 1 ? t("ssh.mobile.footer") : undefined}>
          {ov.hosts.filter((h) => h.file_display === f).map((h) => {
            const r = tests[h.alias];
            const status = r === "running" ? t("ssh.test.running") : r ? testLabel(r) : undefined;
            return (
              <div key={h.alias} data-testid="m-ssh-row">
                <Row title={h.alias} sub={sshAddress(h, eff[h.alias])} value={status && <span style={r && r !== "running" ? { color: r.ok ? "var(--m-green)" : "var(--m-red)" } : undefined} data-testid="m-ssh-status">{status}</span>} chevron onClick={() => setOpen(open === h.alias ? null : h.alias)} testid="m-ssh-open" />
                {open === h.alias && (
                  <>
                    <Row title={t("ssh.test.action")} onClick={() => test(h.alias)} disabled={r === "running"} testid="m-ssh-test" />
                    {r && r !== "running" && !r.ok && <Row title={t(`ssh.hint.${r.kind}` as Key)} sub={<span style={{ whiteSpace: "pre-wrap" }}>{r.message}</span>} testid="m-ssh-error" />}
                  </>
                )}
              </div>
            );
          })}
        </Group>
      ))}
    </>
  );
}
