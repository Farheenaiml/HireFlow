// Dev: Vite proxies /api -> 127.0.0.1:8000.
// Same-origin Docker/Render build: VITE_API_BASE is set to "" so calls hit this origin.
const RAW = (import.meta as any).env?.VITE_API_BASE;
const BASE = (RAW === undefined ? "/api" : String(RAW)).replace(/\/+$/, "");

async function req(path: string, opts: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    headers: opts.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  config: () => req("/config"),
  stats: (jobId?: string) => req(`/stats${jobId ? `?job_id=${jobId}` : ""}`),
  jobs: () => req("/jobs"),
  job: (id: string) => req(`/job?job_id=${id}`),
  analyzeJD: (title: string, jd_text: string) =>
    req("/jd/analyze", { method: "POST", body: JSON.stringify({ title, jd_text }) }),
  analyzeJDFile: (title: string, file: File) => {
    const fd = new FormData();
    fd.append("title", title); fd.append("file", file);
    return req("/jd/analyze_file", { method: "POST", body: fd });
  },
  saveRequirements: (job_id: string, requirements: any[]) =>
    req("/jd/requirements", { method: "PUT", body: JSON.stringify({ job_id, requirements }) }),
  upload: (job_id: string, files: File[]) => {
    const fd = new FormData();
    fd.append("job_id", job_id);
    files.forEach((f) => fd.append("files", f));
    return req("/candidates/upload", { method: "POST", body: fd });
  },
  pasteResume: (job_id: string, file_name: string, text: string) =>
    req("/candidates/paste", { method: "POST", body: JSON.stringify({ job_id, file_name, text }) }),
  candidates: (job_id: string, reveal = false) =>
    req(`/candidates?job_id=${job_id}&reveal=${reveal}`),
  candidate: (candidate_id: string, reveal = false) =>
    req(`/candidate?candidate_id=${candidate_id}&reveal=${reveal}`),
  deleteCandidate: (candidate_id: string) =>
    req(`/candidate?candidate_id=${candidate_id}`, { method: "DELETE" }),
  runScreening: (job_id: string, force = false) =>
    req("/screening/run", { method: "POST", body: JSON.stringify({ job_id, force }) }),
  compare: (job_id: string, labels: string[]) =>
    req(`/compare?job_id=${job_id}&labels=${labels.join(",")}`),
  quality: (job_id?: string) => req(`/quality${job_id ? `?job_id=${job_id}` : ""}`),
  demoNotes: (candidate_id: string) => req(`/demo/notes?candidate_id=${candidate_id}`),
  override: (eval_id: string, status: string) =>
    req("/evaluation/override", { method: "POST", body: JSON.stringify({ eval_id, status }) }),
  kit: (candidate_id: string) =>
    req("/interview/kit", { method: "POST", body: JSON.stringify({ candidate_id }) }),
  interview: (candidate_id: string) => req(`/interview?candidate_id=${candidate_id}`),
  evaluateInterview: (candidate_id: string, notes: string) =>
    req("/interview/evaluate", { method: "POST", body: JSON.stringify({ candidate_id, notes }) }),
  decide: (candidate_id: string, decision: string, note: string, author: string, rating?: number | null) =>
    req("/interview/decision", {
      method: "POST",
      body: JSON.stringify({ candidate_id, decision, note, author, rating: rating ?? null }),
    }),
  chat: (job_id: string, message: string, session_id = "default") =>
    req("/chat", { method: "POST", body: JSON.stringify({ job_id, message, session_id }) }),
  chatHistory: (job_id: string) => req(`/chat/history?job_id=${job_id}`),
  audit: (params: { job_id?: string; candidate_id?: string }) =>
    req(`/audit?${params.candidate_id ? `candidate_id=${params.candidate_id}` : `job_id=${params.job_id}`}`),
  loadDemo: () => req("/demo/load", { method: "POST", body: JSON.stringify({ screen: true }) }),
  purge: () => req("/admin/purge", { method: "POST" }),
};
