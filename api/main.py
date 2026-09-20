"""HireFlow API - evidence-first recruitment intelligence.

Every route that produces an insight also writes an audit row recording which
source text, engine and prompt version produced it.
"""
from __future__ import annotations

import envload  # noqa: F401  (must run before llm/db read the environment)

import json
import os
import re
import threading
import time
from typing import Any

import httpx
from fastapi import Body, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db
import llm
import textops as T

app = FastAPI(title="HireFlow API", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)

N8N_BASE = os.getenv("N8N_BASE_URL", "").rstrip("/")
N8N_KEY = os.getenv("N8N_API_KEY", "")
USE_N8N = os.getenv("USE_N8N", "false").lower() == "true"

INTERNAL_KEY = os.getenv("INTERNAL_KEY", "")
RUNS: dict[str, dict] = {}


def require_key(x_internal_key: str = Header(default="")) -> None:
    """Protects the deterministic helper routes n8n calls (TRD 2.7). Off unless INTERNAL_KEY is set."""
    if INTERNAL_KEY and x_internal_key != INTERNAL_KEY:
        raise HTTPException(401, "Missing or wrong X-Internal-Key")


@app.on_event("startup")
def _startup() -> None:
    db.init()


# ============================================================ helpers

def notify_n8n(event: str, payload: dict) -> None:
    """Fire-and-forget event to n8n. Used for notifications / downstream automations."""
    if not N8N_BASE:
        return
    try:
        httpx.post(f"{N8N_BASE}/webhook/hireflow/events",
                   headers={"X-API-Key": N8N_KEY} if N8N_KEY else {},
                   json={"event": event, "payload": payload}, timeout=6.0)
    except Exception:
        pass


def get_requirements(job_id: str) -> list[dict]:
    rows = db.q("SELECT * FROM requirements WHERE job_id=? ORDER BY sort_order", (job_id,))
    for r in rows:
        r["keywords"] = db.unjs(r["keywords"], [])
        r["edited_by_human"] = bool(r["edited_by_human"])
    return rows


def candidate_public(row: dict, reveal: bool = False) -> dict:
    return {
        "candidate_id": row["candidate_id"], "job_id": row["job_id"],
        "label": row["label"],
        "display_name": row["display_name"] if reveal else None,
        "file_name": row["file_name"], "status": row["status"],
        "group": row["grp"], "score": row["score"],
        "must_score": row["must_score"], "nice_score": row["nice_score"],
        "profile": db.unjs(row["profile"], {}), "summary": row["summary"],
        "rationale": row["rationale"], "error": row["error"],
        "warnings": db.unjs(row["warnings"], []), "created_at": row["created_at"],
    }


def evaluation_public(row: dict) -> dict:
    return {
        "eval_id": row["eval_id"], "req_id": row["req_id"], "status": row["status"],
        "quote": row["quote"], "quote_verified": bool(row["quote_verified"]),
        "verify_method": row["verify_method"], "span_start": row["span_start"],
        "span_end": row["span_end"], "reasoning": row["reasoning"],
        "needs_validation": bool(row["needs_validation"]),
        "validation_note": row["validation_note"], "model": row["model"],
        "prompt_version": row["prompt_version"],
        "overridden_by_human": bool(row["overridden_by_human"]),
    }


# ============================================================ system

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/config")
def config() -> dict:
    n8n_up = False
    if N8N_BASE:
        try:
            n8n_up = httpx.get(f"{N8N_BASE}/healthz", timeout=3.0).status_code < 500
        except Exception:
            n8n_up = False
    return {
        **llm.status(),
        "n8n_base_url": N8N_BASE, "n8n_reachable": n8n_up, "use_n8n": USE_N8N,
        "scoring": T.CONFIG,
    }


# ============================================================ helper routes (used by n8n)

