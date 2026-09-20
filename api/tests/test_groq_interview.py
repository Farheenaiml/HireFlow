"""Focused contract tests for the optional Groq interview intelligence layer."""
import llm
import httpx
import textops as T


REQS = [{"req_id": "R1", "text": "Production Git ownership", "priority": "must"}]
EVALS = [{"req_id": "R1", "status": "unclear", "quote": "Used Git", 
          "validation_note": "Confirm ownership of branching and release workflows."}]


def _enable_fake_groq(monkeypatch, response):
    monkeypatch.setattr(llm, "configured", lambda: True)
    monkeypatch.setattr(llm, "engine_name", lambda: "openai/gpt-oss-120b")
    calls = []

    def fake_call(system, user, **kwargs):
        calls.append((system, user))
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(llm, "call_json", fake_call)
    return calls


def test_groq_generates_candidate_specific_question(monkeypatch):
    calls = _enable_fake_groq(monkeypatch, {
        "questions": [{
            "req_id": "R1",
            "question": "Describe a production release where you personally owned Git branching and code review.",
            "why_asked": "The resume does not establish ownership.",
            "probes": ["What decision did you make yourself?"],
            "good_answer_signals": ["Names a release and trade-off."],
        }],
        "general_questions": [],
    })

    kit, engine = llm.interview_kit(
        REQS, EVALS, "Backend engineer with related tooling experience.",
        "Built services and used Git in team projects.")

    assert engine == "openai/gpt-oss-120b"
    assert kit["questions"][0]["req_id"] == "R1"
    assert kit["questions"][0]["evidence_quote"] == "Used Git"
    assert "ownership" in calls[0][1].lower()
    assert "Built services" in calls[0][1]


def test_groq_answer_validation_is_structured_and_ignores_model_score(monkeypatch):
    _enable_fake_groq(monkeypatch, {
        "mapping": [{
            "req_id": "R1",
            "evidence_status": "demonstrated",
            "reasoning": "The answer describes personal ownership of a release.",
            "supporting_quote": "I owned the release branch and reviewed every merge.",
            "missing_evidence": "",
            "follow_up_question": "",
        }],
        "score": 0,
        "strengths": [], "concerns": [], "next_validation": [],
    })

    result, engine = llm.evaluate_interview(
        REQS, EVALS, "I owned the release branch and reviewed every merge.",
        "Used Git in team projects.",
        {"questions": [{"req_id": "R1", "question": "Describe your release ownership."}]},
    )

    assert engine == "openai/gpt-oss-120b"
    assert result["mapping"][0]["evidence_status"] == "demonstrated"
    assert result["mapping"][0]["coverage"] == "covered"
    assert "score" not in result
    grouped = T.group_candidate(REQS, [{"req_id": "R1", "status": "met", "score": 0}])
    assert grouped["score"] == 80.0


def test_malformed_groq_question_response_falls_back_locally(monkeypatch):
    _enable_fake_groq(monkeypatch, {"questions": [{"req_id": "R1"}]})

    kit, engine = llm.interview_kit(REQS, EVALS, "summary")

    assert engine == "local-evidence-engine"
    assert kit["questions"][0]["req_id"] == "R1"
    assert kit["questions"][0]["question"]


def test_groq_failure_falls_back_to_local_interview_evaluation(monkeypatch):
    _enable_fake_groq(monkeypatch, RuntimeError("provider unavailable"))

    result, engine = llm.evaluate_interview(
        REQS, EVALS, "Not discussed in this interview.")

    assert engine == "local-evidence-engine"
    assert result["mapping"][0]["coverage"] == "not_covered"


def test_groq_call_logs_safe_runtime_success(monkeypatch, caplog):
    monkeypatch.setattr(llm, "PROVIDER", "groq")
    monkeypatch.setattr(llm, "GROQ_KEY", "test-secret-key")
    monkeypatch.setattr(llm, "GROQ_MODEL", "test-groq-model")
    response = httpx.Response(200, json={
        "choices": [{"message": {"content": '{"ok": true}'}}],
    })
    monkeypatch.setattr(llm, "_post_with_retry", lambda *args, **kwargs: response)

    with caplog.at_level("INFO", logger="llm"):
        result = llm.call_json("private system prompt", "private user prompt",
                               operation="interview_kit")

    assert result == {"ok": True}
    record = next(r for r in caplog.records if r.name == "llm")
    message = record.getMessage()
    assert "provider=groq" in message
    assert "model=test-groq-model" in message
    assert "operation=interview_kit" in message
    assert "success=true" in message and "latency_ms=" in message
    assert "test-secret-key" not in message
    assert "private system prompt" not in message
    assert "private user prompt" not in message


def test_groq_call_logs_safe_runtime_failure(monkeypatch, caplog):
    monkeypatch.setattr(llm, "PROVIDER", "groq")
    monkeypatch.setattr(llm, "GROQ_KEY", "test-secret-key")
    monkeypatch.setattr(llm, "GROQ_MODEL", "test-groq-model")
    monkeypatch.setattr(llm, "_post_with_retry",
                        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("provider down")))

    with caplog.at_level("WARNING", logger="llm"):
        try:
            llm.call_json("private system prompt", "private user prompt",
                          operation="interview_evaluation")
        except RuntimeError:
            pass
        else:
            raise AssertionError("Groq provider failure should still raise to the fallback caller")

    record = next(r for r in caplog.records if r.name == "llm")
    message = record.getMessage()
    assert "provider=groq" in message
    assert "model=test-groq-model" in message
    assert "operation=interview_evaluation" in message
    assert "success=false" in message and "latency_ms=" in message
    assert "test-secret-key" not in message
    assert "private system prompt" not in message
    assert "private user prompt" not in message
