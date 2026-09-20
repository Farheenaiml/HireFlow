import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useApp } from "../App";
import {
  CoverageBar,
  Drawer,
  EvidenceQuote,
  GroupChip,
  Highlighted,
  Icon,
  Meter,
  ScoreDial,
  Spinner,
  StatusChip,
  Tag,
  useToast,
} from "../components/ui";

export default function CandidateDetail() {
  const { id } = useParams();
  const { reveal } = useApp();
  const [d, setD] = useState<any>(null);
  const [interview, setInterview] = useState<any>(null);
  const [open, setOpen] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const toast = useToast();

  const load = async () => {
    const [detail, interviewData] = await Promise.all([api.candidate(id!, reveal), api.interview(id!).catch(() => ({ interview: null }))]);
    setD(detail);
    setInterview(interviewData.interview);
  };
  const closeDrawer = () => {
    setOpen(null);
    if (params.get("req")) setParams({}, { replace: true });
  };
  // deep link from chat citations and the compare view: /candidate/:id?req=R3 opens the evidence drawer
  useEffect(() => {
    const rid = params.get("req");
    if (!rid || !d) return;
    const e = d.evaluations.find((x: any) => x.req_id === rid);
    const r = d.requirements.find((x: any) => x.req_id === rid);
    if (e && r) setOpen({ e, r });
  }, [d, params]);
  useEffect(() => { load(); }, [id, reveal]);
  useEffect(() => { api.audit({ candidate_id: id! }).then((r) => setAudit(r.rows)).catch(() => {}); }, [id, d?.candidate?.status]);

  if (!d) return <Spinner label="Loading candidate" />;

  const c = d.candidate;
  const byReq: Record<string, any> = Object.fromEntries(d.evaluations.map((e: any) => [e.req_id, e]));
  const interviewByReq: Record<string, any> = Object.fromEntries(
    (interview?.report?.requirement_table || []).map((row: any) => [row.req_id, row])
  );
  const reqs = d.requirements;
  const flagged = d.evaluations.filter((e: any) => e.needs_validation);
  const quoted = d.evaluations.filter((e: any) => e.quote);
  const quotedCount = quoted.length;
  const verifiedCount = quoted.filter((e: any) => e.quote_verified).length;
  const statusCounts: Record<string, number> = { met: 0, partial: 0, unclear: 0, missing: 0 };
  d.evaluations.forEach((e: any) => {
    if (statusCounts[e.status] != null) statusCounts[e.status] += 1;
  });

  const override = async (eval_id: string, status: string) => {
    setBusy(true);
    try {
      await api.override(eval_id, status);
      closeDrawer();
      await load();
      toast(`${status} set by you — score recomputed`);
    } finally { setBusy(false); }
  };

  const makeKit = async () => {
    setBusy(true);
    try { await api.kit(id!); nav(`/candidate/${id}/interview`); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <Link to="/board" className="inline-flex items-center gap-1.5 text-[13px] text-ink-500 hover:text-ink">
        <Icon name="arrow" className="h-3.5 w-3.5 rotate-180" /> Candidate board
      </Link>

      <header className="card animate-rise relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-teal/5 blur-3xl" />
        <div className="relative flex flex-wrap items-start gap-5">
          <ScoreDial value={c.score} size={82} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-serif text-[28px] leading-none">{c.display_name || c.label}</h1>
              <GroupChip group={c.group} />
              {!reveal && <Tag tone="slate">identity hidden · {c.file_name}</Tag>}
            </div>
            <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-ink-700">{c.summary}</p>
            <p className="mt-2 text-[13px] text-ink-500">{c.rationale}</p>

            {(c.error || c.warnings?.length > 0 || c.status === "error") && (
              <div className="mt-3 rounded-lg border border-ochre/25 bg-ochre-light/40 px-3 py-2.5 text-[13px] text-ochre">
                <p className="font-medium">Reasoning service unavailable — deterministic evidence analysis continued.</p>
                {c.error && <p className="mt-1 text-[12px]">{c.error}</p>}
                {c.warnings?.length > 0 && <p className="mt-1 text-[12px]">{c.warnings[0]}</p>}
              </div>
            )}

            <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-3">
              <MiniStat label="Must-have coverage" value={`${Math.round((c.must_score ?? 0) * 100)}%`} pct={(c.must_score ?? 0) * 100} tone="teal" />
              <MiniStat label="Nice-to-have" value={`${Math.round((c.nice_score ?? 0) * 100)}%`} pct={(c.nice_score ?? 0) * 100} tone="forest" />
              <MiniStat label="Evidence verified" value={`${verifiedCount}/${quotedCount}`} pct={quotedCount ? (100 * verifiedCount) / quotedCount : 0} tone="forest" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button className="btn-primary" onClick={makeKit} disabled={busy}>
              <Icon name="spark" className="h-4 w-4" /> Build interview kit
            </button>
            <Link className="btn-ghost justify-center" to={`/candidate/${id}/interview`}>Interview workspace</Link>
          </div>
        </div>

        <div className="relative mt-5 border-t border-ink/10 pt-4">
          <div className="flex items-center justify-between text-[12px] text-ink-500">
            <span>Requirement outcomes for this candidate</span>
            <span>{reqs.length} requirements</span>
          </div>
          <div className="mt-2"><CoverageBar counts={statusCounts} /></div>
        </div>
      </header>

      <EvidenceJourney evaluations={d.evaluations} />

      {flagged.length > 0 && (
        <section className="rounded-lg border border-ochre/30 bg-ochre-light/50 px-5 py-4">
          <p className="text-[13px] font-medium text-ochre">
            {flagged.length} item{flagged.length > 1 ? "s" : ""} need validation before this candidate
            can be compared fairly
          </p>
          <ul className="mt-2 space-y-1 text-[13px] text-ink-700">
            {flagged.slice(0, 4).map((e: any) => (
              <li key={e.eval_id}>· <span className="font-medium">{e.req_id}</span> {e.validation_note}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-hidden">
        <header className="flex items-center justify-between border-b border-ink/10 px-5 py-3.5">
          <h2 className="font-medium">Requirement by requirement</h2>
          <span className="text-[12px] text-ink-300">Click any row to see the source evidence</span>
        </header>
        <ul className="divide-y divide-ink/10">
          {reqs.map((r: any) => {
            const e = byReq[r.req_id];
            const interviewRow = interviewByReq[r.req_id];
            const flagged = e && (e.status !== "met" || e.needs_validation);
            return (
              <li key={r.req_id}>
                <button onClick={() => e && setOpen({ e, r })}
                  className="flex w-full items-start gap-4 px-5 py-3.5 text-left hover:bg-paper-deep/60">
                  <span className="w-8 shrink-0 pt-0.5 text-[12px] font-medium text-teal">{r.req_id}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium">{r.text}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${
                        r.priority === "must" ? "bg-ink/5 text-ink-500" : "bg-plum-light text-plum"}`}>
                        {r.priority === "must" ? "must have" : "nice to have"}
                      </span>
                    </span>
                    <span className="mt-2 block"><EvidenceQuote label="Resume evidence" quote={e?.quote} verified={e?.quote_verified} /></span>
                    <span className="mt-2 block"><EvidenceQuote label="Interview evidence" quote={interviewRow?.interview_evidence} /></span>
                    {flagged && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => { event.stopPropagation(); setOpen({ e, r, interviewRow, flagged: true }); }}
                        onKeyDown={(event) => { if (event.key === "Enter") { event.stopPropagation(); setOpen({ e, r, interviewRow, flagged: true }); } }}
                        className="mt-2 inline-flex rounded-md bg-ochre-light px-2 py-1 text-[12px] font-medium text-ochre hover:bg-ochre-light/70"
                      >
                        Why flagged?
                      </span>
                    )}
                    {e?.overridden_by_human && (
                      <span className="mt-1.5 inline-block text-[12px] text-plum">Set by recruiter</span>
                    )}
                  </span>
                  <span className="shrink-0 pt-0.5">
                    {e ? <StatusChip status={e.status} verified={e.quote_verified} /> :
                      <span className="text-[12px] text-ink-300">not screened</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="font-medium">Extracted profile</h2>
          <Profile profile={c.profile} />
        </div>
        <div className="card p-5">
          <h2 className="font-medium">Audit trail</h2>
          <p className="mt-1 text-[12px] text-ink-300">What produced each insight, and from which source.</p>
          <ul className="mt-3 space-y-2.5 text-[13px]">
            {audit.slice(0, 6).map((a) => (
              <li key={a.log_id} className="border-l-2 border-ink/10 pl-3">
                <p className="font-medium">{a.insight_type.replace("_", " ")}</p>
                <p className="text-ink-500">
                  {a.model} · prompt {a.prompt_version} · {new Date(a.timestamp).toLocaleString()}
                </p>
                <p className="text-[12px] text-ink-300">
                  {a.sources?.quotes_verified != null
                    ? `${a.sources.quotes_verified}/${a.sources.quotes_checked} quotes verified against the redacted resume`
                    : JSON.stringify(a.sources).slice(0, 110)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Drawer open={!!open} onClose={closeDrawer}
        title={open ? `${open.r.req_id} · evidence` : ""}>
        {open && (
          <div className="space-y-5">
            <div>
              <p className="label">Requirement</p>
              <p className="text-[14px]">{open.r.text}</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusChip status={open.e.status} verified={open.e.quote_verified} />
              <span className="text-[12px] text-ink-500">
                {open.e.quote_verified
                  ? `Quote located in the source (${open.e.verify_method} match)`
                  : "Quote could not be located — status was downgraded automatically"}
              </span>
            </div>
            <div>
              <p className="label">Reasoning</p>
              <p className="text-[14px] leading-relaxed text-ink-700">{open.e.reasoning}</p>
            </div>
            {open.flagged && (
              <div className="rounded-lg border border-ochre/25 bg-ochre-light/40 px-3 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-ochre">Why flagged?</p>
                <p className="mt-1.5 text-[13px] text-ink-700">Current status: <span className="font-medium">{open.e.status}</span></p>
                <p className="mt-1 text-[13px] text-ink-700">{open.e.reasoning || "The available evidence is insufficient to mark this requirement as met."}</p>
                <p className="mt-2 text-[13px] text-ink-700">Validation question: {open.e.validation_note || "No validation question recorded."}</p>
                <EvidenceQuote label="Available resume evidence" quote={open.e.quote} verified={open.e.quote_verified} />
                <div className="mt-2"><EvidenceQuote label="Available interview evidence" quote={open.interviewRow?.interview_evidence} /></div>
              </div>
            )}
            {open.e.validation_note && (
              <div className="rounded-md bg-ochre-light/60 px-3 py-2.5">
                <p className="text-[12px] font-medium text-ochre">Needs validation</p>
                <p className="text-[13px] text-ink-700">{open.e.validation_note}</p>
              </div>
            )}
            <div>
              <p className="label">Source text {reveal ? "" : "(redacted for blind screening)"}</p>
              <div className="max-h-72 overflow-y-auto rounded-md bg-paper px-3 py-2.5">
                <Highlighted text={d.redacted_text} start={open.e.span_start} end={open.e.span_end} />
              </div>
            </div>
            <div className="border-t border-ink/10 pt-4">
              <p className="label">Recruiter override</p>
              <div className="flex flex-wrap gap-2">
                {["met", "partial", "unclear", "missing"].map((s) => (
                  <button key={s} disabled={busy} onClick={() => override(open.e.eval_id, s)}
                    className={`btn ${open.e.status === s ? "bg-ink text-white" : "border border-ink/15 text-ink-700 hover:bg-paper-deep"}`}>
                    {s}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-ink-300">
                Overrides are recorded in the audit trail and rescore the candidate immediately.
              </p>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Profile({ profile }: { profile: any }) {
  if (!profile || !Object.keys(profile).length)
    return <p className="mt-3 text-[13px] text-ink-300">Nothing extracted yet.</p>;
  return (
    <div className="mt-3 space-y-4 text-[13px]">
      {profile.years_experience_claimed != null && (
        <p className="text-ink-700">Claims about <span className="font-medium">{profile.years_experience_claimed} years</span> of experience.</p>
      )}
      {profile.skills?.length > 0 && (
        <div>
          <p className="label">Skills named in the resume</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.skills.slice(0, 20).map((s: string, i: number) => (
              <span key={i} className="rounded bg-paper-deep px-2 py-0.5 text-[12px] text-ink-700">{s}</span>
            ))}
          </div>
        </div>
      )}
      {profile.roles?.length > 0 && (
        <div>
          <p className="label">Roles</p>
          <ul className="space-y-1 text-ink-700">
            {profile.roles.slice(0, 5).map((r: any, i: number) => <li key={i}>· {r.title}</li>)}
          </ul>
        </div>
      )}
      {profile.projects?.length > 0 && (
        <div>
          <p className="label">Projects</p>
          <ul className="space-y-1 text-ink-700">
            {profile.projects.slice(0, 4).map((p: string, i: number) => <li key={i}>· {p}</li>)}
          </ul>
        </div>
      )}
      {profile.education?.length > 0 && (
        <div>
          <p className="label">Education (institution hidden)</p>
          <ul className="space-y-1 text-ink-700">
            {profile.education.map((e: any, i: number) => <li key={i}>· {e.degree} {e.field}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function EvidenceJourney({ evaluations }: { evaluations: any[] }) {
  const total = evaluations.length || 1;
  const met = evaluations.filter((e) => e.status === "met" && !e.needs_validation).length;
  const flagged = evaluations.filter((e) => e.needs_validation || e.status !== "met").length;
  const stage = flagged === 0 ? 4 : met > 0 ? 3 : 2;
  const stages = ["Claim", "Evidence", "Challenge", "Validate"];
  return (
    <section className="card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="eyebrow">Evidence journey</p>
          <p className="mt-1 text-[13px] text-ink-500">{met}/{total} requirements are verified; {flagged} need attention.</p>
        </div>
        <Tag tone={flagged ? "ochre" : "forest"}>{flagged ? "Review open gaps" : "Journey complete"}</Tag>
      </div>
      <ol className="mt-4 grid grid-cols-4 gap-2">
        {stages.map((name, index) => {
          const complete = index < stage;
          const current = index === stage - 1 || (stage === 2 && index === 1);
          return (
            <li key={name} className={`relative text-center text-[11px] ${complete ? "text-forest" : current ? "text-ochre" : "text-ink-300"}`}>
              {index > 0 && <span className={`absolute left-[-50%] right-[50%] top-3 h-px ${complete ? "bg-forest/40" : "bg-ink/10"}`} />}
              <span className={`relative mx-auto grid h-6 w-6 place-items-center rounded-full border text-[10px] ${complete ? "border-forest bg-forest text-white" : current ? "border-ochre bg-ochre-light text-ochre" : "border-ink/15 bg-white"}`}>
                {complete ? "✓" : index + 1}
              </span>
              <span className="mt-1 block font-medium">{name}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function MiniStat({ label, value, pct, tone }: { label: string; value: string; pct: number; tone: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white/60 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-ink-300">{label}</p>
      <p className="mt-0.5 font-serif text-[19px] leading-none tabular-nums">{value}</p>
      <div className="mt-1.5"><Meter value={pct} tone={tone} /></div>
    </div>
  );
}
