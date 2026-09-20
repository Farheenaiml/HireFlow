import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../App";
import { Empty, Icon, Tag, useToast } from "../components/ui";

/* Human-readable descriptions of each insight type and its recorded sources.
   The raw JSON stays available behind a disclosure, but the default view is prose. */

const TYPE_META: Record<string, { label: string; tone: string; blurb: string }> = {
  requirements: { label: "Requirements extracted", tone: "teal", blurb: "Job description turned into explicit, checkable requirements." },
  requirements_edited: { label: "Requirements edited", tone: "plum", blurb: "A human changed the requirement list." },
  ingest: { label: "Resume ingested", tone: "slate", blurb: "File parsed to text and redacted before anything else happened." },
  screening: { label: "Candidate screened", tone: "teal", blurb: "Each requirement checked against the redacted resume." },
  human_override: { label: "Human override", tone: "plum", blurb: "A recruiter overruled the model's status for one requirement." },
  interview_kit: { label: "Interview kit written", tone: "cyan", blurb: "Questions generated from this candidate's evidence gaps." },
  interview_validation: { label: "Interview validation", tone: "teal", blurb: "A candidate response was validated against one requirement." },
  interview_report: { label: "Interview report", tone: "forest", blurb: "Interview notes mapped back to the requirements." },
  human_decision: { label: "Human decision", tone: "forest", blurb: "Advance / hold / reject recorded against a named person." },
  chat_answer: { label: "Pool question answered", tone: "cyan", blurb: "Natural-language query answered from stored evidence." },
  chat_refusal: { label: "Query refused", tone: "brick", blurb: "A protected-attribute question was blocked by the guardrail." },
};

function describe(row: any): string[] {
  const s = row.sources || {};
  const out: string[] = [];
  const t = row.insight_type;

  if (t === "requirements") out.push(`Read ${s.jd_chars ?? "?"} characters of job description text.`);
  if (t === "requirements_edited") out.push(`Saved ${s.count ?? "?"} requirements, marked as human-edited.`);
  if (t === "ingest") {
    out.push(`Source file: ${s.file || "unknown"}.`);
    if (s.redactions != null) out.push(`${s.redactions} personal detail(s) removed before screening.`);
  }
  if (t === "screening") {
    out.push(`Read the redacted resume text only — never the original.`);
    if (s.requirements) out.push(`Checked ${s.requirements.length} requirements: ${s.requirements.join(", ")}.`);
    if (s.quotes_checked != null)
      out.push(`${s.quotes_verified}/${s.quotes_checked} quotes were located in the source text.`);
    if (s.group_rule) out.push(`Grouping rule applied: ${s.group_rule}`);
  }
  if (t === "human_override")
    out.push(`${s.req_id}: status changed from "${s.from}" to "${s.to}" by a recruiter.`);
  if (t === "interview_kit" && s.targeted_requirements)
    out.push(`Questions target requirements ${s.targeted_requirements.filter(Boolean).join(", ") || "—"}.`);
  if (t === "interview_report") {
    out.push(`Read ${s.notes_chars ?? "?"} characters of interview notes.`);
    if (s.verified_quotes != null) out.push(`${s.verified_quotes} quote(s) verified against those notes.`);
    if (s.unanswered?.length) out.push(`Left unanswered: ${s.unanswered.join(", ")}.`);
  }
  if (t === "interview_validation") {
    out.push(`Requirement ${s.req_id || "?"}: evidence status changed from "${s.evidence_status_before || "missing"}" to "${s.evidence_status_after || "unclear"}".`);
    out.push(`Validation question: ${s.validation_question || "No question recorded."}`);
    out.push(`Candidate response: ${s.candidate_response || "No evidence found"}`);
    out.push(`Evidence reference: ${s.evidence_reference || "No evidence found"}`);
    if (s.reasoning) out.push(`Reasoning: ${s.reasoning}`);
  }
  if (t === "human_decision") {
    out.push(`Decision "${s.decision}" recorded by ${s.author || "recruiter"}.`);
    if (s.rating) out.push(`Interviewer rating: ${s.rating}/5.`);
    if (s.note) out.push(`Note: ${s.note}`);
  }
  if (t === "chat_answer") {
    out.push(`Question: "${s.question}"`);
    const cites = (s.citations || []).map((c: any) => `${c.candidate_label}${c.req_id ? ":" + c.req_id : ""}`);
    out.push(cites.length ? `Answer cited ${cites.length} evidence item(s): ${cites.join(", ")}.` : "No evidence matched.");
  }
  if (t === "chat_refusal") {
    out.push(`Question: "${s.question}"`);
    out.push(`Blocked: ${s.reason}.`);
  }
  if (!out.length) out.push(JSON.stringify(s));
  return out;
}

function lifecycle(trace: any[], timestamp: string) {
  return (trace || []).flatMap((item: any) => {
    const req = item.req_id || "Requirement";
    const evidence = item.answer_quote || item.resume_evidence || "No evidence found";
    return [
      { label: "Requirement", value: req, evidence: item.resume_evidence || "No evidence found" },
      { label: "Evidence found", value: item.resume_evidence ? "Resume evidence located" : "No evidence found", evidence: item.resume_evidence || "No evidence found" },
      { label: "Gap / validation", value: item.missing_evidence || "Validation considered", evidence: item.resume_evidence || "No evidence found" },
      ...(item.question ? [{ label: "Interview question", value: item.question, evidence }] : []),
      ...(item.answer_quote ? [{ label: "Candidate response", value: item.answer_quote, evidence }] : []),
      { label: "Updated evidence status", value: item.evidence_status || "Unverified", evidence },
    ].map((event) => ({ ...event, timestamp }));
  });
}

