import { useEffect, useState } from "react";
import { api, type Repo, type RepoAvatar } from "../api";
import { RepoMark } from "../icons";

/**
 * Avatar do GitHub por repo, buscado uma vez por sessão (o backend guarda em cache no disco por 7 dias) e
 * compartilhado entre a barra lateral, o celular e as configurações. `undefined` = ainda não pedido.
 */
const cache = new Map<string, RepoAvatar | null>();
const pending = new Map<string, Promise<void>>();
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

function load(id: string, refresh = false): Promise<void> {
  if (!refresh && (cache.has(id) || pending.has(id))) return pending.get(id) ?? Promise.resolve();
  // Sem rede, sem gh ou backend antigo: fica a letra (nada de erro na tela).
  const p = api.repoAvatar(id, refresh).then((a) => void cache.set(id, a ?? null), () => void cache.set(id, cache.get(id) ?? null)).finally(() => (pending.delete(id), notify()));
  pending.set(id, p);
  return p;
}

/** "Atualizar": baixa de novo o avatar do repo (ignora o cache de 7 dias). */
export const refreshRepoAvatar = (id: string) => load(id, true);

/** Esquece o avatar em memória (depois de ligar/desligar "Usar a imagem do GitHub"). */
export function forgetRepoAvatar(id: string) {
  cache.delete(id);
  notify();
}

/** Avatar do GitHub do repo (`null` = sem GitHub ou desligado; `undefined` = carregando). */
export function useRepoAvatar(repo: Pick<Repo, "id" | "github_avatar"> | null | undefined): RepoAvatar | null | undefined {
  const [, tick] = useState(0);
  const id = repo && repo.github_avatar !== false ? repo.id : null;
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    if (id) void load(id);
    return () => void subs.delete(f);
  }, [id]);
  if (!repo) return null;
  if (repo.github_avatar === false) return null;
  return cache.get(repo.id);
}

/**
 * Ícone do repositório. Prioridade: ícone escolhido (emoji) > avatar do dono no GitHub > letra colorida
 * (também enquanto carrega ou offline). `noEmoji`: só avatar/letra (o "nenhum" da grade de emojis).
 */
export function RepoIcon({ repo, name, size = 16, noEmoji }: { repo?: Pick<Repo, "id" | "name" | "icon" | "github_avatar"> | null; name?: string; size?: number; noEmoji?: boolean }) {
  const av = useRepoAvatar(repo);
  const label = repo?.name ?? name ?? "?";
  if (repo?.icon && !noEmoji) return <span className="sec-emoji repo-emoji" style={{ width: size, fontSize: Math.round(size * 0.82) }} data-testid="repo-emoji">{repo.icon}</span>;
  if (av?.data_url) return <img className="repo-mark repo-avatar" src={av.data_url} width={size} height={size} alt="" title={`${av.host}/${av.owner}`} draggable={false} data-testid="repo-avatar" />;
  return <RepoMark name={label} size={size} />;
}
