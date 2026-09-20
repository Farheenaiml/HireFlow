import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useApp } from "../App";
import { Empty, GroupChip, ScoreDial, Spinner, StatusChip } from "../components/ui";

/** Side-by-side comparison (FR-17). Every cell is a stored evaluation - nothing is generated here. */
export default function Compare() {
  const { jobId } = useApp();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [pool, setPool] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [onlyDiff, setOnlyDiff] = useState(false);

  const labels = (params.get("labels") || "").split(",").filter(Boolean);

  useEffect(() => {
    if (!jobId) return;
    api.candidates(jobId).then((r) => setPool(r.candidates.filter((c: any) => c.score != null))).catch(() => {});
  }, [jobId]);

  useEffect(() => {
    setErr("");
    if (!jobId || labels.length < 2) { setData(null); return; }
    api.compare(jobId, labels).then(setData).catch((e) => setErr(e.message));
  }, [jobId, params]);

  if (!jobId) {
    return <Empty title="No role selected" body="Comparison needs a screened pool. Load the demo pool from the dashboard."
      action={<button className="btn-primary" onClick={() => nav("/")}>Go to dashboard</button>} />;
  }

  const toggle = (label: string) => {
    const next = labels.includes(label) ? labels.filter((l) => l !== label) : [...labels, label].slice(-3);
    setParams(next.length ? { labels: next.join(",") } : {});
  };

  const rows = data
    ? data.requirements.filter((r: any) => !onlyDiff || data.differing.includes(r.req_id))
    : [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[32px] leading-tight">Compare candidates</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          Pick two or three candidates. Each cell is the stored, verified evaluation for that requirement — the
          differences are computed in code, not written by a model.
        </p>
      </header>

      <section className="card p-4">
        <p className="label">Candidates (choose up to three)</p>
        <div className="flex flex-wrap gap-2">
          {pool.map((c) => {
            const on = labels.includes(c.label);
            return (
              <button key={c.candidate_id} onClick={() => toggle(c.label)} aria-pressed={on}
                className={`btn ${on ? "bg-ink text-white" : "border border-ink/15 text-ink-700 hover:bg-paper-deep"}`}>
                {c.display_name || c.label}
                <span className={`text-[11px] ${on ? "text-white/70" : "text-ink-300"}`}>{c.group}</span>
              </button>
            );
          })}
          {pool.length === 0 && <p className="text-[13px] text-ink-300">No screened candidates yet.</p>}
        </div>
      </section>

      {err && <p className="text-[13px] text-brick">{err}</p>}
      {labels.length < 2 && !err && (
        <Empty title="Choose at least two candidates" body="Their requirement-by-requirement evidence will line up here." />
      )}
      {labels.length >= 2 && !data && !err && <Spinner label="Lining up the evidence" />}

      {data && (
        <>
          <section className={`grid gap-4 ${data.candidates.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
            {data.candidates.map((c: any) => (
              <div key={c.candidate_id} className="card p-4">
                <div className="flex items-start gap-3">
                  <ScoreDial value={c.score} size={56} />
                  <div className="min-w-0">
                    <Link to={`/candidate/${c.candidate_id}`} className="font-medium hover:underline">
                      {c.display_name || c.label}
                    </Link>
                    <div className="mt-1"><GroupChip group={c.group} /></div>
                  </div>
                </div>
                <p className="mt-3 line-clamp-4 text-[13px] leading-relaxed text-ink-700">{c.summary}</p>
                <p className="mt-2 text-[12px] text-ink-500">{c.rationale}</p>
              </div>
            ))}
          </section>

          {data.edges.length > 0 && (
            <section className="rounded-lg border border-teal/25 bg-teal-light/50 px-5 py-4">
              <p className="text-[13px] font-medium text-teal">Where they differ most</p>
              <ul className="mt-1.5 space-y-1 text-[13px] text-ink-700">
                {data.edges.map((e: any) => <li key={e.req_id}>· {e.text}</li>)}
              </ul>
            </section>
          )}

          <section className="card overflow-hidden">
            <header className="flex items-center justify-between border-b border-ink/10 px-5 py-3.5">
              <h2 className="font-medium">Requirement by requirement</h2>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-500">
                <input type="checkbox" className="accent-teal" checked={onlyDiff}
                  onChange={(e) => setOnlyDiff(e.target.checked)} />
                Only show differences ({data.differing.length})
              </label>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="border-b border-ink/10 bg-paper text-[12px] text-ink-500">
                  <tr>
                    <th className="w-[28%] px-4 py-2.5 font-medium">Requirement</th>
                    {data.candidates.map((c: any) => (
                      <th key={c.candidate_id} className="px-4 py-2.5 font-medium">{c.display_name || c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/10">
                  {rows.map((r: any) => (
                    <tr key={r.req_id} className={`align-top ${data.differing.includes(r.req_id) ? "bg-ochre-light/25" : ""}`}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-teal">{r.req_id}</span>{" "}
                        <span className="text-ink-700">{r.text}</span>
                        <span className="mt-1 block text-[11px] text-ink-300">
                          {r.priority === "must" ? "must have" : "nice to have"}
                        </span>
                      </td>
                      {data.candidates.map((c: any) => {
                        const cell = data.matrix[r.req_id]?.[c.label];
                        return (
                          <td key={c.candidate_id} className="px-4 py-3">
                            {cell ? (
                              <>
                                <StatusChip status={cell.status} verified={cell.quote_verified} />
                                {cell.quote
                                  ? <p className="quote mt-1.5 text-[13px]">“{cell.quote}”</p>
                                  : <p className="mt-1.5 text-[12px] text-ink-300">No supporting text</p>}
                                {cell.needs_validation && <p className="mt-1 text-[11px] text-ochre">needs validation</p>}
                                <Link className="mt-1 inline-block text-[11px] text-teal hover:underline"
                                  to={`/candidate/${c.candidate_id}?req=${r.req_id}`}>Open evidence</Link>
                              </>
                            ) : <span className="text-ink-300">not screened</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
