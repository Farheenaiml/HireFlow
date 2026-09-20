"""End-to-end integration test: the exact path the demo video walks.

JD -> requirements -> ingest -> screen -> evidence verified -> override -> interview kit
-> interview notes -> standardized report -> human decision -> pool chat -> audit trail.

It also acts as the timed dry run: the whole flow is asserted to finish inside a budget,
so a regression that makes screening pathologically slow fails CI instead of the demo.
"""
import time

import pytest

pytest.importorskip("fastapi", reason="install requirements.txt to run API tests")
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

# Generous on purpose: the local engine should do this in well under a second, but CI
# machines are slow and an LLM key would add network time.
DRY_RUN_BUDGET_SECONDS = 90.0

JD = """
Senior Backend Engineer, Payments

We are hiring a backend engineer to own our payments and ledger services.

Requirements:
- 5+ years building production backend services in Python or Go
- Hands-on experience with payment systems, ledgers or double-entry accounting
- Strong PostgreSQL skills including query optimisation and transactional integrity
- Experience designing and operating REST or gRPC APIs at scale
- Comfortable with AWS, containers and CI/CD pipelines

Nice to have:
- Experience with event-driven architectures and Kafka
- Exposure to PCI-DSS or financial compliance work
"""

RESUME = """
Ananya Rao
ananya.rao@example.com | +91 98765 43210 | Bengaluru

Senior Software Engineer, FinPay Technologies (2019 - present)
Owned the double-entry ledger service handling 4 million transactions a month.
Built the service in Python with FastAPI and PostgreSQL, cutting settlement
reconciliation time from six hours to twenty minutes. Designed the gRPC API used
by four internal teams and ran it on AWS ECS with a GitHub Actions CI/CD pipeline.

Software Engineer, Nexa Systems (2016 - 2019)
Wrote Go services for a merchant onboarding platform. Tuned PostgreSQL queries and
introduced partitioning that dropped p99 latency from 900ms to 120ms.

Education: B.Tech Computer Science, National Institute of Technology
"""

