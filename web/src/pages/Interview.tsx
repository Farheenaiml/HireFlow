import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { EvidenceQuote, Icon, Meter, Spinner, StatusChip, Tag, useToast } from "../components/ui";

const COVERAGE: Record<string, { chip: string; label: string }> = {
  covered: { chip: "bg-forest-light text-forest", label: "Covered" },
  partial: { chip: "bg-ochre-light text-ochre", label: "Partly covered" },
  not_covered: { chip: "bg-brick-light text-brick", label: "Not covered" },
};

function checklistItems(value: unknown): string[] {
  if (Array.isArray(value)) {
    const parts = value.map((item) => String(item ?? ""));
    if (parts.length > 1 && parts.every((item) => [...item].length === 1)) {
      return [parts.join("").trim()].filter(Boolean);
    }
    return value
      .flatMap((item) => Array.isArray(item) ? item : [item])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export default function Interview() {
  const { id } = useParams();
  const [cand, setCand] = useState<any>(null);
  const [kit, setKit] = useState<any>(null);
  const [iv, setIv] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [decision, setDecision] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [author, setAuthor] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [asked, setAsked] = useState<Record<string, boolean>>({});
  const toast = useToast();

  const load = async () => {
    const [c, i] = await Promise.all([api.candidate(id!), api.interview(id!)]);
    setCand(c.candidate);
    setKit(i.kit);
    setIv(i.interview);
    if (i.interview?.notes_raw) setNotes(i.interview.notes_raw);
    if (i.interview?.decision) {
      setDecision(i.interview.decision);
      setDecisionNote(i.interview.decision_note || "");
    }
    if (i.interview?.report?.interviewer_rating != null) setRating(i.interview.report.interviewer_rating);
  };
  useEffect(() => {
    load().catch(() => {});
  }, [id]);

  const buildKit = async () => {
    setBusy("kit");
    setErr("");
    try {
      const r = await api.kit(id!);
      setKit(r.kit);
      toast("Interview kit generated");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const loadSampleNotes = async () => {
    setBusy("sample");
    try {
      const r = await api.demoNotes(id!);
      if (r.notes) {
        setNotes(r.notes);
        toast("Sample interview notes loaded");
      } else {
        toast("No sample notes exist for this candidate", "err");
      }
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy("");
    }
  };

  const evaluate = async () => {
    setBusy("eval");
    setErr("");
    try {
      await api.evaluateInterview(id!, notes);
      await load();
      toast("Evaluation report generated");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const decide = async () => {
    setBusy("decide");
    try {
      await api.decide(id!, decision, decisionNote, author || "recruiter", rating);
      await load();
      toast(`Decision recorded: ${decision}`);
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy("");
    }
  };

  if (!cand) return <Spinner label="Loading" />;
  const report = iv?.report;
  const followups: any[] = iv?.followups || [];
  const cs = report?.coverage_summary;
  const coveragePct = cs && cs.total ? Math.round((100 * (cs.covered + cs.partial * 0.5)) / cs.total) : 0;

  return (
    <div className="space-y-6">
      <Link to={`/candidate/${id}`} className="inline-flex items-center gap-1.5 text-[13px] text-ink-500 hover:text-ink print:hidden">
        <Icon name="arrow" className="h-3.5 w-3.5 rotate-180" /> Back to candidate
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Interview intelligence</p>
          <h1 className="mt-1 font-serif text-[32px] leading-tight">Interview workspace</h1>
          <p className="mt-1 text-sm text-ink-500">
            {cand.display_name || cand.label} · questions target exactly the evidence gaps found during screening
          </p>
        </div>
        <button className="btn-ghost print:hidden" onClick={() => window.print()}>
          <Icon name="download" className="h-4 w-4" /> Print report
        </button>
      </header>

      {err && (
        <p className="rounded-lg border border-brick/25 bg-brick-light/50 px-4 py-2.5 text-[13px] text-brick">{err}</p>
      )}

      {/* ---------------------------------------------- kit */}
      <section className="card p-5 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Interview kit</h2>
            <p className="mt-0.5 text-[13px] text-ink-500">
              One question per unresolved requirement, with the gap it closes and what a good answer sounds like.
            </p>
          </div>
          <button className="btn-ghost" onClick={buildKit} disabled={busy === "kit"}>
            {busy === "kit" ? "Writing…" : kit ? "Regenerate" : "Generate questions"}
          </button>
        </div>

        {!kit ? (
          <p className="mt-4 rounded-lg border border-dashed border-ink/15 px-4 py-6 text-center text-[13px] text-ink-300">
            No kit yet. Generate one and HireFlow will write questions grounded in this candidate's screening gaps.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {kit.questions?.map((q: any, i: number) => (
              <article
                key={i}
                className="rounded-xl border border-ink/10 bg-white/60 p-4 transition-colors hover:border-teal/25"
              >
                <div className="flex items-start gap-3">
                  <label className="mt-0.5 flex shrink-0 cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-teal"
                      checked={!!asked[`q${i}`]}
                      onChange={() => setAsked((a) => ({ ...a, [`q${i}`]: !a[`q${i}`] }))}
                      aria-label={`Mark question ${i + 1} as asked`}
                    />
                    <Tag tone="teal">{q.req_id}</Tag>
                  </label>
                  <div className="min-w-0 flex-1">
                    <p className={`font-serif text-[17px] leading-snug ${asked[`q${i}`] ? "text-ink-300 line-through" : ""}`}>
                      {q.question}
                    </p>
                    <p className="mt-1.5 text-[13px] text-ink-500">{q.why_asked}</p>
                    <div className="mt-2"><EvidenceQuote label="Resume evidence" quote={q.evidence_quote} /></div>
                    <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="min-w-0 rounded-lg bg-plum-light/50 px-3 py-2.5">
                        <p className="label !mb-1 text-plum">Probe further with</p>
                        <ul className="space-y-1 text-[13px] text-ink-700">
                          {checklistItems(q.probes).map((p, k) => (
                            <li key={k} className="flex w-full min-w-0 gap-1.5">
                              <span className="shrink-0 text-plum">→</span>
                              <span className="min-w-0 flex-1 whitespace-normal break-normal">{p}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="min-w-0 rounded-lg bg-forest-light/50 px-3 py-2.5">
                        <p className="label !mb-1 text-forest">A good answer shows</p>
                        <ul className="space-y-1 text-[13px] text-ink-700">
                          {checklistItems(q.good_answer_signals).map((p, k) => (
                            <li key={k} className="flex w-full min-w-0 gap-1.5">
                              <span className="shrink-0 text-forest">✓</span>
                              <span className="min-w-0 flex-1 whitespace-normal break-normal">{p}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            ))}
            {kit.general_questions?.length > 0 && (
              <div className="rounded-xl bg-paper px-4 py-3">
                <p className="label">General role questions</p>
                <ul className="space-y-1.5 text-[13px] text-ink-700">
                  {kit.general_questions.map((q: any, i: number) => (
                    <li key={i}>· {q.question}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---------------------------------------------- notes */}
      <section className="card p-5 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Interview notes</h2>
            <p className="mt-0.5 max-w-xl text-[13px] text-ink-500">
              Paste raw notes. These notes are the only source used for interview evidence — anything quoted back
              at you can be found in this text.
            </p>
          </div>
          <button className="btn-ghost" onClick={loadSampleNotes} disabled={busy === "sample"}>
            <Icon name="bolt" className="h-4 w-4" />
            {busy === "sample" ? "Loading…" : "Load sample notes"}
          </button>
        </div>
        <textarea
          className="field mt-3 h-52 resize-y font-mono text-[12.5px] leading-relaxed"
          value={notes}
          placeholder="Asked about the ledger service. Candidate said…"
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="btn-primary"
            onClick={evaluate}
            disabled={busy === "eval" || notes.trim().length < 80}
          >
            {busy === "eval" ? "Mapping to requirements…" : "Generate evaluation report"}
          </button>
          <span className="text-[12px] text-ink-300">{notes.trim().length} characters · 80 minimum</span>
          {busy === "eval" && <Spinner />}
        </div>
      </section>

      {/* ---------------------------------------------- follow-up probes (FR-09) */}
      {followups.length > 0 && (
        <section className="card p-5 print:hidden">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">Follow-up probes</h2>
              <p className="mt-0.5 text-[13px] text-ink-500">
                Answers that did not go deep enough. Ask these before closing the loop, then re-run the report.
              </p>
            </div>
            <Tag tone="ochre">{followups.length} open</Tag>
          </header>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {followups.map((f: any, i: number) => (
              <li key={i} className="rounded-xl border border-ochre/25 bg-ochre-light/30 p-4">
                <div className="flex items-center gap-2">
                  <Tag tone="ochre">{f.req_id}</Tag>
                  <span className="text-[12px] text-ink-300">needs deeper validation</span>
                </div>
                <p className="mt-2 font-serif text-[15px] leading-snug text-ink-700">{f.follow_up}</p>
                <button
                  className="btn-quiet mt-2 !px-0 text-[12px] text-teal"
                  onClick={() => {
                    navigator.clipboard?.writeText(f.follow_up);
                    toast("Probe copied");
                  }}
                >
                  Copy question
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------------------------------------------- report */}
      {report && (
        <section className="card p-5" id="evaluation-report">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/10 pb-3">
            <h2 className="font-serif text-[24px]">Standardized evaluation report</h2>
            <p className="font-mono text-[11.5px] text-ink-300">
              {report.header.candidate_label} · {new Date(report.header.generated_at).toLocaleString()} ·{" "}
              {report.header.engine} · prompts {report.header.prompt_version}
            </p>
          </header>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[
              ["Covered", report.coverage_summary.covered, "text-forest"],
              ["Partly covered", report.coverage_summary.partial, "text-ochre"],
              ["Not covered", report.coverage_summary.not_covered, "text-brick"],
              ["Requirements", report.coverage_summary.total, "text-ink"],
            ].map(([l, v, c]: any) => (
              <div key={l} className="rounded-xl border border-ink/10 bg-paper/70 px-3.5 py-3">
                <p className="text-[12px] text-ink-500">{l}</p>
                <p className={`font-serif text-[26px] leading-none tabular-nums ${c}`}>{v}</p>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-[12px] text-ink-500">
              <span>Requirement coverage from this interview</span>
              <span className="tabular-nums">{coveragePct}%</span>
            </div>
            <div className="mt-1.5">
              <Meter value={coveragePct} tone={coveragePct >= 70 ? "forest" : coveragePct >= 40 ? "ochre" : "brick"} />
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-ink/10 text-[11px] uppercase tracking-wide text-ink-300">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Requirement</th>
                  <th className="py-2 pr-3 font-semibold">Resume</th>
                  <th className="py-2 pr-3 font-semibold">Interview evidence</th>
                  <th className="py-2 font-semibold">Coverage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {report.requirement_table.map((row: any) => (
                  <tr key={row.req_id} className="align-top">
                    <td className="py-3 pr-3">
                      <p className="font-medium">
                        {row.req_id}
                        {row.priority === "must" && <span className="ml-1.5 text-[11px] text-brick">must</span>}
                      </p>
                      <p className="text-ink-700">{row.requirement}</p>
                    </td>
                    <td className="py-3 pr-3">
                      <EvidenceQuote label="Resume evidence" quote={row.resume_evidence} empty="No evidence found" />
                      <div className="mt-2"><StatusChip status={row.resume_status} /></div>
                    </td>
                    <td className="py-3 pr-3">
                      <EvidenceQuote label="Interview evidence" quote={row.interview_evidence} empty="No evidence found" />
                      {row.open_question && <p className="mt-1.5 text-[12px] text-ochre">{row.open_question}</p>}
                    </td>
                    <td className="py-3">
                      <span className={`pill ${COVERAGE[row.coverage].chip}`}>{COVERAGE[row.coverage].label}</span>
                      <p className="mt-1 text-[12px] text-ink-300">strength: {row.evidence_strength}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            <Block title="Strengths evidenced" items={report.strengths} tone="forest" />
            <Block title="Concerns" items={report.concerns} tone="ochre" />
            <Block title="Suggested next validation" items={report.next_validation} tone="teal" />
          </div>

          {iv.unanswered?.length > 0 && (
            <div className="mt-5 rounded-xl border border-brick/25 bg-brick-light/40 px-4 py-3">
              <p className="text-[13px] font-medium text-brick">
                Unanswered evaluation areas ({iv.unanswered.length})
              </p>
              <ul className="mt-1.5 space-y-1 text-[13px] text-ink-700">
                {iv.unanswered.map((u: any) => (
                  <li key={u.req_id}>
                    · <span className="font-medium">{u.req_id}</span> {u.text}
                    {u.priority === "must" && <span className="ml-1.5 text-[12px] text-brick">(must have)</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ------------------------- human decision gate (FR-12 / FR-18) */}
          <div className="mt-6 border-t border-ink/10 pt-5">
            <h3 className="font-medium">Recruiter decision</h3>
            <p className="mt-1 max-w-2xl text-[13px] text-ink-500">{report.note}</p>

            <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
              <div>
                <p className="label print:hidden">Decision</p>
                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  {["advance", "hold", "reject"].map((d) => (
                    <button
                      key={d}
                      onClick={() => setDecision(d)}
                      className={`btn capitalize ${
                        decision === d
                          ? "bg-ink text-white shadow-lift"
                          : "border border-ink/15 bg-white/70 text-ink-700 hover:bg-paper-deep"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                  <input
                    className="field max-w-[190px]"
                    placeholder="Your name"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                  />
                </div>
                <textarea
                  className="field mt-3 h-24 resize-y text-[13px] print:hidden"
                  placeholder="Why this decision, in your own words."
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                />
              </div>

              <div className="rounded-xl border border-ink/10 bg-paper/70 p-4">
                <p className="label !mb-2">Interviewer rating</p>
                <p className="mb-2.5 text-[12px] leading-snug text-ink-300">
                  Left blank by the AI on purpose. Only a human sets this.
                </p>
                <div className="flex gap-1.5 print:hidden">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setRating(rating === n ? null : n)}
                      aria-label={`Rate ${n} out of 5`}
                      aria-pressed={rating === n}
                      className={`h-9 w-9 rounded-lg border text-sm font-semibold transition-all ${
                        rating != null && n <= rating
                          ? "border-teal bg-teal text-white"
                          : "border-ink/15 bg-white text-ink-500 hover:border-teal/40"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="mt-2.5 text-[13px]">
                  {rating == null ? (
                    <span className="text-ink-300">Not rated</span>
                  ) : (
                    <span className="font-medium text-teal">{rating} / 5 — set by the interviewer</span>
                  )}
                </p>
                <p className="mt-3 hidden text-[13px] print:block">
                  Interviewer rating: ______ / 5 &nbsp;&nbsp; Decision: ☐ advance ☐ hold ☐ reject
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 print:hidden">
              <button className="btn-primary" onClick={decide} disabled={!decision || busy === "decide"}>
                Record decision
              </button>
              {iv.decision && (
                <span className="pill bg-forest-light text-forest">
                  Recorded: {iv.decision} by {iv.decided_by} on {new Date(iv.decided_at).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Block({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  const bar: Record<string, string> = {
    forest: "border-forest",
    ochre: "border-ochre",
    teal: "border-teal",
  };
  return (
    <div className={`border-l-2 pl-3 ${bar[tone] || "border-ink/20"}`}>
      <p className="label">{title}</p>
      {items?.length ? (
        <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-700">
          {items.map((s, i) => (
            <li key={i}>· {s}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-300">Nothing recorded.</p>
      )}
    </div>
  );
}
