import { noSuggest } from "../noSuggest";
import { Floating } from "./Floating";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDismiss } from "./useDismiss";
import { EFFORT_LABEL, HARNESS_LABEL, type HarnessKind, type Model } from "../api";
import { IArrowOut, IChevron, IChevronDown, IClose, IDrag, IGear, IPlus, ISearch, ProviderMark } from "../icons";
import type { ModelPrefs } from "./prefs";

interface Props {
  models: Model[];
  prefs: ModelPrefs;
  setPrefs: (f: (p: ModelPrefs) => ModelPrefs) => void;
  selected: Model | null;
  effort: string | null;
  /** Harness da conversa ativa: modelos de outro harness abrem conversa nova. */
  activeHarness: HarnessKind | null;
  /** Escuta ⌘/ para abrir (só a conversa ativa). */
  listen?: boolean;
}

export const kbd = (i: number) => (i === 0 ? "⌃⌘1" : `⌃⌘${i + 1}`);

export function ModelPicker({ models, prefs, setPrefs, selected, effort, activeHarness, listen }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!listen) return;
    const h = (e: KeyboardEvent) => e.metaKey && !e.shiftKey && !e.altKey && e.key === "/" && (e.preventDefault(), setOpen((o) => !o));
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [listen]);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
  }, [open]);
  useDismiss(root, open, useCallback(() => setOpen(false), []));
  useEffect(() => {
    if (!open) (setQ(""), setAdding(false), setEditing(false), setEffortOpen(false));
  }, [open]);

  const favs = useMemo(() => prefs.favorites.map((k) => models.find((m) => m.key === k)).filter(Boolean) as Model[], [prefs.favorites, models]);
  const needle = q.trim().toLowerCase();
  const match = (m: Model) => !needle || `${m.label} ${m.id} ${HARNESS_LABEL[m.harness]}`.toLowerCase().includes(needle);
  const others = models.filter((m) => !prefs.favorites.includes(m.key) && match(m));

  const pick = (m: Model) => {
    setPrefs((p) => ({ ...p, selected: m.key }));
    setOpen(false);
  };
  const move = (from: number, to: number) =>
    setPrefs((p) => {
      const f = [...p.favorites];
      const [x] = f.splice(from, 1);
      f.splice(to, 0, x);
      return { ...p, favorites: f };
    });
  const effortOf = (m: Model) => (m.key === selected?.key ? effort : m.efforts.includes(prefs.effort) ? prefs.effort : m.efforts[0]);

  return (
    <div className="picker" ref={root}>
      <button className="picker-trigger" onClick={() => setOpen(!open)}>
        <span>{selected?.label ?? "Modelo"}</span>
        {selected?.local && <span className="local-badge">Local</span>}
        {effort && <span className="dim">{EFFORT_LABEL[effort]}</span>}
        <IChevronDown size={12} />
      </button>
      {open && (
        <Floating className="picker-pop" placement="top-start">
          <label className="pop-search">
            <ISearch />
            <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} ref={search} placeholder="Buscar modelos" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="pop-sep" />
          <div className="pop-list">
            {favs.filter(match).map((m) => {
              const i = prefs.favorites.indexOf(m.key);
              const other = activeHarness && m.harness !== activeHarness;
              return (
                <div key={m.key} className={"pop-row model" + (m.key === selected?.key ? " on" : "") + (drag === i ? " dragging" : "")} draggable={!needle}
                  onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} onDragOver={(e) => { e.preventDefault(); if (drag !== null && drag !== i) { move(drag, i); setDrag(i); } }}
                  onClick={() => pick(m)} title={other ? "Outro agente: abre uma conversa nova" : undefined}>
                  <span className="handle"><IDrag size={14} /></span>
                  <ProviderMark provider={m.provider} />
                  <span className="label">{m.label}</span>
                  {m.local && <span className="local-badge" title={m.local.note}>Local</span>}
                  {effortOf(m) && <span className="dim">{EFFORT_LABEL[effortOf(m)!]}</span>}
                  <span className="grow" />
                  {editing ? (
                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setPrefs((p) => ({ ...p, favorites: p.favorites.filter((k) => k !== m.key) })); }}><IClose size={13} /></button>
                  ) : other ? <span className="kbd-hint"><IArrowOut size={14} /></span> : i < 9 && <span className="kbd-hint">{kbd(i)}</span>}
                </div>
              );
            })}
            {(adding || needle) && others.map((m) => (
              <div key={m.key} className="pop-row model add" onClick={() => (setPrefs((p) => ({ ...p, favorites: [...p.favorites, m.key], selected: m.key })), setOpen(false))}>
                <span className="handle" />
                <ProviderMark provider={m.provider} />
                <span className="label">{m.label}</span>
                {m.local && <span className="local-badge" title={m.local.note}>Local</span>}
                <span className="dim" title={m.local ? `${m.local.source_name} · ${m.local.note}` : undefined}>{m.local ? m.local.source_name : HARNESS_LABEL[m.harness]}</span>
                <span className="grow" />
                <IPlus size={13} />
              </div>
            ))}
            {!needle && (
              <div className={"pop-row add-models" + (adding ? " on" : "")} onClick={() => setAdding(!adding)}>
                <IPlus /> <span>{adding ? "Fechar lista" : "Adicionar modelos"}</span>
                <span className="grow" />
                <IArrowOut size={14} />
              </div>
            )}
          </div>
          <div className="pop-sep" />
          <div className={"pop-row setting" + (selected?.efforts.length ? "" : " disabled")} onMouseEnter={() => selected?.efforts.length && setEffortOpen(true)} onMouseLeave={() => setEffortOpen(false)} onClick={() => selected?.efforts.length && setEffortOpen(true)}>
            <span>Esforço</span>
            <span className="grow" />
            <span className="dim">{effort ? EFFORT_LABEL[effort] : "—"}</span>
            <IChevron size={13} />
            {effortOpen && selected && (
              <Floating className="submenu" placement="right-end">
                {selected.efforts.map((e) => (
                  <div key={e} className={"pop-row" + (e === effort ? " on" : "")} onClick={(ev) => { ev.stopPropagation(); setPrefs((p) => ({ ...p, effort: e })); setEffortOpen(false); }}>
                    {EFFORT_LABEL[e]}
                    <span className="grow" />
                    {e === effort && <span className="check">✓</span>}
                  </div>
                ))}
              </Floating>
            )}
          </div>
          <div className="pop-row setting" onClick={() => setPrefs((p) => ({ ...p, fast: !p.fast }))}>
            <span>Rápido</span>
            <span className="grow" />
            <span className="kbd-hint">⌘⇧E</span>
            <span className={"toggle" + (prefs.fast ? " on" : "")}><span /></span>
          </div>
          <div className="pop-foot">
            <button className="text-btn" onClick={() => setEditing(!editing)}><IGear size={14} /> {editing ? "Concluir" : "Editar"}</button>
            <span className="grow" />
            <kbd>⌘⇧/</kbd> <span className="dim">Alternar esforço</span>
          </div>
        </Floating>
      )}
    </div>
  );
}
