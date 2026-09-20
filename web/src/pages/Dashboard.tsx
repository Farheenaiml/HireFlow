import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useApp } from "../App";
import {
  AgentProgress,
  CoverageBar,
  GROUP_STYLE,
  GroupChip,
  Icon,
  Meter,
  ScoreDial,
  Spinner,
  STATUS_STYLE,
  Tag,
  useToast,
} from "../components/ui";

export default function Dashboard() {
  const { jobId, setJobId, config } = useApp();
  const [jobs, setJobs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [quality, setQuality] = useState<any>(null);
  const [cands, setCands] = useState<any[]>([]);
  const [busy, setBusy] = useState("");
  const nav = useNavigate();
  const toast = useToast();

  const load = async () => {
    const j = await api.jobs();
    setJobs(j.jobs);
    const active = jobId || j.jobs[0]?.job_id || null;
    if (active !== jobId) setJobId(active);
    if (active) {
      const [s, c, q] = await Promise.all([
        api.stats(active),
        api.candidates(active),
        api.quality(active).catch(() => null),
      ]);
      setStats(s);
      setCands(c.candidates);
      setQuality(q);
    } else {
      setStats(null);
      setCands([]);
      setQuality(null);
    }
  };

  useEffect(() => {
    load().catch(() => {});
  }, [jobId]);

  useEffect(() => {
    const running = cands.some((c) => ["queued", "processing"].includes(c.status));
    if (!running) return;
    const t = setInterval(() => load().catch(() => {}), 2500);
    return () => clearInterval(t);
  }, [cands]);

  const demo = async () => {
    setBusy("demo");
    try {
      const r = await api.loadDemo();
      setJobId(r.job_id);
      await load();
      toast("Demo pool loaded — screening is running");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy("");
    }
  };

  const purge = async () => {
    if (!window.confirm("Delete every job, candidate, evaluation and audit row from this instance?")) return;
    setBusy("purge");
    try {
      await api.purge();
      setJobId(null);
      setJobs([]);
      setStats(null);
      setCands([]);
      setQuality(null);
      toast("All stored data purged");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy("");
    }
  };

  const activeJob = jobs.find((j) => j.job_id === jobId);
  const top = [...cands].filter((c) => c.score != null).sort((a, b) => b.score - a.score).slice(0, 5);
  const groups = stats?.groups || { Strong: 0, Potential: 0, Weak: 0 };
  const running = cands.some((c) => ["queued", "processing"].includes(c.status));

  return (
    <div className="space-y-7">
      {/* ------------------------------------------------ hero */}
      <header className="relative overflow-hidden rounded-2xl bg-ink-deep px-6 py-8 text-paper shadow-lift md:px-9 md:py-10">
        <div className="pointer-events-none absolute inset-0 bg-aurora" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 animate-drift rounded-full bg-plum/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 animate-drift rounded-full bg-cyanx/15 blur-3xl" />

        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <p className="eyebrow text-cyanx">
              {activeJob ? "Active role" : "Problem statement 3 · recruitment intelligence"}
            </p>
            <h1 className="mt-2 font-serif text-[34px] leading-[1.1] text-white md:text-[42px]">
              {activeJob ? activeJob.title : (
                <>
                  Screening you can <span className="gradient-text">actually audit.</span>
                </>
              )}
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-300">
              {activeJob
                ? `${activeJob.requirement_count} requirements · ${activeJob.candidate_count} candidates · every verdict carries the quote that justifies it.`
                : "HireFlow turns a job description into explicit requirements, checks every resume against them one requirement at a time, and refuses to show evidence it cannot find in the source."}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => nav("/role")}>
                <Icon name="doc" className="h-4 w-4" /> New role
              </button>
              <button
                className="btn glass text-white hover:bg-white/20"
                onClick={demo}
                disabled={busy === "demo"}
              >
                {busy === "demo" ? "Loading…" : (
                  <>
                    <Icon name="bolt" className="h-4 w-4" /> Load demo pool
                  </>
                )}
              </button>
              {activeJob && (
                <button className="btn glass text-white hover:bg-white/20" onClick={() => nav("/board")}>
                  Open board <Icon name="arrow" className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {stats && (
            <div className="flex items-end gap-6">
              <HeroStat value={`${stats.screened}/${stats.candidates}`} label="screened" />
              <HeroStat value={`${stats.evidence_verified_pct}%`} label="evidence verified" accent />
              <HeroStat value={stats.needs_validation} label="to validate" />
            </div>
          )}
        </div>

        {running && (
          <div className="relative mt-6 flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3.5 py-2 text-[13px] text-white backdrop-blur">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-cyanx" />
            Screening in progress — the board updates as each candidate finishes.
          </div>
        )}
      </header>

      {/* ------------------------------------------------ first-run */}
      {!activeJob && (
        <section className="grid gap-4 md:grid-cols-3 stagger">
          {[
            {
              icon: "shield",
              title: "Blind by default",
              body: "Names, emails, phone numbers and institutions are stripped before the model sees a single word.",
            },
            {
              icon: "check",
              title: "Quotes are verified",
              body: "Every quote is matched back against the source text. If it cannot be located, the status is downgraded and says so.",
            },
            {
              icon: "user",
              title: "Humans decide",
              body: "HireFlow reports evidence strength. Advance, hold and reject are recorded against a named person.",
            },
          ].map((f) => (
            <article key={f.title} className="card card-hover p-5">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-teal-light text-teal">
                <Icon name={f.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-3.5 font-medium">{f.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">{f.body}</p>
            </article>
          ))}
        </section>
      )}

      {stats && (
        <>
          <AgentProgress
            active={running}
            completed={running ? Math.min(5, Math.floor((stats.screened / Math.max(stats.candidates, 1)) * 5)) : 6}
          />
          {/* ------------------------------------------------ metrics */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger">
            <Metric
              icon="user"
              label="Candidates screened"
              value={`${stats.screened}/${stats.candidates}`}
              foot={running ? <Spinner label="Screening in progress" /> : "Ready for review"}
            />
            <Metric
              icon="check"
              label="Evidence verified"
              value={`${stats.evidence_verified_pct}%`}
              foot="Quotes located in the source resume"
              meter={stats.evidence_verified_pct}
              tone="forest"
            />
            <Metric
              icon="flag"
              label="Items needing validation"
              value={stats.needs_validation}
              foot="Flagged for the interview stage"
              tone="ochre"
            />
            <Metric
              icon="scale"
              label="Human decisions recorded"
              value={`${stats.decisions}/${stats.interviews}`}
              foot="HireFlow never decides on its own"
            />
          </section>

          <section className="card animate-rise border-ochre/20 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow text-ochre">Recruiter attention</p>
                <h2 className="mt-1 font-medium">Candidates needing validation</h2>
                <p className="mt-1 text-[13px] text-ink-500">Open evidence gaps before making a human decision.</p>
              </div>
              <button className="btn-quiet text-[13px] text-ochre" onClick={() => nav("/board")}>Open board <Icon name="arrow" className="h-3.5 w-3.5" /></button>
            </div>
            {cands.filter((c) => c.needs_validation_count > 0).length ? (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {cands.filter((c) => c.needs_validation_count > 0).slice(0, 6).map((c) => (
                  <li key={c.candidate_id}>
                    <button onClick={() => nav(`/candidate/${c.candidate_id}`)} className="flex w-full items-center gap-3 rounded-lg border border-ochre/20 bg-ochre-light/30 px-3 py-2.5 text-left hover:border-ochre/50">
                      <GroupChip group={c.group} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.display_name || c.label}</span>
                      <span className="text-[12px] tabular-nums text-ochre">{c.needs_validation_count} open</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-lg bg-forest-light/40 px-3 py-2.5 text-[13px] text-forest">No open validation items.</p>
            )}
          </section>

          {/* ------------------------------------------------ pool + leaders */}
          <section className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <div className="card animate-rise p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="font-medium">Pool shape</h2>
                <button className="btn-quiet text-[13px]" onClick={() => nav("/board")}>
                  Open board <Icon name="arrow" className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-5 space-y-4">
                {(["Strong", "Potential", "Weak"] as const).map((g) => {
                  const total = stats.candidates || 1;
                  return (
                    <div key={g}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{g}</span>
                        <span className="tabular-nums text-ink-500">{groups[g]}</span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper-deep">
                        <div
                          className={`h-2 rounded-full transition-all duration-700 ${GROUP_STYLE[g].bar}`}
                          style={{ width: `${(groups[g] / total) * 100}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[12px] text-ink-300">{GROUP_STYLE[g].note}</p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-6 border-t border-ink/10 pt-4">
                <p className="label">Requirement outcomes across the pool</p>
                <CoverageBar counts={stats.status_counts} />
                <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-ink-500">
                  {Object.entries(stats.status_counts).map(([k, v]: any) => (
                    <li key={k} className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_STYLE[k].dot}`} />
                      {STATUS_STYLE[k].label} · <span className="tabular-nums">{v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="card animate-rise p-5">
              <h2 className="font-medium">Highest evidence coverage</h2>
              <p className="mt-0.5 text-[12px] text-ink-300">Ranked by code-computed score, not by model opinion.</p>
              <ul className="mt-4 space-y-2">
                {top.length === 0 && <li className="text-sm text-ink-300">Nothing screened yet.</li>}
                {top.map((c) => (
                  <li key={c.candidate_id}>
                    <button
                      onClick={() => nav(`/candidate/${c.candidate_id}`)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-paper-deep/70"
                    >
                      <ScoreDial value={c.score} size={48} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">{c.display_name || c.label}</span>
                          <GroupChip group={c.group} />
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-ink-500">{c.rationale}</span>
                      </span>
                      <Icon name="arrow" className="h-4 w-4 shrink-0 text-ink-300" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ------------------------------------------------ quality panel */}
          {quality && <QualityPanel q={quality} />}

          {/* ------------------------------------------------ how judged */}
          <section className="card animate-rise p-5">
            <h2 className="font-medium">How this pool was judged</h2>
            <div className="mt-3 grid gap-5 text-[13px] leading-relaxed text-ink-700 sm:grid-cols-3">
              <p>
                <span className="font-medium">Scoring is code, not opinion.</span> Each status is worth a fixed
                value (met 1.0, partial 0.5, unclear 0.25, missing 0). Must-haves carry{" "}
                {config ? config.scoring.weights.must * 100 : 80}% of the score.
              </p>
              <p>
                <span className="font-medium">Evidence is verified.</span> Every quote is matched back against
                the resume text. If it cannot be found, the status drops to unclear and says so.
              </p>
              <p>
                <span className="font-medium">Screening is blind.</span> Names, contact details and institutions
                are stripped before the model reads anything. Redaction is best-effort, not a guarantee.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
              <p className="text-[12px] text-ink-300">
                All data lives in a local SQLite file. Nothing is retained anywhere else.
              </p>
              <button className="btn-danger" onClick={purge} disabled={busy === "purge"}>
                <Icon name="trash" className="h-4 w-4" />
                {busy === "purge" ? "Purging…" : "Purge all data"}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function HeroStat({ value, label, accent }: { value: any; label: string; accent?: boolean }) {
  return (
    <div>
      <p className={`font-serif text-[30px] leading-none ${accent ? "text-cyanx" : "text-white"}`}>{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-[.12em] text-ink-300">{label}</p>
    </div>
  );
}

function Metric({
  label,
  value,
  foot,
  icon,
  meter,
  tone,
}: {
  label: string;
  value: any;
  foot: any;
  icon: string;
  meter?: number;
  tone?: string;
}) {
  return (
    <div className="card card-hover px-5 py-4">
      <div className="flex items-start justify-between">
        <p className="text-[13px] text-ink-500">{label}</p>
        <Icon name={icon} className="h-4 w-4 text-ink-300" />
      </div>
      <p className="mt-1.5 font-serif text-[32px] leading-none tabular-nums">{value}</p>
      {meter != null && (
        <div className="mt-2.5">
          <Meter value={meter} tone={tone} />
        </div>
      )}
      <div className="mt-2 text-[12px] text-ink-300">{foot}</div>
    </div>
  );
}

function QualityPanel({ q }: { q: any }) {
  const g = q.golden;
  return (
    <section className="card animate-rise p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Evidence quality</h2>
          <p className="mt-0.5 text-[13px] text-ink-500">
            Measured, not claimed. The golden set is a hand-labelled expectation for the synthetic seed pool.
          </p>
        </div>
        <Tag tone="cyan">self-evaluating</Tag>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QCell label="Claims with a quote" value={q.claims_with_quote} foot={`${q.evaluations} evaluations total`} />
        <QCell
          label="Quotes verified"
          value={`${q.verified_share_pct}%`}
          foot={`${q.claims_verified} of ${q.claims_with_quote} located in source`}
          meter={q.verified_share_pct}
        />
        <QCell
          label="Auto-downgraded"
          value={q.auto_downgraded}
          foot="Unverifiable claims demoted to unclear"
          tone="ochre"
        />
        <QCell label="Human overrides" value={q.human_overrides} foot="Recruiter overruled the model" tone="teal" />
      </div>

      {g ? (
        <div className="mt-5 rounded-xl border border-ink/10 bg-paper/70 p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="text-[13px] font-medium">Golden-set agreement</p>
            <Tag tone="forest">exact {g.status_exact_pct}%</Tag>
            <Tag tone="teal">within one {g.status_within_one_pct}%</Tag>
            <Tag tone="plum">group match {g.group_match}</Tag>
            <span className="text-[12px] text-ink-300">
              {g.items} labelled items across {g.candidates} candidates
            </span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="border-b border-ink/10 text-[11px] uppercase tracking-wide text-ink-300">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Candidate</th>
                  <th className="py-2 pr-3 font-semibold">Expected</th>
                  <th className="py-2 pr-3 font-semibold">Actual</th>
                  <th className="py-2 pr-3 font-semibold">Statuses exact</th>
                  <th className="py-2 font-semibold">Designed to test</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10">
                {g.per_candidate.map((p: any) => (
                  <tr key={p.file} className="align-top">
                    <td className="py-2 pr-3 font-medium">{p.label || p.file}</td>
                    <td className="py-2 pr-3 text-ink-500">{p.expected_group}</td>
                    <td className="py-2 pr-3">
                      <span className={p.group_match ? "text-forest" : "text-brick"}>
                        {p.actual_group || "—"} {p.group_match ? "✓" : "✕"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-ink-700">
                      {p.exact}/{p.total}
                    </td>
                    <td className="py-2 text-ink-500">{p.design_note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12px] leading-snug text-ink-300">{g.note}</p>
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-ink-300">
          Load the demo pool to see golden-set agreement — the labelled expectations only cover the seeded
          candidates.
        </p>
      )}
    </section>
  );
}

function QCell({
  label,
  value,
  foot,
  meter,
  tone,
}: {
  label: string;
  value: any;
  foot: string;
  meter?: number;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white/60 px-4 py-3">
      <p className="text-[12px] text-ink-500">{label}</p>
      <p className="mt-1 font-serif text-[26px] leading-none tabular-nums">{value}</p>
      {meter != null && (
        <div className="mt-2">
          <Meter value={meter} tone={tone || "forest"} />
        </div>
      )}
      <p className="mt-1.5 text-[11.5px] leading-snug text-ink-300">{foot}</p>
    </div>
  );
}
