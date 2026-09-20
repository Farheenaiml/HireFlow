import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useApp } from "../App";
import { Empty, GROUP_STYLE, Icon, Meter, ScoreDial, Spinner, Tag, useToast } from "../components/ui";

const GROUPS = ["Strong", "Potential", "Weak"] as const;

export default function Board() {
  const { jobId, reveal } = useApp();
  const [job, setJob] = useState<any>(null);
  const [cands, setCands] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [drag, setDrag] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  const timer = useRef<any>(null);

  const load = useCallback(async () => {
    if (!jobId) return;
    const [j, c] = await Promise.all([api.job(jobId), api.candidates(jobId, reveal)]);
    setJob(j);
    setCands(c.candidates);
    setRunning(c.running);
  }, [jobId, reveal]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    clearInterval(timer.current);
    if (running) timer.current = setInterval(() => load().catch(() => {}), 2000);
    return () => clearInterval(timer.current);
  }, [running, load]);

  const upload = async (files: FileList | File[]) => {
    setBusy("upload");
    setMsg("");
    try {
      const r = await api.upload(jobId!, Array.from(files));
      const warn = r.candidates.flatMap((c: any) => c.warnings);
      const redactions = r.candidates.reduce((a: number, c: any) => a + (c.redactions || 0), 0);
      setMsg(
        `${r.candidates.length} resume(s) ingested · ${redactions} personal details stripped before screening.` +
          (warn.length ? ` ${warn[0]}` : "")
      );
      toast(`${r.candidates.length} resume(s) ingested and redacted`);
      await load();
    } catch (e: any) {
      setMsg(e.message);
      toast(e.message, "err");
    } finally {
      setBusy("");
    }
  };

  const run = async (force = false) => {
    setBusy("run");
    setMsg("");
    try {
      const r = await api.runScreening(jobId!, force);
      setRunning(true);
      toast(r.orchestrator === "n8n" ? "Screening handed to n8n" : "Screening started");
      await load();
    } catch (e: any) {
      setMsg(e.message);
      toast(e.message, "err");
    } finally {
      setBusy("");
    }
  };

  const toggleSel = (label: string) =>
    setSel((s) => (s.includes(label) ? s.filter((x) => x !== label) : [...s, label].slice(-3)));

  if (!jobId) {
    return (
      <Empty
        title="No role selected"
        body="Set up a role first — the board needs requirements to screen against."
        action={
          <button className="btn-primary" onClick={() => nav("/role")}>
            Set up a role
          </button>
        }
      />
    );
  }

  const screened = cands.filter((c) => c.score != null).length;
  const pending = cands.filter((c) => ["ingested", "queued", "error"].includes(c.status)).length;
  const progress = cands.length ? Math.round((100 * screened) / cands.length) : 0;
  const visible = onlyFlagged ? cands.filter((c) => c.needs_validation_count > 0) : cands;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Candidate pool</p>
          <h1 className="mt-1 font-serif text-[32px] leading-tight">{job?.job?.title || "Candidate board"}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {cands.length} candidates · {screened} screened against {job?.requirements?.length ?? 0} requirements
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {running && <Spinner label="Screening…" />}
          <button
            className={`btn-ghost ${onlyFlagged ? "!border-ochre !text-ochre" : ""}`}
            onClick={() => setOnlyFlagged((v) => !v)}
            aria-pressed={onlyFlagged}
          >
            <Icon name="flag" className="h-4 w-4" />
            Needs validation
          </button>
          <button
            className="btn-ghost"
            disabled={sel.length < 2}
            onClick={() => nav(`/compare?labels=${sel.join(",")}`)}
            title="Tick two or three candidates on the cards below"
          >
            <Icon name="scale" className="h-4 w-4" />
            Compare{sel.length ? ` (${sel.length})` : ""}
          </button>
          {pending > 0 || screened === 0 ? (
            <button
              className="btn-primary"
              onClick={() => run(false)}
              disabled={!cands.length || busy === "run" || running}
            >
              <Icon name="bolt" className="h-4 w-4" />
              Run screening{pending ? ` (${pending})` : ""}
            </button>
          ) : (
            <button
              className="btn-ghost"
              onClick={() => run(true)}
              disabled={busy === "run" || running}
              title="Re-screens everyone. Your manual overrides are kept."
            >
              <Icon name="refresh" className="h-4 w-4" />
              Re-screen all
            </button>
          )}
        </div>
      </header>

      {(running || (cands.length > 0 && screened < cands.length)) && (
        <div className="card animate-rise px-5 py-3.5">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-medium">
              {running ? "Screening in progress" : "Screening incomplete"}
            </span>
            <span className="tabular-nums text-ink-500">
              {screened} / {cands.length}
            </span>
          </div>
          <div className="mt-2">
            <Meter value={progress} />
          </div>
          <p className="mt-1.5 text-[12px] text-ink-300">
            Each candidate is screened one at a time with a pause between calls, so a provider rate limit slows
            the run instead of failing it.
          </p>
        </div>
      )}

      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files);
        }}
        className={`card flex flex-wrap items-center justify-between gap-4 border-2 border-dashed p-5 transition-all ${
          drag ? "scale-[1.01] border-teal bg-teal-light/40" : "border-ink/[.12]"
        }`}
      >
        <div className="flex items-center gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-light text-teal">
            <Icon name="download" className="h-5 w-5 rotate-180" />
          </span>
          <div>
            <p className="font-medium">Add resumes</p>
            <p className="mt-0.5 text-[13px] text-ink-500">
              Drop PDF, DOCX or TXT files here. Contact details, names and institutions are stripped before
              anything is screened.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {busy === "upload" && <Spinner />}
          <label className="btn-ghost cursor-pointer">
            Choose files
            <input
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.docx,.txt,.md"
              onChange={(e) => e.target.files && upload(e.target.files)}
            />
          </label>
        </div>
        {msg && <p className="w-full text-[13px] text-ink-500">{msg}</p>}
      </section>

      {cands.length === 0 ? (
        <Empty
          title="The pool is empty"
          body="Upload a few resumes to start. Nothing is sent anywhere until you run screening."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {GROUPS.map((g) => {
            const list = visible
              .filter((c) => c.group === g)
              .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
            return (
              <section key={g} className="min-w-0">
                <header className="mb-2 flex items-baseline justify-between">
                  <h2 className="flex items-center gap-2 font-medium">
                    <span className={`h-2.5 w-2.5 rounded-full ${GROUP_STYLE[g].bar}`} />
                    {g}
                    <span className="text-[13px] font-normal tabular-nums text-ink-300">{list.length}</span>
                  </h2>
                </header>
                <p className="mb-3 text-[12px] leading-snug text-ink-300">{GROUP_STYLE[g].note}</p>
                <ul className="space-y-3 stagger">
                  {list.map((c) => (
                    <CandidateCard
                      key={c.candidate_id}
                      c={c}
                      group={g}
                      selected={sel.includes(c.label)}
                      onSelect={() => toggleSel(c.label)}
                      onOpen={() => nav(`/candidate/${c.candidate_id}`)}
                    />
                  ))}
                  {list.length === 0 && (
                    <li className="rounded-xl border border-dashed border-ink/15 px-4 py-7 text-center text-[13px] text-ink-300">
                      Nobody here yet
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {cands.some((c) => c.score == null) && (
        <section className="card p-5">
          <h2 className="font-medium">Waiting to be screened</h2>
          <ul className="mt-3 divide-y divide-ink/10">
            {cands
              .filter((c) => c.score == null)
              .map((c) => (
                <li key={c.candidate_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="flex items-center gap-3">
                    <span className="font-medium">{c.display_name || c.label}</span>
                    <span className="font-mono text-[11.5px] text-ink-300">{c.file_name}</span>
                  </span>
                  <span className="flex items-center gap-3 text-[12px] text-ink-500">
                    {c.status === "processing" ? <Spinner label="Screening" /> : <Tag tone="slate">{c.status}</Tag>}
                    {c.warnings?.length > 0 && (
                      <Tag tone="ochre">
                        <span title={c.warnings[0]}>needs text version</span>
                      </Tag>
                    )}
                    {c.error && <span className="text-brick">{c.error.slice(0, 60)}</span>}
                    {c.status === "error" && (
                      <button className="btn-ghost !px-2.5 !py-1 text-[12px]" onClick={() => run(false)}>
                        Retry
                      </button>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CandidateCard({
  c,
  group,
  onOpen,
  selected,
  onSelect,
}: {
  c: any;
  group: string;
  onOpen: () => void;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="relative">
      <label className="absolute right-3 top-3 z-10 flex cursor-pointer items-center gap-1.5 rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] text-ink-500 backdrop-blur">
        <input
          type="checkbox"
          className="accent-teal"
          checked={selected}
          onChange={onSelect}
          aria-label={`Select ${c.display_name || c.label} for comparison`}
        />
        compare
      </label>
      <button
        onClick={onOpen}
        className={`card card-hover relative w-full overflow-hidden p-4 text-left ${
          selected ? `ring-2 ${GROUP_STYLE[group]?.ring || "ring-teal/30"}` : ""
        }`}
      >
        <span className={`absolute inset-x-0 top-0 h-1 ${GROUP_STYLE[group]?.bar}`} />
        <div className="flex items-start gap-3">
          <ScoreDial value={c.score} size={54} />
          <div className="min-w-0 flex-1 pr-16">
            <p className="truncate font-medium">{c.display_name || c.label}</p>
            <p className="truncate font-mono text-[11px] text-ink-300">{c.file_name}</p>
          </div>
        </div>
        <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-ink-700">{c.summary}</p>
        <p className="mt-2.5 text-[12px] text-ink-500">{c.rationale}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-ink/10 pt-3">
          {c.needs_validation_count > 0 && <Tag tone="ochre">{c.needs_validation_count} to validate</Tag>}
          {c.has_kit && <Tag tone="plum">Interview kit</Tag>}
          {c.has_interview && !c.decision && <Tag tone="forest">Interviewed</Tag>}
          {c.decision && <Tag tone="teal">Decision: {c.decision}</Tag>}
        </div>
      </button>
    </li>
  );
}