export default function Audit() {
  const { jobId } = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [openRaw, setOpenRaw] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (jobId) api.audit({ job_id: jobId }).then((r) => setRows(r.rows)).catch(() => {});
  }, [jobId]);

  const types = useMemo(() => ["all", ...Array.from(new Set(rows.map((r) => r.insight_type)))], [rows]);

  const shown = rows
    .filter((r) => filter === "all" || r.insight_type === filter)
    .filter((r) => {
      if (!q.trim()) return true;
      const hay = (r.insight_type + " " + (r.candidate_label || "") + " " + JSON.stringify(r.sources)).toLowerCase();
      return hay.includes(q.toLowerCase());
    });

  const exportCsv = () => {
    const head = ["timestamp", "insight_type", "candidate", "engine", "prompt_version", "description"];
    const lines = [head.join(",")].concat(
      shown.map((r) =>
        [r.timestamp, r.insight_type, r.candidate_label || "", r.model, r.prompt_version, describe(r).join(" ")]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      )
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hireflow-audit.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast("Audit trail exported");
  };

  if (!jobId)
    return <Empty title="No role selected" body="The audit trail follows a role. Pick or create one first." />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Traceability</p>
          <h1 className="mt-1 font-serif text-[32px] leading-tight">Audit trail</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500">
            Every insight on the board was produced by something. This is the record, in plain language: which
            source text was read, which engine produced it, which prompt version, and when.
          </p>
        </div>
        <button className="btn-ghost" onClick={exportCsv} disabled={!shown.length}>
          <Icon name="download" className="h-4 w-4" /> Export CSV
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
              filter === t ? "bg-ink text-white" : "border border-ink/15 bg-white/70 text-ink-500 hover:bg-paper-deep"
            }`}
          >
            {(TYPE_META[t]?.label || t.replace(/_/g, " "))}
            {t !== "all" && (
              <span className="ml-1.5 tabular-nums opacity-60">
                {rows.filter((r) => r.insight_type === t).length}
              </span>
            )}
          </button>
        ))}
        <div className="relative ml-auto">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
          <input
            className="field w-56 pl-9"
            placeholder="Search the trail"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <ol className="relative space-y-3 border-l border-ink/[.12] pl-5">
        {shown.map((r) => {
          const meta = TYPE_META[r.insight_type] || { label: r.insight_type.replace(/_/g, " "), tone: "slate", blurb: "" };
          const isHuman = r.model === "human";
          return (
            <li key={r.log_id} className="relative">
              <span
                className={`absolute -left-[26px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-paper ${
                  isHuman ? "bg-plum" : r.insight_type === "chat_refusal" ? "bg-brick" : "bg-teal"
                }`}
              />
              <article className="card card-hover p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Tag tone={meta.tone}>{meta.label}</Tag>
                  {r.candidate_label && <span className="text-[12px] font-medium text-ink-700">{r.candidate_label}</span>}
                  {isHuman && <Tag tone="plum">human action</Tag>}
                  <span className="ml-auto whitespace-nowrap font-mono text-[11px] text-ink-300">
                    {new Date(r.timestamp).toLocaleString()}
                  </span>
                </div>

                <ul className="mt-2.5 space-y-1 text-[13px] leading-relaxed text-ink-700">
                  {describe(r).map((line, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-300" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                {r.sources?.validation_trace?.length > 0 && (
                  <div className="mt-4 rounded-lg border border-teal/15 bg-teal-light/30 p-3">
                    <p className="label !mb-2 text-teal">Evidence lifecycle</p>
                    <ol className="space-y-2">
                      {lifecycle(r.sources.validation_trace, r.timestamp).map((event, i) => (
                        <li key={`${event.label}-${i}`} className="grid gap-1 sm:grid-cols-[150px_minmax(0,1fr)_150px] sm:items-start">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{event.label}</span>
                          <span className="text-[12px] text-ink-700">{event.value}</span>
                          <span className="text-[11px] text-ink-300">{event.timestamp ? new Date(event.timestamp).toLocaleString() : ""}</span>
                          <span className="sm:col-start-2 text-[12px] italic text-ink-500">Evidence reference: {event.evidence}</span>
                        </li>
                      ))}
                    </ol>
                    {r.model === "human" && <p className="mt-2 text-[12px] font-medium text-plum">Human recruiter review recorded.</p>}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink/8 pt-2.5 text-[11.5px] text-ink-300">
                  <span className="font-mono">engine {r.model}</span>
                  <span className="font-mono">prompts {r.prompt_version}</span>
                  {r.input_hash && <span className="font-mono">input {String(r.input_hash).slice(0, 12)}</span>}
                  <button
                    className="ml-auto text-teal hover:underline"
                    onClick={() => setOpenRaw(openRaw === r.log_id ? null : r.log_id)}
                  >
                    {openRaw === r.log_id ? "Hide raw record" : "Show raw record"}
                  </button>
                </div>

                {openRaw === r.log_id && (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-[11px] leading-relaxed text-paper">
                    {JSON.stringify(r.sources, null, 2)}
                  </pre>
                )}
              </article>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="py-12 text-center text-sm text-ink-300">Nothing recorded yet for this filter.</li>
        )}
      </ol>
    </div>
  );
}
