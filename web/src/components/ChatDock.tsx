import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Icon, Spinner, Tag } from "./ui";

const SUGGESTIONS: { q: string; tag?: string; tone?: string }[] = [
  { q: "Who is strongest on payments and ledger experience?" },
  { q: "Who has evidence for R7?" },
  { q: "Compare C1 and C3" },
  { q: "What still needs validation across the pool?" },
  { q: "Who should we hire?", tag: "declines to decide", tone: "plum" },
  { q: "Which candidates are female?", tag: "guardrail demo", tone: "brick" },
];

export default function ChatDock({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (open) {
      api.chatHistory(jobId).then((r) => setMsgs(r.messages)).catch(() => {});
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [open, jobId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  // Cmd/Ctrl + K opens the dock
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  const send = async (q?: string) => {
    const message = (q ?? text).trim();
    if (!message || busy) return;
    setText("");
    setBusy(true);
    setMsgs((m) => [...m, { msg_id: Math.random(), role: "user", content: message }]);
    try {
      const r = await api.chat(jobId, message);
      setMsgs((m) => [
        ...m,
        {
          msg_id: Math.random(),
          role: "assistant",
          content: r.answer,
          citations: r.citations,
          refused: r.refused,
          engine: r.engine,
        },
      ]);
    } catch (e: any) {
      setMsgs((m) => [...m, { msg_id: Math.random(), role: "assistant", content: e.message, citations: [] }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="group fixed bottom-5 right-5 z-30 flex items-center gap-2.5 rounded-full px-4 py-3 text-sm font-medium text-white shadow-lift transition-transform hover:-translate-y-0.5"
        style={{ backgroundImage: "linear-gradient(135deg,#4F46E5,#4338CA 55%,#6D28D9)" }}
      >
        <Icon name="chat" className="h-4 w-4" />
        Ask the pool
        <kbd className="hidden rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10px] sm:inline">⌘K</kbd>
      </button>
    );
  }

  return (
    <section
      aria-label="Ask the pool"
      className="fixed bottom-5 right-5 z-30 flex h-[560px] w-[400px] max-w-[calc(100vw-2rem)] animate-rise flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-lift"
    >
      <header className="flex items-center justify-between bg-ink-deep px-4 py-3 text-white">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10">
            <Icon name="chat" className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Ask the pool</p>
            <p className="text-[11.5px] text-ink-300">Answers cite the evidence they came from</p>
          </div>
        </div>
        <button className="rounded-md px-2 py-1 text-[12px] text-ink-300 hover:bg-white/10 hover:text-white" onClick={() => setOpen(false)}>
          Hide
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto bg-paper/50 px-4 py-4">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <p className="text-[13px] text-ink-500">Try one of these:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s.q}
                onClick={() => send(s.q)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-ink/10 bg-white px-3 py-2 text-left text-[13px] text-ink-700 transition-all hover:-translate-y-px hover:border-teal/30 hover:shadow-panel"
              >
                <span>{s.q}</span>
                {s.tag && <Tag tone={s.tone}>{s.tag}</Tag>}
              </button>
            ))}
          </div>
        )}

        {msgs.map((m) => (
          <div key={m.msg_id} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                m.role === "user"
                  ? "rounded-br-sm bg-ink text-white"
                  : m.refused
                  ? "rounded-bl-sm border border-brick/25 bg-brick-light/60 text-ink-700"
                  : "rounded-bl-sm border border-ink/10 bg-white text-ink-700"
              }`}
            >
              {m.refused && (
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brick">
                  <Icon name="shield" className="h-3.5 w-3.5" /> Guardrail
                </p>
              )}
              {m.content}
            </div>
            {m.citations?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {m.citations.map((c: any, i: number) => (
                  <button
                    key={i}
                    title={c.why ? `${c.why} — click to open the evidence` : "Open the evidence"}
                    disabled={!c.candidate_id}
                    onClick={() => nav(`/candidate/${c.candidate_id}${c.req_id ? `?req=${c.req_id}` : ""}`)}
                    className="rounded-md bg-teal-light px-1.5 py-0.5 font-mono text-[11px] font-medium text-teal transition-colors hover:bg-teal hover:text-white"
                  >
                    [{c.candidate_label}
                    {c.req_id ? `:${c.req_id}` : ""}]
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm border border-ink/10 bg-white px-3.5 py-2.5">
            <Spinner label="Reading the evidence" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-ink/10 bg-white p-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            className="field"
            value={text}
            placeholder="Ask about the candidates"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="btn-primary !px-3.5" onClick={() => send()} disabled={busy || !text.trim()}>
            <Icon name="arrow" className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-ink-300">
          HireFlow describes evidence. It does not rank people or recommend hires, and it will not answer
          questions about protected attributes.
        </p>
      </div>
    </section>
  );
}
