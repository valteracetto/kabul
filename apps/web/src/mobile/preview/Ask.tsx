import { useEffect, useState } from "react";
import { Sheet } from "../ui";
import { AGENT_LABEL } from "../kabuld";
import { ext, files, type ChatSummary } from "./api";
import type { AskTarget } from "./Viewer";

const MAX_LINES = 200;
const MAX_CHARS = 12_000;

/** Mensagem com o trecho citado (caminho:linhas e bloco de código). */
export function askMessage(t: AskTarget, question: string): string {
  let body = t.text.split("\n").slice(0, MAX_LINES).join("\n");
  if (body.length > MAX_CHARS) body = body.slice(0, MAX_CHARS) + "\n…";
  const cut = t.text.split("\n").length > MAX_LINES || t.text.length > MAX_CHARS ? " (trecho cortado)" : "";
  const where = t.a === t.b ? `${t.path}:${t.a}` : `${t.path}:${t.a}-${t.b}`;
  const fence = body.includes("```") ? "````" : "```";
  return `Sobre \`${where}\`${cut}:\n${fence}${ext(t.path)}\n${body}\n${fence}\n\n${question.trim()}`;
}

/** "Perguntar sobre isto": manda o trecho e a pergunta para um chat do workspace e abre a conversa. */
export function AskSheet({ ws, target, from, onClose }: { ws: string; target: AskTarget; from: string | null; onClose: () => void }) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [chat, setChat] = useState<string>(from?.startsWith("chat:") ? from.slice(5) : "");
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    files.chats(ws).then((l) => (setChats(l), setChat((c) => (c && l.some((x) => x.id === c) ? c : l[l.length - 1]?.id ?? ""))), (e) => setErr(String(e?.message ?? e)));
  }, [ws]);
  const send = async () => {
    if (!chat || !q.trim()) return;
    setBusy(true);
    try {
      await files.send(chat, askMessage(target, q));
      onClose();
      location.hash = `s=${encodeURIComponent(`chat:${chat}`)}`;
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  };
  const lines = target.a === target.b ? `linha ${target.a}` : `linhas ${target.a}–${target.b}`;
  return (
    <Sheet title="Perguntar no chat" onClose={onClose} testid="pv-ask-sheet">
      <div className="pv-ask">
        <div className="dim small"><code>{target.path}</code> · {lines}</div>
        <pre className="pv-ask-snippet">{target.text.split("\n").slice(0, 8).join("\n")}{target.text.split("\n").length > 8 ? "\n…" : ""}</pre>
        {chats && chats.length === 0 && <div className="dim small" data-testid="pv-ask-nochat">Nenhuma conversa aberta neste workspace. Comece uma pela lista (+ Chat) e volte aqui.</div>}
        {chats && chats.length > 0 && (
          <select value={chat} onChange={(e) => setChat(e.target.value)} data-testid="pv-ask-chat">
            {chats.map((c) => <option key={c.id} value={c.id}>{c.title} · {c.model} ({AGENT_LABEL[c.harness] ?? c.harness})</option>)}
          </select>
        )}
        <textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="O que você quer saber sobre este trecho?" data-testid="pv-ask-text" />
        {err && <div className="m-error">{err}</div>}
        <button className="m-btn primary big" disabled={busy || !chat || !q.trim()} onClick={() => void send()} data-testid="pv-ask-send">{busy ? "Enviando…" : "Enviar para o chat"}</button>
      </div>
    </Sheet>
  );
}