NOTES = """
Interview with candidate, 45 minutes, backend round.

Asked how the ledger guaranteed correctness under concurrent writes. Candidate
explained that every posting was written inside a single Postgres transaction with
a serializable isolation level, and that a nightly reconciliation job compared
account balances against the sum of postings. Walked through a real incident where
a retry storm created duplicate postings and how idempotency keys fixed it.

Asked about the gRPC API design. Candidate described versioning the protobufs and
running both versions in parallel during migration.

Asked about Kafka. Candidate said they had only read about event-driven systems and
had not used Kafka in production.

Did not get to PCI-DSS or compliance experience; ran out of time.
"""


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def test_full_flow_end_to_end(client):
    started = time.time()

    # ---------------------------------------------------------------- 1. JD -> requirements
    r = client.post("/jd/analyze", json={"title": "Senior Backend Engineer, Payments", "jd_text": JD})
    assert r.status_code == 200, r.text
    job = r.json()
    job_id = job["job_id"]
    reqs = job["requirements"]
    assert len(reqs) >= 4, "a real JD should yield several checkable requirements"
    assert any(q["priority"] == "must" for q in reqs)
    assert all(q["req_id"].startswith("R") for q in reqs)

    # requirements are editable by a human (FR-01)
    reqs[0]["text"] = reqs[0]["text"] + " (edited by the recruiter)"
    r = client.put("/jd/requirements", json={"job_id": job_id, "requirements": reqs})
    assert r.status_code == 200
    assert r.json()["requirements"][0]["edited_by_human"] is True

    # ---------------------------------------------------------------- 2. ingest + redaction
    r = client.post("/candidates/paste", json={"job_id": job_id, "file_name": "ananya.txt", "text": RESUME})
    assert r.status_code == 200, r.text
    cid = r.json()["candidates"][0]["candidate_id"]
    assert r.json()["candidates"][0]["redactions"] > 0, "PII must be stripped before screening"

    detail = client.get(f"/candidate?candidate_id={cid}").json()
    redacted = detail["redacted_text"]
    assert "ananya.rao@example.com" not in redacted
    assert "98765" not in redacted
    assert detail["candidate"]["display_name"] is None, "name is hidden unless reveal=true"

    # ---------------------------------------------------------------- 3. screening
    main.screen_one(main.db.one("SELECT * FROM candidates WHERE candidate_id=?", (cid,)),
                    main.get_requirements(job_id))

    detail = client.get(f"/candidate?candidate_id={cid}").json()
    cand, evals = detail["candidate"], detail["evaluations"]
    assert cand["status"] in ("screened", "interview_ready")
    assert cand["group"] in ("Strong", "Potential", "Weak")
    assert cand["score"] is not None
    assert len(evals) == len(main.get_requirements(job_id)), "every requirement gets a verdict"

    # FR-16: nothing claims met/partial without a quote we located in the source
    for e in evals:
        if e["status"] in ("met", "partial"):
            assert e["quote"], f"{e['req_id']} claims evidence with no quote"
            assert e["quote_verified"], f"{e['req_id']} quote was not verified"
        assert e["model"] and e["prompt_version"]

    assert any(e["status"] in ("met", "partial") for e in evals), "a matching resume should match something"

    # ---------------------------------------------------------------- 4. human override wins
    target = evals[0]
    r = client.post("/evaluation/override", json={"eval_id": target["eval_id"], "status": "met"})
    assert r.status_code == 200, r.text
    after = client.get(f"/candidate?candidate_id={cid}").json()["evaluations"]
    overridden = next(e for e in after if e["eval_id"] == target["eval_id"])
    assert overridden["status"] == "met"
    assert overridden["overridden_by_human"] is True

    # ---------------------------------------------------------------- 5. interview kit
    r = client.post("/interview/kit", json={"candidate_id": cid})
    assert r.status_code == 200, r.text
    kit = r.json()["kit"]
    assert kit["questions"], "a kit must contain questions"
    for q in kit["questions"]:
        assert q["question"].strip()
        assert q.get("why_asked"), "every question must say which gap it closes"

    # ---------------------------------------------------------------- 6. interview evaluation
    r = client.post("/interview/evaluate", json={"candidate_id": cid, "notes": NOTES})
    assert r.status_code == 200, r.text
    out = r.json()
    report = out["report"]

    assert report["requirement_table"], "the report maps every requirement"
    assert report["coverage_summary"]["total"] == len(report["requirement_table"])
    # FR-12: the AI never fills in the rating or the decision
    assert report["interviewer_rating"] is None
    assert report["recruiter_decision"] is None

    # FR-11: Kafka and PCI were explicitly not covered in the notes
    assert out["unanswered"], "areas the interview did not reach must be surfaced"

    # interview quotes must be findable in the notes themselves
    for row in report["requirement_table"]:
        if row["interview_evidence"]:
            norm_notes = " ".join(NOTES.split()).lower()
            norm_quote = " ".join(row["interview_evidence"].split()).lower()
            assert norm_quote[:40] in norm_notes or len(norm_quote) < 12, \
                f"unverifiable interview quote on {row['req_id']}"

    # ---------------------------------------------------------------- 7. human decision gate
    r = client.post("/interview/decision", json={
        "candidate_id": cid, "decision": "advance",
        "note": "Ledger depth is real. Kafka gap is acceptable for this role.",
        "author": "integration-test", "rating": 4,
    })
    assert r.status_code == 200, r.text
    iv = client.get(f"/interview?candidate_id={cid}").json()["interview"]
    assert iv["decision"] == "advance"
    assert iv["decided_by"] == "integration-test"
    assert iv["report"]["interviewer_rating"] == 4, "the rating is human-set and persisted"

    # an invalid decision is rejected
    assert client.post("/interview/decision",
                       json={"candidate_id": cid, "decision": "definitely_hire"}).status_code == 400

    # ---------------------------------------------------------------- 8. pool chat
    r = client.post("/chat", json={"job_id": job_id, "message": "Who has ledger experience?"})
    assert r.status_code == 200, r.text
    assert r.json()["answer"].strip()

    r = client.post("/chat", json={"job_id": job_id, "message": "Which of them are women?"})
    assert r.json()["refused"] is True

    # ---------------------------------------------------------------- 9. audit trail (FR-14)
    rows = client.get(f"/audit?job_id={job_id}").json()["rows"]
    seen = {row["insight_type"] for row in rows}
    for expected in {"requirements", "requirements_edited", "ingest", "screening",
                     "human_override", "interview_kit", "interview_report",
                     "human_decision", "chat_answer", "chat_refusal"}:
        assert expected in seen, f"missing audit coverage for {expected}"
    for row in rows:
        assert row["model"], "every audit row names the engine that produced it"
        assert row["prompt_version"], "every audit row names the prompt version"

    # ---------------------------------------------------------------- 10. quality + stats
    q = client.get(f"/quality?job_id={job_id}").json()
    assert q["evaluations"] > 0
    assert 0 <= q["verified_share_pct"] <= 100
    assert q["human_overrides"] >= 1

    stats = client.get(f"/stats?job_id={job_id}").json()
    assert stats["candidates"] == 1
    assert stats["decisions"] == 1

    # ---------------------------------------------------------------- timed dry run
    elapsed = time.time() - started
    assert elapsed < DRY_RUN_BUDGET_SECONDS, \
        f"the demo path took {elapsed:.1f}s, over the {DRY_RUN_BUDGET_SECONDS}s budget"
    print(f"\n  full demo path completed in {elapsed:.2f}s")


def test_health_and_config_are_honest(client):
    assert client.get("/health").json()["status"] == "ok"
    cfg = client.get("/config").json()
    assert "model" in cfg and "prompt_version" in cfg
    assert "scoring" in cfg, "the UI needs the thresholds to explain the score"
    assert isinstance(cfg["llm_configured"], bool)


def test_bad_input_is_rejected_cleanly(client):
    assert client.post("/jd/analyze", json={"title": "x", "jd_text": "too short"}).status_code == 400
    assert client.get("/candidate?candidate_id=nope").status_code == 404
    assert client.post("/chat", json={"job_id": "nope", "message": ""}).status_code == 400


def test_n8n_error_intake_records_an_audit_row(client):
    r = client.post("/n8n/error", json={
        "workflow": {"name": "HireFlow — Screening Orchestrator", "id": "wf1"},
        "execution": {"id": "exec9", "lastNodeExecuted": "Screen candidate",
                      "error": {"message": "connect ECONNREFUSED"}},
    })
    assert r.status_code == 200
    rows = client.get("/audit").json()["rows"]
    assert any(row["insight_type"] == "orchestration_error" for row in rows), \
        "orchestration failures must be visible in the product's own audit trail"
