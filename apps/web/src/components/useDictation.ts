import { useCallback, useRef, useState } from "react";
import { api } from "../api";

type SR = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null };

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Ditado em pt-BR. No desktop: grava (MediaRecorder) e transcreve offline com whisper no backend.
 * No navegador/PWA: Web Speech API quando existir; senão o mesmo caminho de gravação.
 */
export function useDictation(onText: (t: string) => void, onError: (e: string) => void) {
  const [state, setState] = useState<"idle" | "listening" | "transcribing">("idle");
  const rec = useRef<MediaRecorder | null>(null);
  const sr = useRef<SR | null>(null);

  const startRecorder = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setState("transcribing");
      try {
        const blob = new Blob(chunks, { type: r.mimeType });
        const ext = r.mimeType.includes("mp4") ? "m4a" : r.mimeType.includes("ogg") ? "ogg" : "webm";
        const text = await api.transcribe(Array.from(new Uint8Array(await blob.arrayBuffer())), ext);
        if (text.trim()) onText(text.trim());
      } catch (e) {
        onError(`Ditado: ${e}`);
      } finally {
        setState("idle");
      }
    };
    r.start();
    rec.current = r;
    setState("listening");
  };

  const startSpeech = (Ctor: new () => SR) => {
    const s = new Ctor();
    s.lang = "pt-BR";
    s.continuous = true;
    s.interimResults = false;
    s.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim());
    };
    s.onerror = (e) => onError(`Ditado: ${e.error}`);
    s.onend = () => setState("idle");
    s.start();
    sr.current = s;
    setState("listening");
  };

  const toggle = useCallback(async () => {
    if (state === "transcribing") return;
    if (state === "listening") {
      rec.current?.state === "recording" && rec.current.stop();
      sr.current?.stop();
      rec.current = null;
      sr.current = null;
      return;
    }
    try {
      const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
      if (!isTauri && Ctor) startSpeech(Ctor);
      else await startRecorder();
    } catch (e) {
      onError(`Microfone: ${e}`);
      setState("idle");
    }
  }, [state, onText, onError]);

  return { state, toggle };
}