@app.post("/extract", dependencies=[Depends(require_key)])
async def extract(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    return T.extract_text(file.filename, data)


@app.post("/redact", dependencies=[Depends(require_key)])
def redact_route(body: dict = Body(...)) -> dict:
    return T.redact(body.get("text", ""))


@app.post("/verify_quotes", dependencies=[Depends(require_key)])
def verify_route(body: dict = Body(...)) -> dict:
    return {"results": T.verify_quotes(body.get("source_text", ""), body.get("items", []))}


@app.post("/group", dependencies=[Depends(require_key)])
def group_route(body: dict = Body(...)) -> dict:
    return T.group_candidate(body.get("requirements", []), body.get("evaluations", []),
                             body.get("config"))


# ============================================================ jobs

class JDIn(BaseModel):
    title: str = "Untitled role"
    jd_text: str


@app.post("/jd/analyze")
def jd_analyze(body: JDIn) -> dict:
    if len(body.jd_text.strip()) < 60:
        raise HTTPException(400, "Paste a fuller job description - at least a few lines.")
    reqs, engine = llm.analyze_jd(body.title, body.jd_text)
    job_id = db.nid("job")
    db.ex("INSERT INTO jobs (job_id,title,jd_text,status,created_at) VALUES (?,?,?,?,?)",
          (job_id, body.title.strip() or "Untitled role", body.jd_text, "open", db.now()))
    rows = []
    for i, r in enumerate(reqs):
        rows.append((f"R{i+1}", job_id, r["text"], r["priority"], r["category"],
                     db.js(r.get("keywords", [])), 0, i))
    db.exmany("""INSERT INTO requirements (req_id,job_id,text,priority,category,keywords,
                 edited_by_human,sort_order) VALUES (?,?,?,?,?,?,?,?)""", rows)
    db.log_audit(job_id, None, "requirements", job_id,
                 {"jd_chars": len(body.jd_text)}, engine, llm.PROMPT_VERSION,
                 T.input_hash(body.jd_text), engine)
    notify_n8n("job.created", {"job_id": job_id, "title": body.title})
    return {"job_id": job_id, "title": body.title, "requirements": get_requirements(job_id),
            "engine": engine}


@app.post("/jd/analyze_file")
async def jd_analyze_file(title: str = Form("Untitled role"),
                          file: UploadFile = File(...)) -> dict:
    data = await file.read()
    ex = T.extract_text(file.filename, data)
    return jd_analyze(JDIn(title=title, jd_text=ex["text"]))


@app.get("/jobs")
def jobs() -> dict:
    rows = db.q("SELECT * FROM jobs ORDER BY created_at DESC")
    for r in rows:
        r["candidate_count"] = db.one(
            "SELECT COUNT(*) c FROM candidates WHERE job_id=?", (r["job_id"],))["c"]
        r["requirement_count"] = db.one(
            "SELECT COUNT(*) c FROM requirements WHERE job_id=?", (r["job_id"],))["c"]
    return {"jobs": rows}


@app.get("/job")
def job(job_id: str) -> dict:
    row = db.one("SELECT * FROM jobs WHERE job_id=?", (job_id,))
    if not row:
        raise HTTPException(404, "Job not found")
    return {"job": row, "requirements": get_requirements(job_id)}


@app.put("/jd/requirements")
def save_requirements(body: dict = Body(...)) -> dict:
    job_id = body["job_id"]
    reqs = body.get("requirements", [])
    db.ex("DELETE FROM requirements WHERE job_id=?", (job_id,))
    rows = []
    for i, r in enumerate(reqs):
        rows.append((r.get("req_id") or f"R{i+1}", job_id, r["text"],
                     "nice" if r.get("priority") == "nice" else "must",
                     r.get("category", "experience"), db.js(r.get("keywords", [])), 1, i))
    db.exmany("""INSERT INTO requirements (req_id,job_id,text,priority,category,keywords,
                 edited_by_human,sort_order) VALUES (?,?,?,?,?,?,?,?)""", rows)
    db.log_audit(job_id, None, "requirements_edited", job_id,
                 {"count": len(rows)}, "human", llm.PROMPT_VERSION)
    return {"ok": True, "requirements": get_requirements(job_id)}


# ============================================================ candidates

def _ingest(job_id: str, file_name: str, raw_text: str, warnings: list[str]) -> dict:
    nums = [int(r["label"][1:]) for r in
            db.q("SELECT label FROM candidates WHERE job_id=?", (job_id,))
            if r["label"][1:].isdigit()]
    label = f"C{max(nums, default=0) + 1}"
    red = T.redact(raw_text)
    display = (red["pii_map"].get("name") or [None])[0]
    cid = db.nid("cand")
    db.ex("""INSERT INTO candidates (candidate_id,job_id,label,display_name,file_name,
             raw_text,redacted_text,pii_map,status,grp,score,must_score,nice_score,
             profile,summary,rationale,error,warnings,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
          (cid, job_id, label, display, file_name, raw_text, red["redacted_text"],
           db.js(red["pii_map"]), "ingested", None, None, None, None,
           db.js({}), None, None, None, db.js(warnings), db.now()))
    db.log_audit(job_id, cid, "ingest", cid,
                 {"file": file_name, "redactions": red["redactions"]},
                 "deterministic", llm.PROMPT_VERSION, T.input_hash(raw_text))
    return {"candidate_id": cid, "label": label, "file_name": file_name,
            "warnings": warnings, "redactions": red["redactions"]}


@app.post("/candidates/upload")
async def upload_candidates(job_id: str = Form(...),
                            files: list[UploadFile] = File(...)) -> dict:
    if not db.one("SELECT 1 FROM jobs WHERE job_id=?", (job_id,)):
        raise HTTPException(404, "Job not found")
    out = []
    for f in files:
        data = await f.read()
        ex = T.extract_text(f.filename, data)
        if not ex["text"].strip():
            ex["warnings"].append("No readable text extracted from this file.")
        out.append(_ingest(job_id, f.filename, ex["text"], ex["warnings"]))
    notify_n8n("candidates.ingested", {"job_id": job_id, "count": len(out)})
    return {"candidates": out}


@app.post("/candidates/paste")
def paste_candidate(body: dict = Body(...)) -> dict:
    job_id, text = body["job_id"], body.get("text", "")
    if len(text.strip()) < 60:
        raise HTTPException(400, "That resume looks too short to screen.")
    return {"candidates": [_ingest(job_id, body.get("file_name", "pasted-resume.txt"),
                                   text, [])]}


@app.get("/candidates")
def list_candidates(job_id: str, reveal: bool = False) -> dict:
    rows = db.q("SELECT * FROM candidates WHERE job_id=? ORDER BY label", (job_id,))
    out = []
    for r in rows:
        c = candidate_public(r, reveal)
        c["needs_validation_count"] = db.one(
            "SELECT COUNT(*) c FROM evaluations WHERE candidate_id=? AND needs_validation=1",
            (r["candidate_id"],))["c"]
        c["has_kit"] = bool(db.one("SELECT 1 FROM interview_kits WHERE candidate_id=?",
                                   (r["candidate_id"],)))
        c["has_interview"] = bool(db.one("SELECT 1 FROM interviews WHERE candidate_id=?",
                                         (r["candidate_id"],)))
        iv = db.one("SELECT decision FROM interviews WHERE candidate_id=?", (r["candidate_id"],))
        c["decision"] = iv["decision"] if iv else None
        out.append(c)
    running = any(c["status"] in ("queued", "processing") for c in out)
    return {"candidates": out, "running": running}


@app.get("/candidate")
def candidate_detail(candidate_id: str, reveal: bool = False) -> dict:
    row = db.one("SELECT * FROM candidates WHERE candidate_id=?", (candidate_id,))
    if not row:
        raise HTTPException(404, "Candidate not found")
    evals = [evaluation_public(e) for e in
             db.q("SELECT * FROM evaluations WHERE candidate_id=? ORDER BY req_id", (candidate_id,))]
    evals.sort(key=lambda e: int(e["req_id"][1:]) if e["req_id"][1:].isdigit() else 99)
    return {
        "candidate": candidate_public(row, reveal),
        "evaluations": evals,
        "requirements": get_requirements(row["job_id"]),
        "redacted_text": row["redacted_text"],
        "raw_text": row["raw_text"] if reveal else None,
        "pii_map": db.unjs(row["pii_map"], {}) if reveal else {},
    }


@app.delete("/candidate")
def delete_candidate(candidate_id: str) -> dict:
    for table in ("candidates", "evaluations", "interview_kits", "interviews"):
        db.ex(f"DELETE FROM {table} WHERE candidate_id=?", (candidate_id,))
    return {"ok": True}


# ============================================================ screening

def screen_one(cand: dict, requirements: list[dict]) -> None:
    cid = cand["candidate_id"]
    prior_status = cand.get("status")
    kept = {r["req_id"]: r for r in db.q(
        "SELECT * FROM evaluations WHERE candidate_id=? AND overridden_by_human=1", (cid,))}
    db.ex("UPDATE candidates SET status='processing' WHERE candidate_id=?", (cid,))
    try:
        result, engine = llm.screen_resume(requirements, cand["redacted_text"])
        evals = result["evaluations"]

        # 1. verify every quote against the anonymised source
        items = [{"id": e["req_id"], "quote": e.get("quote", "")} for e in evals
                 if e["status"] != "missing"]
        vres = {v["id"]: v for v in T.verify_quotes(cand["redacted_text"], items)}

        # 2. one repair pass for failures (LLM engines only)
        failed = [e for e in evals if e["status"] in ("met", "partial")
                  and not vres.get(e["req_id"], {}).get("verified")]
        if failed and llm.configured():
            repaired = llm.repair_quotes(failed, requirements, cand["redacted_text"])
            rmap = {r.get("req_id"): r for r in repaired}
            for e in evals:
                if e["req_id"] in rmap:
                    r = rmap[e["req_id"]]
                    e["quote"] = str(r.get("quote") or "")
                    e["status"] = r.get("status", e["status"])
                    e["reasoning"] = r.get("reasoning", e["reasoning"])
            items = [{"id": e["req_id"], "quote": e.get("quote", "")} for e in evals
                     if e["status"] != "missing"]
            vres = {v["id"]: v for v in T.verify_quotes(cand["redacted_text"], items)}

        # 3. anything still unverified cannot claim met/partial
        for e in evals:
            v = vres.get(e["req_id"], {})
            e["quote_verified"] = bool(v.get("verified"))
            e["verify_method"] = v.get("method", "none")
            e["span_start"], e["span_end"] = v.get("start"), v.get("end")
            if e["status"] in ("met", "partial") and not e["quote_verified"]:
                e["status"] = "unclear"
                e["needs_validation"] = True
                e["reasoning"] = ("Evidence could not be located in the resume text, so this "
                                  "was downgraded automatically. " + e.get("reasoning", ""))
                e["validation_note"] = e.get("validation_note") or "Confirm this claim directly."

        # 4. a recruiter's override always outranks a fresh AI pass
        for e in evals:
            if e["req_id"] in kept:
                e["status"] = kept[e["req_id"]]["status"]
                e["reasoning"] = kept[e["req_id"]]["reasoning"]
                e["overridden"] = True

        grouped = T.group_candidate(requirements, evals)

        db.ex("DELETE FROM evaluations WHERE candidate_id=?", (cid,))
        db.exmany("""INSERT INTO evaluations (eval_id,candidate_id,req_id,status,quote,
                     quote_verified,verify_method,span_start,span_end,reasoning,
                     needs_validation,validation_note,model,prompt_version,
                     overridden_by_human,created_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                  [(db.nid("ev"), cid, e["req_id"], e["status"], e.get("quote", ""),
                    int(bool(e.get("quote_verified"))), e.get("verify_method", "none"),
                    e.get("span_start"), e.get("span_end"), e.get("reasoning", ""),
                    int(bool(e.get("needs_validation"))), e.get("validation_note", ""),
                    engine, llm.PROMPT_VERSION, int(bool(e.get("overridden"))), db.now())
                   for e in evals])

        keep_status = prior_status if prior_status in ("interview_ready", "interviewed", "decided") \
            else "screened"
        db.ex("""UPDATE candidates SET status=?, grp=?, score=?, must_score=?,
                 nice_score=?, profile=?, summary=?, rationale=?, error=NULL
                 WHERE candidate_id=?""",
              (keep_status, grouped["group"], grouped["score"], grouped["must_score"],
               grouped["nice_score"], db.js(result.get("profile", {})),
               result.get("summary", ""), grouped["rationale"], cid))

        verified = sum(1 for e in evals if e.get("quote_verified"))
        db.log_audit(cand["job_id"], cid, "screening", cid,
                     {"source": "redacted_text", "requirements": [r["req_id"] for r in requirements],
                      "quotes_verified": verified, "quotes_checked": len(items),
                      "group_rule": grouped["rationale"]},
                     engine, llm.PROMPT_VERSION, T.input_hash(cand["redacted_text"]), engine)
    except Exception as exc:  # keep the pipeline alive
        db.ex("UPDATE candidates SET status='error', error=? WHERE candidate_id=?",
              (str(exc)[:400], cid))


def run_screening(job_id: str, run_id: str, force: bool = False) -> None:
    reqs = get_requirements(job_id)
    states = ("ingested", "queued", "error") + (
        ("screened", "interview_ready", "interviewed", "decided") if force else ())
    pending = db.q(f"""SELECT * FROM candidates WHERE job_id=?
                      AND status IN ({",".join("?" * len(states))}) ORDER BY label""",
                   (job_id, *states))
    RUNS[run_id] = {"total": len(pending), "done": 0, "job_id": job_id, "state": "running"}
    for c in pending:
        db.ex("UPDATE candidates SET status='queued' WHERE candidate_id=?", (c["candidate_id"],))
    for c in pending:
        screen_one(c, reqs)
        RUNS[run_id]["done"] += 1
        if llm.configured():
            time.sleep(float(os.getenv("SCREEN_DELAY", "2")))  # respect provider rate limits
    RUNS[run_id]["state"] = "done"
    notify_n8n("screening.completed", {"job_id": job_id, "screened": len(pending)})


@app.post("/screening/run")
def screening_run(body: dict = Body(...)) -> dict:
    job_id = body["job_id"]
    reqs = get_requirements(job_id)
    if not reqs:
        raise HTTPException(400, "Define requirements before screening.")
    if USE_N8N and N8N_BASE and not body.get("force"):
        try:
            r = httpx.post(f"{N8N_BASE}/webhook/hireflow/screening",
                           headers={"X-API-Key": N8N_KEY} if N8N_KEY else {},
                           json={"job_id": job_id}, timeout=10.0)
            if r.status_code < 400:
                return {"run_id": f"n8n_{job_id}", "orchestrator": "n8n", "accepted": True}
        except Exception:
            pass  # fall through to in-process screening
    run_id = db.nid("run")
    threading.Thread(target=run_screening, args=(job_id, run_id, bool(body.get("force"))),
                     daemon=True).start()
    return {"run_id": run_id, "orchestrator": "api", "accepted": True}


@app.get("/screening/pending")
def screening_pending(job_id: str) -> dict:
    """Used by the n8n orchestrator to drive its loop."""
    rows = db.q("""SELECT candidate_id,label,file_name,status FROM candidates
                   WHERE job_id=? AND status IN ('ingested','queued','error')
                   ORDER BY label""", (job_id,))
    for r in rows:
        db.ex("UPDATE candidates SET status='queued' WHERE candidate_id=?", (r["candidate_id"],))
    return {"job_id": job_id, "count": len(rows), "candidates": rows}


@app.post("/screening/candidate")
def screening_candidate(body: dict = Body(...)) -> dict:
    """Screen exactly one candidate. n8n calls this once per loop iteration."""
    cid = body["candidate_id"]
    cand = db.one("SELECT * FROM candidates WHERE candidate_id=?", (cid,))
    if not cand:
        raise HTTPException(404, "Candidate not found")
    screen_one(cand, get_requirements(cand["job_id"]))
    row = db.one("SELECT * FROM candidates WHERE candidate_id=?", (cid,))
    return {"candidate": candidate_public(row), "ok": row["status"] == "screened"}


@app.get("/screening/status")
def screening_status(run_id: str) -> dict:
    return RUNS.get(run_id, {"state": "unknown"})


@app.post("/evaluation/override")
def override_eval(body: dict = Body(...)) -> dict:
    """Recruiters can overrule the AI. The override is stored and audited."""
    eval_id, status = body["eval_id"], body["status"]
    if status not in ("met", "partial", "unclear", "missing"):
        raise HTTPException(400, "Unknown status")
    row = db.one("SELECT * FROM evaluations WHERE eval_id=?", (eval_id,))
    if not row:
        raise HTTPException(404, "Evaluation not found")
    db.ex("""UPDATE evaluations SET status=?, overridden_by_human=1,
             reasoning=? WHERE eval_id=?""",
          (status, f"Set to '{status}' by the recruiter. Previous AI status: "
                   f"'{row['status']}'. " + (row["reasoning"] or ""), eval_id))
    cand = db.one("SELECT * FROM candidates WHERE candidate_id=?", (row["candidate_id"],))
    reqs = get_requirements(cand["job_id"])
    evals = db.q("SELECT * FROM evaluations WHERE candidate_id=?", (row["candidate_id"],))
    grouped = T.group_candidate(reqs, [{"req_id": e["req_id"], "status": e["status"],
                                        "needs_validation": e["needs_validation"]} for e in evals])
    db.ex("UPDATE candidates SET grp=?, score=?, must_score=?, nice_score=?, rationale=? "
          "WHERE candidate_id=?",
          (grouped["group"], grouped["score"], grouped["must_score"],
           grouped["nice_score"], grouped["rationale"], row["candidate_id"]))
    db.log_audit(cand["job_id"], row["candidate_id"], "human_override", eval_id,
                 {"req_id": row["req_id"], "from": row["status"], "to": status},
                 "human", llm.PROMPT_VERSION)
    return {"ok": True, "grouped": grouped}


# ============================================================ interview

@app.post("/interview/kit")
def make_kit(body: dict = Body(...)) -> dict:
    cid = body["candidate_id"]
    cand = db.one("SELECT * FROM candidates WHERE candidate_id=?", (cid,))
    if not cand:
        raise HTTPException(404, "Candidate not found")
    reqs = get_requirements(cand["job_id"])
    evals = [evaluation_public(e) for e in
             db.q("SELECT * FROM evaluations WHERE candidate_id=?", (cid,))]
    if not evals:
        raise HTTPException(400, "Screen this candidate before building an interview kit.")
    kit, engine = llm.interview_kit(reqs, evals, cand["summary"] or "",
                                    cand["redacted_text"] or "")
    db.ex("DELETE FROM interview_kits WHERE candidate_id=?", (cid,))
    db.ex("INSERT INTO interview_kits (kit_id,candidate_id,questions,created_at) VALUES (?,?,?,?)",
          (db.nid("kit"), cid, db.js(kit), db.now()))
    db.ex("UPDATE candidates SET status='interview_ready' WHERE candidate_id=?", (cid,))
    db.log_audit(cand["job_id"], cid, "interview_kit", cid,
                 {"targeted_requirements": [q.get("req_id") for q in kit.get("questions", [])]},
                 engine, llm.PROMPT_VERSION, "", engine)
    notify_n8n("interview.kit_ready", {"candidate_id": cid, "label": cand["label"]})
    return {"kit": kit, "engine": engine}


@app.get("/interview")
def get_interview(candidate_id: str) -> dict:
    kit = db.one("SELECT * FROM interview_kits WHERE candidate_id=?", (candidate_id,))
    iv = db.one("SELECT * FROM interviews WHERE candidate_id=?", (candidate_id,))
    return {
        "kit": db.unjs(kit["questions"], None) if kit else None,
        "interview": {
            **iv,
            "mapping": db.unjs(iv["mapping"], []),
            "unanswered": db.unjs(iv["unanswered"], []),
            "followups": db.unjs(iv["followups"], []),
            "report": db.unjs(iv["report"], {}),
        } if iv else None,
    }


def _apply_interview_validation(candidate_id: str, requirements: list[dict],
                                mapping: list[dict]) -> dict:
    """Translate validated interview evidence into existing deterministic statuses."""
    status_map = {"demonstrated": "met", "partially_demonstrated": "partial",
                  "still_unverified": "unclear"}
    rows = {row["req_id"]: row for row in db.q(
        "SELECT * FROM evaluations WHERE candidate_id=?", (candidate_id,))}
    for item in mapping:
        row = rows.get(item.get("req_id"))
        if not row or row["overridden_by_human"]:
            continue
        evidence_status = item.get("evidence_status")
        if evidence_status not in status_map:
            evidence_status = {"covered": "demonstrated", "partial": "partially_demonstrated",
                               "not_covered": "still_unverified"}.get(item.get("coverage"))
        if evidence_status not in status_map:
            continue
        status = status_map[evidence_status]
        if item.get("supporting_quote") and not item.get("quote_verified"):
            status = "unclear"
        reasoning = item.get("reasoning") or "Interview validation completed."
        missing = item.get("missing_evidence") or ""
        follow_up = item.get("follow_up_question") or item.get("follow_up") or ""
        note = "Interview validation: " + reasoning
        if missing:
            note += " Missing evidence: " + missing
        if follow_up:
            note += " Follow-up: " + follow_up
        db.ex("""UPDATE evaluations SET status=?, needs_validation=?, validation_note=?,
                 reasoning=? WHERE eval_id=?""",
              (status, int(status in ("partial", "unclear")), note[:1200], reasoning, row["eval_id"]))

    cand = db.one("SELECT * FROM candidates WHERE candidate_id=?", (candidate_id,))
    refreshed = db.q("SELECT * FROM evaluations WHERE candidate_id=?", (candidate_id,))
    grouped = T.group_candidate(requirements, [
        {"req_id": e["req_id"], "status": e["status"],
         "needs_validation": bool(e["needs_validation"])} for e in refreshed])
    db.ex("""UPDATE candidates SET grp=?, score=?, must_score=?, nice_score=?, rationale=?
             WHERE candidate_id=?""",
          (grouped["group"], grouped["score"], grouped["must_score"],
           grouped["nice_score"], grouped["rationale"], candidate_id))
    return grouped


@app.post("/interview/evaluate")
def evaluate_interview(body: dict = Body(...)) -> dict:
    cid, notes = body["candidate_id"], body.get("notes", "")
    if len(notes.strip()) < 80:
        raise HTTPException(400, "Paste fuller interview notes - a few lines at minimum.")
    cand = db.one("SELECT * FROM candidates WHERE candidate_id=?", (cid,))
    if not cand:
        raise HTTPException(404, "Candidate not found")
    reqs = get_requirements(cand["job_id"])
    evals = [evaluation_public(e) for e in
             db.q("SELECT * FROM evaluations WHERE candidate_id=?", (cid,))]
    kit_row = db.one("SELECT questions FROM interview_kits WHERE candidate_id=?", (cid,))
    kit = db.unjs(kit_row["questions"], {}) if kit_row else {}
    res, engine = llm.evaluate_interview(reqs, evals, notes,
                                         cand["redacted_text"] or "", kit)
    mapping = res.get("mapping", [])
    coverage_status = {"covered": "demonstrated", "partial": "partially_demonstrated",
                       "not_covered": "still_unverified"}
    for m in mapping:
        m.setdefault("evidence_status", coverage_status.get(m.get("coverage"),
                                                              "still_unverified"))
        m.setdefault("reasoning", "")
        m.setdefault("missing_evidence", "")
        m.setdefault("follow_up_question", m.get("follow_up", ""))

    # verify interview quotes against the notes; unverifiable evidence cannot count
    items = [{"id": m["req_id"], "quote": m.get("notes_quote", "")} for m in mapping
             if m.get("notes_quote")]
    vres = {v["id"]: v for v in T.verify_quotes(notes, items)}
    for m in mapping:
        v = vres.get(m["req_id"], {})
        m["quote_verified"] = bool(v.get("verified"))
        if m.get("notes_quote") and not m["quote_verified"]:
            m["coverage"] = "not_covered"
            m["evidence_strength"] = "none"
            m["notes_quote"] = ""
            m["follow_up"] = (m.get("follow_up") or "") + " (Quoted evidence could not be " \
                             "found in the notes, so this was downgraded.)"

    _apply_interview_validation(cid, reqs, mapping)

    by_req = {r["req_id"]: r for r in reqs}
    evals = [evaluation_public(e) for e in
             db.q("SELECT * FROM evaluations WHERE candidate_id=?", (cid,))]
    res_by_req = {e["req_id"]: e for e in evals}
    unanswered = [{"req_id": m["req_id"], "text": by_req.get(m["req_id"], {}).get("text", ""),
                   "priority": by_req.get(m["req_id"], {}).get("priority", "must")}
                  for m in mapping if m.get("coverage") == "not_covered"]
    followups = [{"req_id": m["req_id"], "follow_up": m["follow_up"]}
                 for m in mapping if m.get("follow_up")]

    covered = sum(1 for m in mapping if m.get("coverage") == "covered")
    report = {
        "header": {"candidate_label": cand["label"], "job_id": cand["job_id"],
                   "generated_at": db.now(), "engine": engine,
                   "prompt_version": llm.PROMPT_VERSION},
        "coverage_summary": {"covered": covered,
                             "partial": sum(1 for m in mapping if m.get("coverage") == "partial"),
                             "not_covered": len(unanswered), "total": len(mapping)},
        "requirement_table": [{
            "req_id": m["req_id"],
            "requirement": by_req.get(m["req_id"], {}).get("text", ""),
            "priority": by_req.get(m["req_id"], {}).get("priority", "must"),
            "resume_evidence": res_by_req.get(m["req_id"], {}).get("quote", ""),
            "resume_status": res_by_req.get(m["req_id"], {}).get("status", "missing"),
            "interview_evidence": m.get("notes_quote", ""),
            "coverage": m.get("coverage", "not_covered"),
            "evidence_status": m.get("evidence_status", "still_unverified"),
            "reasoning": m.get("reasoning", ""),
            "missing_evidence": m.get("missing_evidence", ""),
            "follow_up_question": m.get("follow_up_question", m.get("follow_up", "")),
            "evidence_strength": m.get("evidence_strength", "none"),
            "open_question": m.get("follow_up", ""),
        } for m in mapping],
        "strengths": res.get("strengths", []),
        "concerns": res.get("concerns", []),
        "next_validation": res.get("next_validation", []),
        "interviewer_rating": None,
        "recruiter_decision": None,
        "note": "Ratings and decisions are left blank on purpose. HireFlow reports "
                "evidence strength; the hiring team decides.",
    }

    db.ex("DELETE FROM interviews WHERE candidate_id=?", (cid,))
    db.ex("""INSERT INTO interviews (interview_id,candidate_id,notes_raw,mapping,unanswered,
             followups,report,decision,decision_note,decided_by,decided_at,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
          (db.nid("iv"), cid, notes, db.js(mapping), db.js(unanswered), db.js(followups),
           db.js(report), None, None, None, None, db.now()))
    db.ex("UPDATE candidates SET status='interviewed' WHERE candidate_id=?", (cid,))
    db.log_audit(cand["job_id"], cid, "interview_report", cid,
                 {"source": "interview_notes", "notes_chars": len(notes),
                  "verified_quotes": sum(1 for m in mapping if m.get("quote_verified")),
                  "unanswered": [u["req_id"] for u in unanswered],
                  "validation_trace": [{
                      "req_id": m.get("req_id"),
                      "resume_evidence": res_by_req.get(m.get("req_id"), {}).get("quote", ""),
                      "question": next((q.get("question", "") for q in
                                        kit.get("questions", []) if q.get("req_id") == m.get("req_id")), ""),
                      "answer_quote": m.get("notes_quote", ""),
                      "evidence_status": m.get("evidence_status"),
                      "reasoning": m.get("reasoning", ""),
                  } for m in mapping]},
                 engine, llm.PROMPT_VERSION, T.input_hash(notes), engine)
    notify_n8n("interview.evaluated", {"candidate_id": cid, "label": cand["label"]})
    return {"report": report, "mapping": mapping, "unanswered": unanswered,
            "followups": followups, "engine": engine}


@app.post("/interview/decision")
def record_decision(body: dict = Body(...)) -> dict:
    cid = body["candidate_id"]
    decision = body.get("decision")
    if decision not in ("advance", "hold", "reject"):
        raise HTTPException(400, "Decision must be advance, hold or reject.")
    iv = db.one("SELECT * FROM interviews WHERE candidate_id=?", (cid,))
    if not iv:
        raise HTTPException(400, "Generate the interview report first.")
    db.ex("""UPDATE interviews SET decision=?, decision_note=?, decided_by=?, decided_at=?
             WHERE candidate_id=?""",
          (decision, body.get("note", ""), body.get("author", "recruiter"), db.now(), cid))
    rating = body.get("rating")
    if rating not in (None, ""):
        report = db.unjs(iv["report"], {})
        report["interviewer_rating"] = int(rating)  # human-assigned, never AI-assigned
        report["recruiter_decision"] = decision
        db.ex("UPDATE interviews SET report=? WHERE candidate_id=?", (db.js(report), cid))
    db.ex("UPDATE candidates SET status='decided' WHERE candidate_id=?", (cid,))
    cand = db.one("SELECT * FROM candidates WHERE candidate_id=?", (cid,))
    db.log_audit(cand["job_id"], cid, "human_decision", cid,
                 {"decision": decision, "author": body.get("author", "recruiter"),
                  "note": body.get("note", ""), "rating": body.get("rating")}, "human", llm.PROMPT_VERSION)
    notify_n8n("candidate.decided", {"candidate_id": cid, "decision": decision})
    return {"ok": True}


# ============================================================ chat

PROTECTED_RE = re.compile(
    r"\b(gender|male|female|man|men|woman|women|girl|boy|age|aged|how old|too old|too young|"
    r"older than|younger than|\d+\s*years?\s*old|race|racial|ethnic\w*|nationality|religio\w*|"
    r"caste|married|marital|pregnan\w*|disab\w*|sexual\w*|immigra\w*|foreigner)\b", re.I)
DECISION_RE = re.compile(
    r"\b(should (i|we) (hire|reject|pick|choose)|who (should|do) (i|we) (hire|reject|pick)|"
    r"hire (him|her|them)|reject (him|her|them)|best hire|make (the|an) offer|final (pick|decision))\b", re.I)
CITE_RE = re.compile(r"\[(C\d+):(R\d+)\]")

STATUS_RANK = {"met": 3, "partial": 2, "unclear": 1, "missing": 0}


def build_compare(job_id: str, labels: list[str]) -> dict:
    """Side-by-side matrix. Every cell is copied from stored evaluations - nothing generated."""
    reqs = get_requirements(job_id)
    cands = [c for c in db.q("SELECT * FROM candidates WHERE job_id=? ORDER BY label", (job_id,))
             if c["label"] in labels]
    matrix: dict[str, dict] = {r["req_id"]: {} for r in reqs}
    for c in cands:
        for e in db.q("SELECT * FROM evaluations WHERE candidate_id=?", (c["candidate_id"],)):
            if e["req_id"] in matrix:
                matrix[e["req_id"]][c["label"]] = {
                    "status": e["status"], "quote": e["quote"],
                    "quote_verified": bool(e["quote_verified"]),
                    "needs_validation": bool(e["needs_validation"]),
                    "eval_id": e["eval_id"], "candidate_id": c["candidate_id"],
                }
    differing, edges = [], []
    for r in reqs:
        cells = matrix[r["req_id"]]
        ranks = {lb: STATUS_RANK.get(cell["status"], 0) for lb, cell in cells.items()}
        if len(set(ranks.values())) > 1:
            differing.append(r["req_id"])
            top = max(ranks.values())
            leaders = [lb for lb, v in ranks.items() if v == top]
            if len(leaders) == 1:
                edges.append({"req_id": r["req_id"], "label": leaders[0],
                              "text": f"Only {leaders[0]} reaches '{cells[leaders[0]]['status']}' "
                                      f"on {r['req_id']} ({r['text'][:70]})."})
    return {
        "requirements": reqs,
        "candidates": [{"candidate_id": c["candidate_id"], "label": c["label"],
                        "display_name": c["display_name"], "group": c["grp"], "score": c["score"],
                        "must_score": c["must_score"], "summary": c["summary"],
                        "rationale": c["rationale"]} for c in cands],
        "matrix": matrix, "differing": differing, "edges": edges,
    }


@app.get("/compare")
def compare(job_id: str, labels: str) -> dict:
    wanted = [x.strip().upper() for x in labels.split(",") if x.strip()][:3]
    if len(wanted) < 2:
        raise HTTPException(400, "Pick two or three candidates to compare.")
    return build_compare(job_id, wanted)


def chat_guard(message: str) -> str | None:
    """Returns a refusal/redirect message, or None when the question is fine."""
    if PROTECTED_RE.search(message):
        return ("I can't filter, rank or describe candidates by protected attributes such as gender, "
                "age, nationality, religion, marital status, disability or ethnicity - and screening "
                "was done on redacted text so I have no such data. Ask me about skills, "
                "experience or evidence against a requirement instead.")
    return None


def build_pool_context(job_id: str) -> tuple[str, dict]:
    reqs = get_requirements(job_id)
    lines = ["REQUIREMENTS:"]
    for r in reqs:
        lines.append(f"{r['req_id']} ({r['priority']}): {r['text']}")
    cands = db.q("SELECT * FROM candidates WHERE job_id=? ORDER BY label", (job_id,))
    index: dict[str, Any] = {"requirements": {r["req_id"]: r for r in reqs}, "candidates": {}}
    for c in cands:
        evs = db.q("SELECT * FROM evaluations WHERE candidate_id=? ORDER BY req_id",
                   (c["candidate_id"],))
        index["candidates"][c["label"]] = {"row": c, "evals": evs}
        lines.append(f"\nCANDIDATE {c['label']} | group={c['grp']} | score={c['score']} | "
                     f"status={c['status']}")
        lines.append(f"summary: {c['summary'] or 'not screened yet'}")
        for e in evs:
            lines.append(f"  [{c['label']}:{e['req_id']}] {e['status']}"
                         f"{' (verified)' if e['quote_verified'] else ''} :: "
                         f"{(e['quote'] or '')[:180]}")
    return "\n".join(lines), index


def local_chat(job_id: str, message: str, index: dict) -> dict:
    """Retrieval answer used when no LLM is configured."""
    msg = message.lower()
    cands = index["candidates"]
    reqs = index["requirements"]
    citations, lines = [], []

    wanted_reqs = [rid for rid in reqs if rid.lower() in msg]
    if not wanted_reqs:
        for rid, r in reqs.items():
            tok = llm.tokens(r["text"]) | set(r.get("keywords") or [])
            if len(tok & llm.tokens(message)) >= 2:
                wanted_reqs.append(rid)

    if any(w in msg for w in ("strong", "shortlist", "best", "top", "advance")):
        strong = [(l, d) for l, d in cands.items() if d["row"]["grp"] == "Strong"]
        if strong:
            lines.append(f"{len(strong)} candidate(s) sit in the Strong group on the "
                         f"code-based rule (must-have coverage >= 0.75, no missing must-have):")
            for label, d in sorted(strong, key=lambda x: -(x[1]["row"]["score"] or 0)):
                lines.append(f"- {label}, score {d['row']['score']}. {d['row']['rationale']}")
                citations.append({"candidate_label": label, "req_id": "",
                                  "why": d["row"]["rationale"] or ""})
        else:
            lines.append("No candidate currently reaches the Strong threshold. "
                         "The closest are the Potential group.")
    elif any(w in msg for w in ("validat", "unclear", "gap", "missing", "risk")):
        for label, d in cands.items():
            flags = [e for e in d["evals"] if e["needs_validation"]]
            if flags:
                lines.append(f"{label} has {len(flags)} item(s) needing validation: "
                             + ", ".join(f"{e['req_id']} ({e['status']})" for e in flags))
                for e in flags[:3]:
                    citations.append({"candidate_label": label, "req_id": e["req_id"],
                                      "why": e["validation_note"] or e["reasoning"] or ""})
    elif wanted_reqs:
        for rid in wanted_reqs[:3]:
            lines.append(f"{rid} - {reqs[rid]['text']}:")
            for label, d in cands.items():
                e = next((x for x in d["evals"] if x["req_id"] == rid), None)
                if e and e["status"] in ("met", "partial"):
                    lines.append(f"- {label} [{e['status']}]: \"{(e['quote'] or '')[:150]}\"")
                    citations.append({"candidate_label": label, "req_id": rid,
                                      "why": e["reasoning"] or ""})
            if len(lines) and lines[-1].endswith(":"):
                lines.append("- No candidate has verified evidence for this requirement.")
    else:
        lines.append("Here is where the pool stands:")
        for label, d in sorted(cands.items(), key=lambda x: -(x[1]["row"]["score"] or 0)):
            r = d["row"]
            lines.append(f"- {label}: {r['grp'] or 'not screened'}"
                         + (f", score {r['score']}. {r['rationale']}" if r["score"] is not None else ""))
            citations.append({"candidate_label": label, "req_id": "", "why": r["rationale"] or ""})

    if not lines:
        lines = ["I do not have evidence in this pool to answer that."]
    lines.append("\nThese are evidence summaries, not hiring recommendations.")
    return {"answer": "\n".join(lines), "citations": citations[:12]}


@app.post("/chat")
def chat(body: dict = Body(...)) -> dict:
    job_id = body["job_id"]
    session_id = body.get("session_id", "default")
    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(400, "Type a question about the pool.")
    context, index = build_pool_context(job_id)
    refusal = chat_guard(message)
    if refusal:
        db.ex("INSERT INTO chat_messages (msg_id,job_id,session_id,role,content,citations,created_at)"
              " VALUES (?,?,?,?,?,?,?)",
              (db.nid("msg"), job_id, session_id, "user", message, db.js([]), db.now()))
        db.ex("INSERT INTO chat_messages (msg_id,job_id,session_id,role,content,citations,created_at)"
              " VALUES (?,?,?,?,?,?,?)",
              (db.nid("msg"), job_id, session_id, "assistant", refusal, db.js([]), db.now()))
        db.log_audit(job_id, None, "chat_refusal", session_id,
                     {"question": message, "reason": "protected-attribute query"},
                     "guardrail", llm.PROMPT_VERSION)
        return {"answer": refusal, "citations": [], "engine": "guardrail", "refused": True}

    labels = sorted({m.upper() for m in re.findall(r"\bC\d+\b", message, re.I)
                     if m.upper() in index["candidates"]})
    if len(labels) >= 2 and re.search(r"compar|versus|\bvs\b|differ|between", message, re.I):
        cmp_ = build_compare(job_id, labels[:3])
        lines = [f"Comparing {', '.join(labels[:3])} requirement by requirement:"]
        cites = []
        for r in cmp_["requirements"]:
            cells = cmp_["matrix"][r["req_id"]]
            lines.append(f"- {r['req_id']} ({r['priority']}): " +
                         "; ".join(f"{lb} {cells[lb]['status']}" for lb in labels[:3] if lb in cells))
            if r["req_id"] in cmp_["differing"]:
                for lb in labels[:3]:
                    if lb in cells:
                        cites.append({"candidate_label": lb, "req_id": r["req_id"],
                                      "why": cells[lb]["quote"] or "No supporting text"})
        lines += [e["text"] for e in cmp_["edges"][:3]]
        lines.append("\nThese are evidence summaries, not hiring recommendations.")
        data, engine = {"answer": "\n".join(lines), "citations": cites[:12]}, "local-evidence-engine"
    elif DECISION_RE.search(message):
        data = local_chat(job_id, "who is strongest", index)
        data["answer"] = ("I can't recommend who to hire or reject - that decision stays with you. "
                          "What I can do is show the evidence.\n\n" + data["answer"])
        engine = "local-evidence-engine"
    else:
        history = db.q("""SELECT role, content FROM chat_messages WHERE job_id=? AND session_id=?
                          ORDER BY created_at""", (job_id, session_id))
        data, engine = llm.chat_answer(context, history, message)
        if not data:
            data = local_chat(job_id, message, index)
            engine = "local-evidence-engine"

    # citation post-check: drop any citation that does not exist in the data
    valid = []
    for c in data.get("citations", []):
        label, rid = c.get("candidate_label"), c.get("req_id") or ""
        if label in index["candidates"] and (not rid or rid in index["requirements"]):
            c["candidate_id"] = index["candidates"][label]["row"]["candidate_id"]
            valid.append(c)
    # tokens like [C2:R3] typed into the answer text must exist too, otherwise they are stripped
    def _tok(m):
        lb, rq = m.group(1), m.group(2)
        ok = lb in index["candidates"] and rq in index["requirements"]
        if ok and not any(v.get("candidate_label") == lb and v.get("req_id") == rq for v in valid):
            valid.append({"candidate_label": lb, "req_id": rq, "why": "",
                          "candidate_id": index["candidates"][lb]["row"]["candidate_id"]})
        return m.group(0) if ok else ""
    data["answer"] = CITE_RE.sub(_tok, data.get("answer", ""))
    data["citations"] = valid

    db.ex("INSERT INTO chat_messages (msg_id,job_id,session_id,role,content,citations,created_at)"
          " VALUES (?,?,?,?,?,?,?)",
          (db.nid("msg"), job_id, session_id, "user", message, db.js([]), db.now()))
    db.ex("INSERT INTO chat_messages (msg_id,job_id,session_id,role,content,citations,created_at)"
          " VALUES (?,?,?,?,?,?,?)",
          (db.nid("msg"), job_id, session_id, "assistant", data["answer"],
           db.js(valid), db.now()))
    db.log_audit(job_id, None, "chat_answer", session_id,
                 {"question": message, "citations": valid}, engine, llm.PROMPT_VERSION)
    return {**data, "engine": engine}


@app.get("/chat/history")
def chat_history(job_id: str, session_id: str = "default") -> dict:
    rows = db.q("""SELECT * FROM chat_messages WHERE job_id=? AND session_id=?
                   ORDER BY created_at""", (job_id, session_id))
    for r in rows:
        r["citations"] = db.unjs(r["citations"], [])
    return {"messages": rows}


# ============================================================ audit + demo

@app.get("/audit")
def audit(job_id: str | None = None, candidate_id: str | None = None) -> dict:
    if candidate_id:
        rows = db.q("SELECT * FROM audit_log WHERE candidate_id=? ORDER BY timestamp DESC",
                    (candidate_id,))
    elif job_id:
        rows = db.q("SELECT * FROM audit_log WHERE job_id=? ORDER BY timestamp DESC LIMIT 300",
                    (job_id,))
    else:
        rows = db.q("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 300")
    for r in rows:
        r["sources"] = db.unjs(r["sources"], {})
        c = db.one("SELECT label FROM candidates WHERE candidate_id=?", (r["candidate_id"],)) \
            if r["candidate_id"] else None
        r["candidate_label"] = c["label"] if c else None
    return {"rows": rows}


@app.get("/stats")
def stats(job_id: str | None = None) -> dict:
    where, args = ("WHERE job_id=?", (job_id,)) if job_id else ("", ())
    cands = db.q(f"SELECT * FROM candidates {where}", args)
    evals = db.q("SELECT * FROM evaluations")
    ev_by_cand = {c["candidate_id"] for c in cands}
    evals = [e for e in evals if e["candidate_id"] in ev_by_cand]
    groups = {"Strong": 0, "Potential": 0, "Weak": 0}
    for c in cands:
        if c["grp"] in groups:
            groups[c["grp"]] += 1
    checked = [e for e in evals if e["quote"]]
    return {
        "candidates": len(cands),
        "screened": sum(1 for c in cands if c["status"] not in ("ingested", "queued", "processing")),
        "groups": groups,
        "needs_validation": sum(1 for e in evals if e["needs_validation"]),
        "evidence_verified_pct": round(100 * sum(1 for e in checked if e["quote_verified"])
                                       / len(checked), 1) if checked else 0.0,
        "status_counts": {s: sum(1 for e in evals if e["status"] == s)
                          for s in ("met", "partial", "unclear", "missing")},
        "interviews": len(db.q("SELECT 1 FROM interviews")),
        "decisions": len(db.q("SELECT 1 FROM interviews WHERE decision IS NOT NULL")),
        "jobs": len(db.q("SELECT 1 FROM jobs")),
    }



# ============================================================ quality (golden set) + demo notes

SEED_DIR = os.path.join(os.path.dirname(__file__), "seed")


@app.get("/quality")
def quality(job_id: str | None = None) -> dict:
    """Evidence quality metrics (PRD 1.9). Golden agreement is computed against seed/golden.json."""
    where, args = ("WHERE c.job_id=?", (job_id,)) if job_id else ("", ())
    rows = db.q(f"""SELECT e.*, c.file_name, c.label FROM evaluations e
                    JOIN candidates c ON c.candidate_id=e.candidate_id {where}""", args)
    claims = [e for e in rows if e["status"] in ("met", "partial")]
    downgraded = [e for e in rows if (e["reasoning"] or "").startswith("Evidence could not be located")]
    verified = [e for e in claims if e["quote_verified"]]
    out: dict[str, Any] = {
        "evaluations": len(rows),
        "claims_with_quote": len(claims),
        "claims_verified": len(verified),
        "verified_share_pct": round(100 * len(verified) / len(claims), 1) if claims else 100.0,
        "auto_downgraded": len(downgraded),
        "human_overrides": sum(1 for e in rows if e["overridden_by_human"]),
        "golden": None,
    }
    gpath = os.path.join(SEED_DIR, "golden.json")
    if not os.path.exists(gpath) or not rows:
        return out
    with open(gpath, encoding="utf-8") as f:
        golden = json.load(f)
    by_file: dict[str, dict] = {}
    for e in rows:
        by_file.setdefault(e["file_name"], {})[e["req_id"]] = e
    exact = adjacent = total = 0
    per_candidate, group_hits, group_total = [], 0, 0
    for fname, exp in golden["candidates"].items():
        got = by_file.get(fname)
        if not got:
            continue
        ex_n = adj_n = n = 0
        for rid, want in exp["statuses"].items():
            if rid not in got:
                continue
            have = got[rid]["status"]
            n += 1
            ex_n += have == want
            adj_n += abs(STATUS_RANK[have] - STATUS_RANK[want]) <= 1
        cand = db.one("SELECT grp, label FROM candidates WHERE file_name=? ORDER BY created_at DESC",
                      (fname,))
        g_ok = bool(cand) and cand["grp"] == exp["group"]
        group_total += 1
        group_hits += g_ok
        exact, adjacent, total = exact + ex_n, adjacent + adj_n, total + n
        per_candidate.append({"label": cand["label"] if cand else "", "file": fname,
                              "expected_group": exp["group"], "actual_group": cand["grp"] if cand else None,
                              "group_match": g_ok, "exact": ex_n, "adjacent": adj_n, "total": n,
                              "design_note": exp.get("designed_to_test", "")})
    if total:
        out["golden"] = {
            "candidates": len(per_candidate),
            "status_exact_pct": round(100 * exact / total, 1),
            "status_within_one_pct": round(100 * adjacent / total, 1),
            "group_match": f"{group_hits}/{group_total}",
            "items": total, "per_candidate": per_candidate,
            "note": "Hand-labelled expectations for the synthetic seed pool. 'Within one' allows "
                    "a neighbouring status (e.g. partial vs met).",
        }
    return out


@app.get("/demo/notes")
def demo_notes(candidate_id: str) -> dict:
    """Sample interview notes for the seeded candidates, so the interview flow demos in one click."""
    cand = db.one("SELECT file_name FROM candidates WHERE candidate_id=?", (candidate_id,))
    if not cand:
        raise HTTPException(404, "Candidate not found")
    path = os.path.join(SEED_DIR, "notes", cand["file_name"])
    if not os.path.exists(path):
        return {"notes": None}
    with open(path, encoding="utf-8") as f:
        return {"notes": f.read()}


@app.post("/demo/load")
def demo_load(body: dict = Body(default={})) -> dict:
    """Seeds a realistic role plus synthetic resumes, then screens them."""
    seed_dir = os.path.join(os.path.dirname(__file__), "seed")
    with open(os.path.join(seed_dir, "job.json"), encoding="utf-8") as f:
        job = json.load(f)
    res = jd_analyze(JDIn(title=job["title"], jd_text=job["jd_text"]))
    job_id = res["job_id"]
    for fname in sorted(os.listdir(os.path.join(seed_dir, "resumes"))):
        with open(os.path.join(seed_dir, "resumes", fname), encoding="utf-8") as f:
            _ingest(job_id, fname, f.read(), [])
    if body.get("screen", True):
        run_id = db.nid("run")
        threading.Thread(target=run_screening, args=(job_id, run_id), daemon=True).start()
    return {"job_id": job_id, "title": job["title"]}


@app.post("/admin/purge")
def purge() -> dict:
    db.purge()
    return {"ok": True}


# ============================================================ n8n error intake (W0)

@app.post("/n8n/error")
def n8n_error(body: dict = Body(...)) -> dict:
    """The n8n error-handler workflow (W0) posts here when any workflow fails.

    Failures become audit rows, so an orchestration problem is visible in the same
    trail as the insights it was supposed to produce - nothing fails silently.
    """
    wf = body.get("workflow") or {}
    ex = body.get("execution") or {}
    job_id = body.get("job_id")
    db.log_audit(job_id, body.get("candidate_id"), "orchestration_error",
                 ex.get("id") or wf.get("name", "n8n"),
                 {"workflow": wf.get("name"), "workflow_id": wf.get("id"),
                  "execution_id": ex.get("id"), "node": ex.get("lastNodeExecuted"),
                  "error": str(ex.get("error") or body.get("error") or "")[:600],
                  "mode": ex.get("mode"), "retry_of": ex.get("retryOf")},
                 "n8n", llm.PROMPT_VERSION)
    return {"ok": True, "recorded": True}


@app.get("/n8n/health")
def n8n_health() -> dict:
    """Round-trip probe the orchestrator can call to prove it can reach the API."""
    return {"status": "ok", "orchestrator_expected": USE_N8N,
            "n8n_base_url": N8N_BASE, "time": db.now()}


# ============================================================ single-origin static hosting
# In the Docker/Render build the compiled web app is copied to ../web/dist and served
# from this same process, so there is no CORS hop and one URL runs the whole product.
# Every API route above is registered first, so it always wins over a static path.

_WEB_DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "dist")

if os.path.isdir(_WEB_DIST):
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles
    from starlette.exceptions import HTTPException as StarletteHTTPException

    class SPAStatic(StaticFiles):
        """Serves the built SPA and falls back to index.html so deep links work."""

        async def get_response(self, path: str, scope):  # type: ignore[override]
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code == 404:
                    return FileResponse(os.path.join(_WEB_DIST, "index.html"))
                raise

    app.mount("/", SPAStatic(directory=_WEB_DIST, html=True), name="web")

