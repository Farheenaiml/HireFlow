import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useApp } from "../App";
import { Spinner } from "../components/ui";

const CATEGORIES = ["technical_skill", "experience", "domain", "education", "soft_skill", "logistics"];

export default function NewRole() {
  const { jobId, setJobId } = useApp();
  const [title, setTitle] = useState("");
  const [jd, setJd] = useState("");
  const [reqs, setReqs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (!jobId) return;
    api.job(jobId).then((d) => {
      setTitle(d.job.title); setJd(d.job.jd_text); setReqs(d.requirements);
    }).catch(() => {});
  }, [jobId]);

  const analyze = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api.analyzeJD(title || "Untitled role", jd);
      setJobId(r.job_id); setReqs(r.requirements);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const onFile = async (f: File) => {
    setBusy(true); setErr("");
    try {
      const r = await api.analyzeJDFile(title || f.name.replace(/\.[^.]+$/, ""), f);
      setJobId(r.job_id); setReqs(r.requirements);
      const d = await api.job(r.job_id); setJd(d.job.jd_text); setTitle(d.job.title);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const update = (i: number, patch: any) =>
    setReqs((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setBusy(true);
    try {
      await api.saveRequirements(jobId!, reqs);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[32px] leading-tight">Role and requirements</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          The job description becomes a checklist. Everything downstream — evidence, grouping,
          interview questions — is measured against exactly these lines, so edit them until they
          describe the job you are actually hiring for.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
        <section className="card p-5">
          <label className="label" htmlFor="title">Role title</label>
          <input id="title" className="field" value={title} placeholder="Senior Backend Engineer — Payments"
            onChange={(e) => setTitle(e.target.value)} />

          <label className="label mt-4" htmlFor="jd">Job description</label>
          <textarea id="jd" className="field h-72 resize-y font-mono text-[12.5px] leading-relaxed"
            placeholder="Paste the full JD, bullets and all."
            value={jd} onChange={(e) => setJd(e.target.value)} />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={analyze} disabled={busy || jd.trim().length < 60}>
              {busy ? "Reading…" : reqs.length ? "Re-analyse description" : "Extract requirements"}
            </button>
            <label className="btn-ghost cursor-pointer">
              Upload a file
              <input type="file" className="hidden" accept=".pdf,.docx,.txt,.md"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
          </div>
          {err && <p className="mt-3 text-[13px] text-brick">{err}</p>}
        </section>

        <section className="card flex flex-col p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Requirements</h2>
            {reqs.length > 0 && (
              <span className="text-[12px] text-ink-500">
                {reqs.filter((r) => r.priority === "must").length} must-have ·{" "}
                {reqs.filter((r) => r.priority === "nice").length} nice-to-have
              </span>
            )}
          </div>

          {reqs.length === 0 ? (
            <p className="mt-6 text-sm text-ink-300">
              Extract requirements from a description to see them here. You can rewrite, reprioritise
              or delete any of them before screening.
            </p>
          ) : (
            <ul className="mt-4 flex-1 space-y-3">
              {reqs.map((r, i) => (
                <li key={r.req_id} className="rounded-md border border-ink/10 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5 w-7 shrink-0 text-[12px] font-medium text-teal">{r.req_id}</span>
                    <textarea
                      className="field min-h-[54px] resize-y text-[13px]" value={r.text}
                      onChange={(e) => update(i, { text: e.target.value })} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-9">
                    <div className="flex overflow-hidden rounded border border-ink/15 text-[12px]">
                      {["must", "nice"].map((p) => (
                        <button key={p} onClick={() => update(i, { priority: p })}
                          className={`px-2.5 py-1 ${r.priority === p ? "bg-teal text-white" : "text-ink-500 hover:bg-paper-deep"}`}>
                          {p === "must" ? "Must have" : "Nice to have"}
                        </button>
                      ))}
                    </div>
                    <select className="rounded border border-ink/15 bg-white px-2 py-1 text-[12px] text-ink-500"
                      value={r.category} onChange={(e) => update(i, { category: e.target.value })}>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
                    </select>
                    <button className="btn-quiet ml-auto text-[12px]"
                      onClick={() => setReqs((rs) => rs.filter((_, k) => k !== i))}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {reqs.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-4">
              <button className="btn-ghost" onClick={() =>
                setReqs([...reqs, { req_id: `R${reqs.length + 1}`, text: "", priority: "must", category: "experience", keywords: [] }])}>
                Add requirement
              </button>
              <button className="btn-primary" onClick={save} disabled={busy}>Save requirements</button>
              <button className="btn-quiet" onClick={() => nav("/board")}>Go to candidates →</button>
              {busy && <Spinner />}
              {saved && <span className="text-[13px] text-forest">Saved. Marked as human-edited.</span>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
